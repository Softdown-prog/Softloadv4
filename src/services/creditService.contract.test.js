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
    const calls = {transactions:0, writes:[], logs:[], errors:[], info:[]};
    let billingLogError = false;
    let firestoreOffline = false;
    let outboxDeleteFailure = false;
    const objects = new Map();
    const generations = new Map();
    let cursorWriteError = false;
    let simularDisputaCursor = false;
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
                const match=options.preconditionOpts.ifGenerationMatch;
                const current=generations.get(name) || 0;
                if (name === 'billing/state/recovery-cursor.json' && cursorWriteError)
                    throw Object.assign(Error('cursor write failure'), {code:503});
                if (name === 'billing/state/recovery-cursor.json' && simularDisputaCursor) {
                    // Outro contêiner grava seu cursor entre nossa leitura e CAS.
                    simularDisputaCursor = false;
                    objects.set(name,JSON.stringify({versao:1,cursor:'billing/pending/zzzz-outro-worker.json'}));
                    generations.set(name,current+1);
                }
                if (String(match)!==String(generations.get(name)||0))
                    throw Object.assign(new Error('precondition'), {code:412});
                objects.set(name,content);
                generations.set(name,current+1);
            },
            async getMetadata() {
                if(!objects.has(name)) throw Object.assign(new Error('not found'),{code:404});
                return [{generation:String(generations.get(name) || 1)}];
            },
            async download() {if(!objects.has(name))throw Error('GCS missing');return [Buffer.from(objects.get(name))];},
            async delete() {if(outboxDeleteFailure)throw Error('delete failed');objects.delete(name);generations.delete(name);},
        };},
        async getFiles({prefix,maxResults,startOffset}) {
            // GCS devolve nomes ordenados, startOffset inclusivo.
            return [Array.from(objects.keys()).filter(k=>k.startsWith(prefix) && (!startOffset || k >= startOffset))
                .sort().slice(0,maxResults).map(k=>this.file(k))];
        },
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
    const createApi = () => {
      const mod = {exports:{}};
      vm.runInNewContext(SOURCE, {
        module:mod, exports:mod.exports, Date, Promise, setTimeout,
        require(id) {
            assert.equal(id,'./firebase');
            return {db,admin:{firestore:{FieldValue:fieldValue}},bucket};
        },
        console:{error:(...args)=>calls.errors.push(args), info:(...args)=>calls.info.push(args)},
      },{filename:'creditService.js'});
      return mod.exports;
    };
    return {api:createApi(),reboot:createApi,docs,calls,objects,bucket,
        setCursorWriteError:flag=>{cursorWriteError=flag},
        simularConflitoCursor:()=>{simularDisputaCursor=true},
        setFirestoreOffline:flag=>{firestoreOffline=flag},
        setOutboxDeleteFailure:flag=>{outboxDeleteFailure=flag},
        setBillingError:flag=>{billingLogError=flag},
        failAfterCommit:n=>{afterCommitTransientFailures=n},failBeforeCommit:n=>{beforeCommitTransientFailures=n}};
}

test('planos e cálculo dos créditos permanecem iguais, GPT sem novas cotas', () => {
    const {api}=harness();
    assert.deepEqual({...api.PLAN_CREDITS},{free:5,starter:150,pro:600,studio:1200,premium:600});
    assert.deepEqual({...api.BLOGGERAI_PLAN_CREDITS},{free:0,starter:150,premium:600,pro:600,studio:1200});
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
    assert.equal(r.creditos,150);
    assert.equal(h.calls.writes.length,1);
    assert.equal(h.calls.writes[0].op,'update');
    assert.equal(h.calls.writes[0].key,KEY);
    assert.equal(h.calls.writes[0].data.creditos_ciclo_total,150);
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
    assert.equal(paid.creditos,600);
    assert.equal(h.calls.writes[0].op,'set');
    assert.equal(h.calls.writes[0].options.merge,true);
    assert.equal(h.calls.writes[0].data.creditos_bloggerai,600);
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
    assert.equal([...h.objects.keys()].filter(x=>x.startsWith('billing/pending/')).length,0);
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
    assert.equal([...h.objects.keys()].filter(x=>x.startsWith('billing/pending/')).length,0);
});

test('GCS: outbox recusa arquivo corrompido e não realiza cobrança', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    h.objects.set('billing/pending/cobranca-corrompida.json', '{"email":"attacker","inputTokens":500}');
    const result=await h.api.recuperarCobrancasPendentes();
    assert.equal(result.processadas,0);
    assert.equal(result.falhas,1);
    assert.equal(h.docs.get(KEY).creditos,5);
});


test('GCS: arquivos irrecuperáveis no início não impedem débito de pendências posteriores', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:6}});
    h.objects.set('billing/pending/a-corrompido.json','{');
    h.objects.set('billing/pending/b-corrompido.json','{');
    const id='cobranca-fila-00000001';
    h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
        versao:1, operacaoId:id, email:EMAIL.toLowerCase(),
        inputTokens:1200, outputTokens:100, criadoEm:new Date().toISOString(),
    }));
    const first=await h.api.recuperarCobrancasPendentes(2);
    assert.equal(first.processadas,0);
    assert.equal(first.falhas,2);
    assert.equal(h.docs.get(KEY).creditos,6);
    const second=await h.api.recuperarCobrancasPendentes(2);
    assert.equal(second.processadas,1);
    assert.equal(second.falhas,0);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal(h.objects.has('billing/pending/'+id+'.json'),false);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,1);
});

