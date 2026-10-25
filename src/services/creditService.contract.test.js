'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SOURCE = fs.readFileSync(path.join(__dirname, 'creditService.js'), 'utf8');
const EMAIL = 'Cliente@Example.COM';
const KEY = 'clientes_premium/cliente@example.com';

function harness(initial = {}) {
    const docs = new Map(Object.entries(initial).map(([k,v])=>[k,{...v}]));
    const calls = {transactions:0, writes:[], logs:[], errors:[]};
    let billingLogError = false;
    let firestoreOffline = false;
    let outboxDeleteFailure = false;
    const objects = new Map();
    let afterCommitTransientFailures = 0;
    let beforeCommitTransientFailures = 0;
    const inc = n => ({increment: n});
    const fieldValue = {increment: inc, serverTimestamp:()=>({serverTimestamp:true})};
    const makeDoc = key => ({
        async update(data) {calls.writes.push({op:'update',key,data});docs.set(key,{...docs.get(key),...data});},
        async set(data,options) {calls.writes.push({op:'set',key,data,options});docs.set(key,{...docs.get(key),...data});},
        collection(name) {
            assert.equal(name,'billing_logs');
            return {
                add(data) {
                    calls.logs.push({key,data});
                    return billingLogError ? Promise.reject(Error('billing logs unavailable')) : Promise.resolve();
                },
                doc(id) {return { ...makeDoc(key + '/billing_logs/' + id), key: key + '/billing_logs/' + id };},
            };
        },
    });
    const bucket = {
        file(name) {return {
            name,
            async save(content, options) {
                assert.equal(options.preconditionOpts.ifGenerationMatch,0);
                if (objects.has(name)) throw Object.assign(new Error('precondition'), {code:412});
                objects.set(name,content);
            },
            async download() {if(!objects.has(name))throw Error('GCS missing');return [Buffer.from(objects.get(name))];},
            async delete() {if(outboxDeleteFailure)throw Error('delete failed');objects.delete(name);},
        };},
        async getFiles({prefix,maxResults}) {return [Array.from(objects.keys()).filter(k=>k.startsWith(prefix)).slice(0,maxResults).map(k=>this.file(k))];},
    };
    const db = {
        collection(name) {
            assert.equal(name,'clientes_premium');
            return {doc(email) {return {...makeDoc(name+'/'+email),key:name+'/'+email};}};
        },
        async runTransaction(callback) {
            calls.transactions++;
            if (firestoreOffline) throw Object.assign(Error('Firestore unavailable'),{code:14});
            if (beforeCommitTransientFailures > 0) {
                beforeCommitTransientFailures--;
                throw Object.assign(new Error('unavailable before transaction'),{code:14});
            }
            const writes = [];
            const tx = {
                async get(ref) {
                    const data = docs.get(ref.key);
                    return {exists:!!data, data:()=>data && {...data}};
                },
                update(ref,changes) {writes.push({op:'tx.update',ref,changes});},
                set(ref,changes) {writes.push({op:'tx.set',ref,changes});},
            };
            await callback(tx);
            for (const {ref,changes,op} of writes) {
                const current = docs.get(ref.key) || {};
                const next = {...current};
                for (const [field,value] of Object.entries(changes)) {
                    next[field] = value && typeof value === 'object' && 'increment' in value
                        ? (current[field]||0)+value.increment : value;
                }
                docs.set(ref.key,next);
                calls.writes.push({op,key:ref.key,changes});
            }
            if (afterCommitTransientFailures > 0) {
                afterCommitTransientFailures--;
                throw Object.assign(new Error('deadline exceeded after commit'),{code:4});
            }
        },
    };
    const mod = {exports:{}};
    vm.runInNewContext(SOURCE, {
        module:mod, exports:mod.exports, Date, Promise, setTimeout,
        require(id) {
            assert.equal(id,'./firebase');
            return {db,admin:{firestore:{FieldValue:fieldValue}},bucket};
        },
        console:{error:(...args)=>calls.errors.push(args)},
    },{filename:'creditService.js'});
    return {api:mod.exports,docs,calls,objects,bucket,
        setFirestoreOffline:flag=>{firestoreOffline=flag},
        setOutboxDeleteFailure:flag=>{outboxDeleteFailure=flag},
        setBillingError:flag=>{billingLogError=flag},
        failAfterCommit:n=>{afterCommitTransientFailures=n},failBeforeCommit:n=>{beforeCommitTransientFailures=n}};
}

