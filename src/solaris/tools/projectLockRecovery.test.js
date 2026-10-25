'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {inspectSolarisLock,recoverSolarisLock,REQUIRED_CONFIRMATION}=require('./projectLockRecovery');

const oldDate=new Date(Date.now()-2*60*60*1000);
function mockDb() {
    const current={data:{uid:'u',sessionId:'s',owner:'secret-owner',iniciadoEm:oldDate.toISOString()},
        updateTime:{toDate(){return new Date('2026-10-24T12:00:00Z')}}};
    const actions={get:0,deletes:[]};
    const doc={
        async get(){actions.get++;return current.data?{exists:true,data:()=>({...current.data}),updateTime:current.updateTime}:{exists:false};},
        async delete(opts){actions.deletes.push(opts);if(opts?.lastUpdateTime!==current.updateTime)throw Error('failed precondition');current.data=null;}
    };
    return {db:{collection(name){assert.equal(name,'solaris_projetos_bloqueios');return{doc(id){assert.equal(id,'u_s');return doc}}}},current,actions};
}
const base=(expectedUpdatedAt='2026-10-24T12:00:00.000Z')=>({
    uid:'u',sessionId:'s',expectedOwner:'secret-owner',expectedUpdatedAt,
    confirmation:REQUIRED_CONFIRMATION,instancesStopped:true,
});

test('inspeção é somente leitura, com carimbo e idade verificáveis',async()=>{
    const {db,actions}=mockDb();
    const result=await inspectSolarisLock(db,'u','s');
    assert.equal(result.owner,'secret-owner');
    assert.equal(result.updatedAt,'2026-10-24T12:00:00.000Z');
    assert.equal(result.eligibleByAge,true);
    assert.equal(actions.deletes.length,0);
});

test('recuperação recusa falta de confirmação sem sequer ler Firestore',async()=>{
    const {db,actions}=mockDb();
    await assert.rejects(recoverSolarisLock(db,{...base(),instancesStopped:false}),/Interrompa TODAS/);
    await assert.rejects(recoverSolarisLock(db,{...base(),confirmation:'sim'}),/Interrompa TODAS/);
    assert.equal(actions.get,0);
    assert.equal(actions.deletes.length,0);
});

test('bloqueio recente nunca é removido',async()=>{
    const {db,current,actions}=mockDb();
    current.data.iniciadoEm=new Date().toISOString();
    await assert.rejects(recoverSolarisLock(db,base()),/60 minutos/);
    assert.equal(actions.deletes.length,0);
});

test('owner e updateTime esperados precisam coincidir',async()=>{
    const {db,actions}=mockDb();
    await assert.rejects(recoverSolarisLock(db,{...base(),expectedOwner:'outro'}),/Bloqueio alterado/);
    await assert.rejects(recoverSolarisLock(db,base('2026-10-24T12:00:01Z')),/Bloqueio alterado/);
    assert.equal(actions.deletes.length,0);
});

test('remove somente com precondição de updateTime e confirma ausência',async()=>{
    const {db,actions}=mockDb();
    const result=await recoverSolarisLock(db,base());
    assert.equal(result.released,true);
    assert.ok(actions.deletes[0].lastUpdateTime);
    assert.equal((await inspectSolarisLock(db,'u','s')),null);
});

test('metadata inválida, timestamp ausente e ids inseguros falham fechados',async()=>{
    const {db,current,actions}=mockDb();
    await assert.rejects(inspectSolarisLock(db,'..','s'),TypeError);
    current.data.uid='different';
    await assert.rejects(recoverSolarisLock(db,base()),/identidade/);
    current.data.uid='u';
    current.updateTime=null;
    await assert.rejects(recoverSolarisLock(db,base()),/carimbo/);
    assert.equal(actions.deletes.length,0);
});

test('falha na precondição Firestore não é mascarada como sucesso',async()=>{
    const {db,current}=mockDb();
    const collection=db.collection('solaris_projetos_bloqueios');
    const original=collection.doc('u_s');
    const originalDelete=original.delete;
    original.delete=async opts=>{assert.ok(opts.lastUpdateTime);throw Error('FAILED_PRECONDITION');};
    await assert.rejects(recoverSolarisLock(db,base()),/FAILED_PRECONDITION/);
    assert.ok(current.data);
    original.delete=originalDelete;
});

test('bloqueios de sessão com caracteres inseguros nunca chegam ao Firestore',async()=>{
    const {db,actions}=mockDb();
    for(const id of ['/', '..', '.', 'a/b', 'a\\b', 'a\0b']) {
        await assert.rejects(inspectSolarisLock(db,id,'s'),TypeError);
    }
    assert.equal(actions.get,0);
    assert.equal(actions.deletes.length,0);
});