test('GCS: cursor volta ao começo para tentar pendências antigas novamente', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:6}});
    const name='billing/pending/a-arquivo-permanente.json';
    h.objects.set(name,'{');
    assert.equal((await h.api.recuperarCobrancasPendentes(1)).falhas,1);
    // Lote após o cursor acaba: novo ciclo recomeça desde o primeiro objeto.
    assert.equal((await h.api.recuperarCobrancasPendentes(1)).falhas,1);
    assert.equal(h.objects.has(name),true);
});

test('GCS: cada ciclo mantém o limite e cursor não pula item ao retomar', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:9}});
    for(let i=0;i<5;i++){
        const id='cobranca-sequencial-000'+i;
        h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
            versao:1,operacaoId:id,email:EMAIL.toLowerCase(),
            inputTokens:500,outputTokens:0,criadoEm:new Date().toISOString(),
        }));
    }
    assert.equal((await h.api.recuperarCobrancasPendentes(2)).processadas,2);
    assert.equal((await h.api.recuperarCobrancasPendentes(2)).processadas,2);
    assert.equal((await h.api.recuperarCobrancasPendentes(2)).processadas,1);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal([...h.objects.keys()].filter(x=>x.startsWith('billing/pending/')).length,0);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,5);
});


test('GCS: após reinicialização, o recuperador retoma o cursor persistido', async () => {
    const h = harness({[KEY]:{is_active:false,creditos:8}});
    const ids=['cobranca-reinicio-0001','cobranca-reinicio-0002','cobranca-reinicio-0003'];
    for(const id of ids) h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
        versao:1,operacaoId:id,email:EMAIL.toLowerCase(),
        inputTokens:500,outputTokens:0,criadoEm:new Date().toISOString(),
    }));
    assert.equal((await h.api.recuperarCobrancasPendentes(1)).processadas,1);
    assert.equal(JSON.parse(h.objects.get('billing/state/recovery-cursor.json')).cursor,'billing/pending/'+ids[0]+'.json');
    const aposReinicio = h.reboot();
    assert.equal((await aposReinicio.recuperarCobrancasPendentes(1)).processadas,1);
    assert.equal(h.docs.get(KEY).creditos,6);
    assert.equal(JSON.parse(h.objects.get('billing/state/recovery-cursor.json')).cursor,'billing/pending/'+ids[1]+'.json');
    assert.equal((await aposReinicio.recuperarCobrancasPendentes(1)).processadas,1);
    assert.equal(h.docs.get(KEY).creditos,5);
    assert.equal(h.calls.writes.filter(x=>x.op==='tx.update').length,3);
});

test('GCS: falha em salvar cursor alerta mas nunca desfaz cobrança confirmada', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    const id='cobranca-cursor-00001';
    h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
        versao:1,operacaoId:id,email:EMAIL.toLowerCase(),
        inputTokens:600,outputTokens:0,criadoEm:new Date().toISOString(),
    }));
    h.setCursorWriteError(true);
    const r=await h.api.recuperarCobrancasPendentes(1);
    assert.equal(r.processadas,1);
    assert.equal(r.falhas,1);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal(h.objects.has('billing/state/recovery-cursor.json'),false);
    h.setCursorWriteError(false);
    assert.equal((await h.reboot().recuperarCobrancasPendentes(1)).processadas,0);
    assert.equal(h.docs.get(KEY).creditos,4);
});

test('GCS: cursor inválido interrompe recuperação para alertar operador', async () => {
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    h.objects.set('billing/state/recovery-cursor.json','{"versao":1,"cursor":"../../invalido"}');
    await assert.rejects(h.api.recuperarCobrancasPendentes(1),/Cursor persistido inválido/);
    assert.equal(h.docs.get(KEY).creditos,5);
});


test('GCS: disputa CAS com outro contêiner preserva cursor vencedor e não altera débito',async()=>{
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    const id='cobranca-disputa-cursor-0001';
    h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
        versao:1,operacaoId:id,email:EMAIL.toLowerCase(),
        inputTokens:500,outputTokens:0,criadoEm:new Date().toISOString(),
    }));
    h.simularConflitoCursor();
    const result=await h.api.recuperarCobrancasPendentes(1);
    assert.equal(result.processadas,1);
    assert.equal(result.falhas,0);
    assert.equal(result.conflitosCursor,1);
    assert.equal(h.docs.get(KEY).creditos,4);
    assert.equal(h.calls.writes.filter(w=>w.op==='tx.update').length,1);
    assert.equal(h.calls.info.length,1);
    assert.equal(JSON.parse(h.objects.get('billing/state/recovery-cursor.json')).cursor,
        'billing/pending/zzzz-outro-worker.json');
    const recovery=await h.reboot().recuperarCobrancasPendentes(1);
    assert.equal(recovery.conflitosCursor,0);
    assert.equal(h.docs.get(KEY).creditos,4);
});

test('GCS: execução normal registra zero conflitos de cursor',async()=>{
    const h=harness({[KEY]:{is_active:false,creditos:5}});
    const id='cobranca-cursor-sem-disputa-0001';
    h.objects.set('billing/pending/'+id+'.json',JSON.stringify({
        versao:1,operacaoId:id,email:EMAIL.toLowerCase(),
        inputTokens:500,outputTokens:0,criadoEm:new Date().toISOString(),
    }));
    const result=await h.api.recuperarCobrancasPendentes(1);
    assert.equal(result.conflitosCursor,0);
    assert.equal(result.falhas,0);
});