test('planos e cálculo dos créditos permanecem iguais, GPT sem novas cotas', () => {
    const {api}=harness();
    assert.deepEqual({...api.PLAN_CREDITS},{free:5,starter:500,pro:2000,studio:5500,premium:2000});
    assert.deepEqual({...api.BLOGGERAI_PLAN_CREDITS},{free:0,starter:500,premium:2000,pro:2000,studio:5500});
    assert.deepEqual({...api.GPT_PLAN_CREDITS},{free:0,starter:0,pro:0,studio:0,premium:0});
    assert.equal(api.calcularCreditos(0,0),0);
    assert.equal(api.calcularCreditos(999,0),1);
    assert.equal(api.calcularCreditos(1000,0),1);
    assert.equal(api.calcularCreditos(1000,1),2);
});

test('concessão Gemini faz update com email em minúsculas e 30 dias de expiração',async()=>{
    const h=harness({[KEY]:{creditos:4}});
    const before=Date.now();
    const r=await h.api.concederCreditos(EMAIL,'starter');
    assert.equal(r.creditos,500);
    assert.equal(h.calls.writes.length,1);
    assert.equal(h.calls.writes[0].op,'update');
    assert.equal(h.calls.writes[0].key,KEY);
    assert.equal(h.calls.writes[0].data.creditos_ciclo_total,500);
    assert.equal(h.calls.writes[0].data.creditos_expira_em,r.expira_em);
    assert.ok(Date.parse(r.expira_em)>=before+29*864e5);
    assert.ok(Date.parse(r.expira_em)<=Date.now()+31*864e5);
    const fallback=await h.api.concederCreditos(EMAIL,'invalid-plan');
    assert.equal(fallback.creditos,5);
});

test('GPT sem orçamento não cria cotas; BloggerAI usa set com merge, gratuito não gera créditos',async()=>{
    const h=harness();
    const noop=await h.api.concederCreditosGpt(EMAIL,'studio');
    assert.deepEqual(JSON.parse(JSON.stringify(noop)),{creditos:0,expira_em:null});
    assert.equal(h.calls.writes.length,0);
    const free=await h.api.concederCreditosBloggerAi(EMAIL,'free');
    assert.equal(free.creditos,0);
    assert.equal(h.calls.writes.length,0);
    const paid=await h.api.concederCreditosBloggerAi(EMAIL,'pro');
    assert.equal(paid.creditos,2000);
    assert.equal(h.calls.writes[0].op,'set');
    assert.equal(h.calls.writes[0].options.merge,true);
    assert.equal(h.calls.writes[0].data.creditos_bloggerai,2000);
    assert.equal(h.calls.writes[0].key,KEY);
});

test('Gemini: inativos respeitam saldo e expiração; ativos não bloqueiam; logs são não bloqueantes',async()=>{
    const h=harness({[KEY]:{is_active:false,creditos:1,creditos_expira_em:'2099-12-31T23:59:59Z'}});
    assert.equal(await h.api.debitarCreditos(EMAIL,999,0),1);
    assert.equal(h.docs.get(KEY).creditos,0);
    assert.equal(h.calls.logs[0].data.credits_debited,1);
    await assert.rejects(h.api.debitarCreditos(EMAIL,1000,0),/Créditos insuficientes/);
    assert.equal(h.calls.logs.length,1);
    h.docs.set(KEY,{is_active:false,creditos:10,creditos_expira_em:'2000-01-01'});
    await assert.rejects(h.api.debitarCreditos(EMAIL,1000,0),/Créditos insuficientes/);
    h.docs.set(KEY,{is_active:true,creditos:0});
    h.setBillingError(true);
    assert.equal(await h.api.debitarCreditos(EMAIL,1001,0),2);
    assert.equal(h.docs.get(KEY).creditos,-2);
    await Promise.resolve();
    assert.ok(h.calls.errors.some(args=>args[0]==='[BILLING] log error:'));
    const n=h.calls.transactions;
    assert.equal(await h.api.debitarCreditos(EMAIL,0,0),0);
    assert.equal(h.calls.transactions,n);
});

