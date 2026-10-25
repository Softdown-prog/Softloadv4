'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');

const records = new Map();
let loseAckOnce = false;
const value = (key) => records.get(key);
const snap = (key) => ({exists:records.has(key),data:()=>records.get(key)});
const database = {
    collection(collection) {
        return {doc(key) {
            return {key:collection+'/'+key};
        }};
    },
    async runTransaction(callback) {
        const operations=[];
        const transaction={
            async get(ref) {return snap(ref.key);},
            set(ref,data,options) {operations.push({kind:'set',ref,data,options});},
            create(ref,data) {operations.push({kind:'create',ref,data});},
            delete(ref) {operations.push({kind:'delete',ref});},
        };
        const result=await callback(transaction);
        for (const op of operations) {
            if (op.kind==='delete') records.delete(op.ref.key);
            else if (op.kind==='create') {
                if (records.has(op.ref.key)) throw Error('Receipt conflict');
                records.set(op.ref.key,op.data);
            } else if (op.data.storage_usado_mb?.__increment!==undefined) {
                const current=value(op.ref.key)||{};
                records.set(op.ref.key,{...current,storage_usado_mb:(current.storage_usado_mb||0)+op.data.storage_usado_mb.__increment});
            } else records.set(op.ref.key,{...op.data});
        }
        if (loseAckOnce) {loseAckOnce=false;throw Error('Firestore acknowledgement lost');}
        return result;
    }
};
for (const [modulePath,exports] of [
    ['firebase-admin',{firestore:{FieldValue:{
        increment:(n)=>({__increment:n}),
        serverTimestamp:()=>({__serverTime:true})
    }}}],
    ['./firebase',{db:database,bucket:{}}],
    ['archiver',()=>{}],
]) {
    const id=require.resolve(modulePath);
    require.cache[id]={id,filename:id,loaded:true,exports};
}
const {reservarCota,liberarCota}=require('./storageService');
const email='account@example.test';
const account=()=>records.get('clientes_premium/'+email)?.storage_usado_mb||0;
const reset=()=>{records.clear();loseAckOnce=false;};
const usedBytes=()=>Math.round(account()*1024*1024);

test('débito com mesmo ID só incrementa uma vez, mesmo após ACK perdido',async()=>{
    reset();
    const hold=await reservarCota(email,'free',100,'solarisedit-1');
    loseAckOnce=true;
    await assert.rejects(hold.confirmarUso(100),/acknowledgement lost/);
    assert.equal(usedBytes(),100);
    await hold.confirmarUso(100);
    assert.equal(usedBytes(),100);
    await assert.rejects(
        (await reservarCota(email,'free',105,'solarisedit-1')).confirmarUso(105),
        /quantidade diferente/
    );
    assert.equal(usedBytes(),100);
});

test('crédito, recibo e exclusão do tracking são atômicos e idempotentes',async()=>{
    reset();
    const ref=database.collection('solaris_projetos_persistidos').doc('uid_sid');
    records.set(ref.key,{uid:'uid',tamanhoBytes:100});
    await (await reservarCota(email,'free',100,'debit-2')).confirmarUso(100);
    loseAckOnce=true;
    await assert.rejects(liberarCota(email,100,'delete-2',{ref,data:null}),/acknowledgement lost/);
    assert.equal(usedBytes(),0);
    assert.equal(records.has(ref.key),false);
    await liberarCota(email,100,'delete-2',{ref,data:null});
    assert.equal(usedBytes(),0);
});

test('crédito idempotente atualiza documento de tracking uma só vez',async()=>{
    reset();
    const ref=database.collection('solaris_projetos_persistidos').doc('u_s');
    records.set(ref.key,{tamanhoBytes:100});
    await (await reservarCota(email,'free',200,'charge')).confirmarUso(200);
    await liberarCota(email,100,'replace-1',{ref,data:{tamanhoBytes:100,versaoAtiva:'v2'}});
    await liberarCota(email,100,'replace-1',{ref,data:{tamanhoBytes:100,versaoAtiva:'v2'}});
    assert.equal(usedBytes(),100);
    assert.equal(value(ref.key).versaoAtiva,'v2');
});

test('transação revalida o limite e não debita se o saldo mudou',async()=>{
    reset();
    const reservada=await reservarCota(email,'free',1024,'late-charge');
    records.set('clientes_premium/'+email,{storage_usado_mb:5});
    await assert.rejects(reservada.confirmarUso(1024),/Cota de 5MB excedida/);
    assert.equal(account(),5);
    assert.equal([...records.keys()].filter(k=>k.startsWith('storage_cota_operacoes/')).length,0);
});

test('operação idempotente recusa identificador vazio e bytes fracionários',async()=>{
    reset();
    await assert.rejects(
        (await reservarCota(email,'free',1,'')).confirmarUso(1),
        /identificador valido/
    );
    await assert.rejects(
        (await reservarCota(email,'free',1,'fractional')).confirmarUso(1.5),
        /bytes inteiros/
    );
    assert.equal(usedBytes(),0);
});