test('documento ausente causa erro no débito Gemini e BloggerAI, sem mutação',async()=>{
    const h=harness();
    await assert.rejects(h.api.debitarCreditos(EMAIL,1,0),/Usuário não encontrado/);
    await assert.rejects(h.api.debitarCreditosBloggerAi(EMAIL,1,0),/Usuário não encontrado/);
    assert.equal(h.calls.logs.length,0);
    assert.equal(h.calls.writes.length,0);
});

test('BloggerAI mantém saldo independente e registra tipo de consumo',async()=>{
    const h=harness({[KEY]:{
        is_active:false,creditos:0,creditos_bloggerai:3,
        creditos_bloggerai_expira_em:'2099-12-31T23:59:59Z',
    }});
    assert.equal(await h.api.debitarCreditosBloggerAi(EMAIL,1200,0),2);
    assert.equal(h.docs.get(KEY).creditos_bloggerai,1);
    assert.equal(h.docs.get(KEY).creditos,0);
    assert.equal(h.calls.logs[0].data.tipo,'bloggerai');
    await assert.rejects(h.api.debitarCreditosBloggerAi(EMAIL,2000,0),/Créditos BloggerAI insuficientes/);
    h.docs.set(KEY,{is_active:true,creditos_bloggerai:0});
    assert.equal(await h.api.debitarCreditosBloggerAi(EMAIL,1000,0),1);
    assert.equal(h.docs.get(KEY).creditos_bloggerai,-1);
});

test('GPT legado: ausência de doc/campo/saldo nunca bloqueia a cobrança principal',async()=>{
    const h=harness();
    assert.equal(await h.api.debitarCreditosGpt(EMAIL,1000,0),1);
    assert.equal(h.calls.writes.length,0);
    assert.equal(h.calls.logs[0].data.modelo,'gpt-5.4-nano');
    h.docs.set(KEY,{is_active:true});
    assert.equal(await h.api.debitarCreditosGpt(EMAIL,1000,0),1);
    assert.equal(h.calls.writes.length,0);
    h.docs.set(KEY,{creditos_gpt:1,creditos_gpt_expira_em:'2000-01-01'});
    assert.equal(await h.api.debitarCreditosGpt(EMAIL,1000,0),1);
    assert.equal(h.calls.writes.length,0);
    h.docs.set(KEY,{creditos_gpt:3,creditos_gpt_expira_em:'2099-12-31'});
    assert.equal(await h.api.debitarCreditosGpt(EMAIL,1001,0),2);
    assert.equal(h.docs.get(KEY).creditos_gpt,1);
    assert.equal(h.calls.writes.length,1);
    assert.equal(h.calls.logs.length,4);
});

test('Gemini: cobrança com operacaoId é atômica, repetição não duplica saldo nem log', async () => {
    const op = 'geracao-servidor-000001';
    const h = harness({[KEY]:{is_active:false,creditos:10}});
    assert.equal(await h.api.debitarCreditos(EMAIL,1200,500,op),2);
    assert.equal(h.docs.get(KEY).creditos,8);
    const receiptKey = KEY+'/billing_logs/'+op;
    assert.equal(h.docs.get(receiptKey).credits_debited,2);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.set').length,1);
    assert.equal(h.calls.logs.length,0);
    assert.equal(await h.api.debitarCreditos(EMAIL,1200,500,op),2);
    assert.equal(h.docs.get(KEY).creditos,8);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,1);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.set').length,1);
});

test('Gemini: mesma chave com tokens diferentes é recusada, sem novo débito', async () => {
    const op = 'geracao-servidor-000002';
    const h = harness({[KEY]:{is_active:false,creditos:10}});
    await h.api.debitarCreditos(EMAIL,1000,50,op);
    await assert.rejects(h.api.debitarCreditos(EMAIL,2000,50,op),/consumo diferente/);
    assert.equal(h.docs.get(KEY).creditos,8);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,1);
    await assert.rejects(h.api.debitarCreditos(EMAIL,1000,50,'../../segredos'),/Identificador de cobrança inválido/);
});

test('Gemini: erro antes de confirmar transação permite repetição com mesma chave', async () => {
    const op = 'geracao-servidor-000003';
    const h = harness({[KEY]:{is_active:false,creditos:4}});
    // Simula timeout depois do commit: recibo já existe mesmo que o chamador
    // não tenha recebido a confirmação e possa repetir o mesmo ID.
    await h.api.debitarCreditos(EMAIL,1200,100,op);
    assert.equal(await h.api.debitarCreditos(EMAIL,1200,100,op),2);
    assert.equal(h.docs.get(KEY).creditos,2);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,1);
});

test('Gemini: saldo insuficiente não registra recibo falso e pode ser retomado após crédito', async () => {
    const op = 'geracao-servidor-000004';
    const h = harness({[KEY]:{is_active:false,creditos:0}});
    await assert.rejects(h.api.debitarCreditos(EMAIL,1100,0,op),/Créditos insuficientes/);
    assert.equal(h.docs.has(KEY+'/billing_logs/'+op),false);
    h.docs.set(KEY,{is_active:false,creditos:3});
    assert.equal(await h.api.debitarCreditos(EMAIL,1100,0,op),2);
    assert.equal(h.docs.get(KEY).creditos,1);
});

test('Gemini: timeout após commit refaz consulta do recibo sem novo débito', async () => {
    const op='geracao-servidor-000005';
    const h=harness({[KEY]:{is_active:false,creditos:6}});
    h.failAfterCommit(1);
    assert.equal(await h.api.debitarCreditos(EMAIL,1200,200,op),2);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,1);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.set').length,1);
    assert.equal(h.calls.transactions,2);
});

test('Gemini: indisponibilidade antes do commit tenta novamente com a mesma chave', async () => {
    const op='geracao-servidor-000006';
    const h=harness({[KEY]:{is_active:false,creditos:6}});
    h.failBeforeCommit(1);
    assert.equal(await h.api.debitarCreditos(EMAIL,1200,200,op),2);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal(h.calls.transactions,2);
});

test('Gemini: indisponibilidade persistente para após três tentativas sem inventar débito', async () => {
    const op='geracao-servidor-000007';
    const h=harness({[KEY]:{is_active:false,creditos:6}});
    h.failBeforeCommit(4);
    await assert.rejects(h.api.debitarCreditos(EMAIL,1200,200,op),/unavailable/);
    assert.equal(h.docs.get(KEY).creditos,6);
    assert.equal(h.docs.has(KEY+'/billing_logs/'+op),false);
    assert.equal(h.calls.transactions,3);
});

test('GCS: pendência sobrevive a falha prolongada do Firestore e é debitada pelo recuperador', async () => {
    const id='cobranca-recuperar-0001';
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    h.setFirestoreOffline(true);
    await assert.rejects(h.api.debitarCreditos(EMAIL,1200,100,id),/Firestore unavailable/);
    assert.equal(h.docs.get(KEY).creditos,5);
    assert.equal(h.objects.size,1);
    h.setFirestoreOffline(false);
    const result=await h.api.recuperarCobrancasPendentes();
    assert.equal(result.processadas,1);
    assert.equal(result.falhas,0);
    assert.equal(h.docs.get(KEY).creditos,3);
    assert.equal(h.objects.size,0);
    const again=await h.api.recuperarCobrancasPendentes();
    assert.equal(again.processadas,0);
});

test('GCS: se exclusão da outbox falha, repetição encontra recibo sem segundo débito', async () => {
    const id='cobranca-recuperar-0002';
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    h.setOutboxDeleteFailure(true);
    assert.equal(await h.api.debitarCreditos(EMAIL,1001,0,id),2);
    assert.equal(h.objects.size,1);
    h.setOutboxDeleteFailure(false);
    const result=await h.api.recuperarCobrancasPendentes();
    assert.equal(result.processadas,1);
    assert.equal(h.docs.get(KEY).creditos,3);
    assert.equal(h.calls.writes.filter(w=>w.op==='tx.update').length,1);
    assert.equal(h.objects.size,0);
});

test('GCS: outbox recusa arquivo corrompido e não realiza cobrança', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    h.objects.set('billing/pending/cobranca-corrompida.json', '{"email":"attacker","inputTokens":500}');
    const result=await h.api.recuperarCobrancasPendentes();
    assert.equal(result.processadas,0);
    assert.equal(result.falhas,1);
    assert.equal(h.docs.get(KEY).creditos,5);
});
