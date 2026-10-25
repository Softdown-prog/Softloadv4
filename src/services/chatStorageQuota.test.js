'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const Module=require('node:module');
const path=require('node:path');

const docs=new Map(),gcs=new Map();
let seq=0,loseTxAck=false,loseGcsAck=null,failWrite=null,failDeletePath=null,loseDeleteAck=null;
const EMAIL='test@example.com',UID='user-test';
const key=(a,b)=>a+'/'+b;
function ref(collection,id) {
    const name=key(collection,id);
    return {
        name,
        async get(){return snapshot(name);},
        async create(data) {
            if(docs.has(name)) throw Object.assign(Error('already exists'),{code:6});
            docs.set(name,{data:{...data},revision:++seq});
        },
        async delete(options) {
            const current=docs.get(name);
            if(options?.lastUpdateTime?.revision!==current?.revision) {
                throw Object.assign(Error('failed precondition'),{code:9});
            }
            docs.delete(name);
        }
    };
}
function snapshot(name) {
    const item=docs.get(name);
    return {
        exists:Boolean(item),
        data:()=>item?{...item.data}:undefined,
        updateTime:item?{revision:item.revision}:undefined,
    };
}
const db={
    collection(name){return{doc(id){return ref(name,id);}};},
    async runTransaction(fn) {
        const changes=[];
        const tx={
            async get(document){return snapshot(document.name);},
            set(document,value){changes.push({type:'set',document,value});},
            delete(document){changes.push({type:'delete',document});},
            create(document,value){changes.push({type:'create',document,value});},
        };
        const result=await fn(tx);
        for(const change of changes) {
            if(change.type==='delete') docs.delete(change.document.name);
            else docs.set(change.document.name,{data:{...change.value},revision:++seq});
        }
        if(loseTxAck){loseTxAck=false;throw Error('Firestore acknowledgement lost');}
        return result;
    },
};
const bucket={
    file(name) {
        return {
            async download() {
                if(!gcs.has(name))throw Object.assign(Error('No such object'),{code:404});
                return [Buffer.from(gcs.get(name))];
            },
            async save(content) {
                if(failWrite===name) throw Error('GCS write rejected');
                gcs.set(name,Buffer.from(content));
                if(loseGcsAck===name) {
                    loseGcsAck=null;
                    throw Error('GCS acknowledgement lost');
                }
            },
            async delete(){
                if(failDeletePath===name) throw Error('GCS delete rejected');
                gcs.delete(name);
                if(loseDeleteAck===name) {
                    loseDeleteAck=null;
                    throw Error('GCS delete acknowledgement lost');
                }
            },
        };
    },
};
function loadModule(relative,mocks) {
    const filename=require.resolve(relative);
    const mod=new Module(filename,module);
    mod.filename=filename;mod.paths=module.paths;
    mod.require=id=>Object.hasOwn(mocks,id)?mocks[id]:require(id);
    mod._compile(fs.readFileSync(filename,'utf8'),filename);
    return mod.exports;
}
const storage=loadModule('./storageService',{
    'archiver':()=>{},
    'firebase-admin':{firestore:{FieldValue:{
        increment:number=>({__increment:number}),
        serverTimestamp:()=>({__serverTimestamp:true}),
    }}},
    './firebase':{db,bucket},
});
const chat=loadModule('./chatStorageService',{
    './firebase':{db,bucket},
    './storageService':storage,
});
const cota={email:EMAIL,plano:'free'};
function quotaBytes() {
    return Math.round((docs.get(key('clientes_premium',EMAIL))?.data?.storage_usado_mb||0)*1024*1024);
}
function physicalBytes(){
    return [...gcs.entries()].reduce((sum,[name,content])=>name.startsWith('users/'+UID+'/')?sum+content.length:sum,0);
}
function reset() {docs.clear();gcs.clear();seq=0;loseTxAck=false;loseGcsAck=null;failWrite=null;failDeletePath=null;loseDeleteAck=null;}
const session=(message)=>({messages:[{role:'user',content:message}],tokens:{total:0,input:0,output:0},meta:{}});
const file=(p)=>gcs.get(p)?.toString('utf8');

test('salvar a mesma sessão duas vezes contabiliza só a diferença de bytes',async()=>{
    reset();
    await chat.saveSession(UID,'solaris-chat','s1',session('primeiro'),cota);
    const first=quotaBytes();
    assert.equal(first,physicalBytes());
    await chat.saveSession(UID,'solaris-chat','s1',session('primeiro'),cota);
    assert.equal(quotaBytes(),first);
    await chat.saveSession(UID,'solaris-chat','s1',session('primeiro com conteúdo mais comprido'),cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.ok(quotaBytes()>first);
});

test('salvar sessões diferentes cobra os arquivos novos, não latest/index inteiros',async()=>{
    reset();
    await chat.saveSession(UID,'workspace-chat','alpha',session('a'),cota);
    await chat.saveSession(UID,'workspace-chat','beta',session('b'),cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal((await chat.listSessions(UID,'workspace-chat')).length,2);
    assert.equal((await chat.loadSession(UID,'workspace-chat','alpha')).messages[0].content,'a');
});

test('sobrescrever memória soma diferença positiva ou devolve diferença negativa',async()=>{
    reset();
    await chat.saveMemory(UID,{notes:'12345678901234567890'},cota);
    const first=quotaBytes();
    await chat.saveMemory(UID,{notes:'12345678901234567890'},cota);
    assert.equal(quotaBytes(),first);
    await chat.saveMemory(UID,{notes:'1'},cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.ok(quotaBytes()<first);
});

test('duas atualizações concorrentes preservam totais e não duplicam uso',async()=>{
    reset();
    const a={type:'workspace-chat',updatedAt:'2026-01-01',tokens:{total:7}};
    const b={type:'solaris-chat',updatedAt:'2026-01-02',tokens:{total:9}};
    await Promise.all([
        chat.updateMemoryFromSession(UID,a,cota),
        chat.updateMemoryFromSession(UID,b,cota),
    ]);
    const saved=await chat.loadMemory(UID);
    assert.equal(saved.totalTokensUsed,16);
    assert.equal(saved.sessionCount,2);
    assert.equal(quotaBytes(),physicalBytes());
});

test('ACK do Firestore perdido não debita a mesma memória novamente',async()=>{
    reset();
    loseTxAck=true;
    await assert.rejects(chat.saveMemory(UID,{x:'longer'},cota),/Firestore acknowledgement lost/);
    const prior=quotaBytes();
    assert.equal(prior,physicalBytes());
    await chat.saveMemory(UID,{x:'longer'},cota);
    assert.equal(quotaBytes(),prior);
});

test('ACK perdido do GCS é verificado e débito continua uma única vez',async()=>{
    reset();
    loseGcsAck='users/'+UID+'/sessions/chat-suporte/s1.json';
    await chat.saveSession(UID,'chat-suporte','s1',session('salvo'),cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal((await chat.loadSession(UID,'chat-suporte','s1')).messages[0].content,'salvo');
});

test('falha antes da escrita GCS não muda cota e o lock é liberado',async()=>{
    reset();
    failWrite='users/'+UID+'/memory/context.json';
    await assert.rejects(chat.saveMemory(UID,{notes:'not-saved'},cota),/GCS write rejected/);
    assert.equal(quotaBytes(),0);
    assert.equal(docs.size,0);
    failWrite=null;
    await chat.saveMemory(UID,{notes:'saved'},cota);
    assert.equal(quotaBytes(),physicalBytes());
});

test('primeira atualização de arquivo legado usa somente delta; não reconta bytes anteriores',async()=>{
    reset();
    const memory='users/'+UID+'/memory/context.json';
    gcs.set(memory,Buffer.from(JSON.stringify({notes:'old long memory',uid:UID,updatedAt:'2026-01-01T01:01:01.000Z'})));
    docs.set(key('clientes_premium',EMAIL),{data:{storage_usado_mb:1000/(1024*1024)},revision:++seq});
    const oldLen=gcs.get(memory).length;
    await chat.saveMemory(UID,{notes:'new'},cota);
    assert.equal(quotaBytes(),1000+gcs.get(memory).length-oldLen);
});

test('gravações sem cota continuam disponíveis para chamadas legadas',async()=>{
    reset();
    await chat.saveSession(UID,'sol','session',session('sem cota'));
    await chat.saveMemory(UID,{notes:'sem cota'});
    assert.equal(quotaBytes(),0);
    assert.ok(physicalBytes()>0);
    assert.equal(await chat.loadMemory(UID).then(x=>x.notes),'sem cota');
});

test('exclusão de sessão mais recente devolve o espaço real e remove latest', async()=>{
    reset();
    await chat.saveSession(UID,'solaris-chat','alpha',session('primeira'),cota);
    await chat.saveSession(UID,'solaris-chat','beta',session('segunda'),cota);
    await chat.deleteSession(UID,'solaris-chat','beta',cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal(await chat.loadSession(UID,'solaris-chat','beta'),null);
    assert.deepEqual((await chat.listSessions(UID,'solaris-chat')).map(s=>s.sessionId),['alpha']);
    assert.equal(file('users/'+UID+'/sessions/solaris-chat/latest.json'),undefined);
});

test('exclusão de sessão antiga preserva latest de outra sessão',async()=>{
    reset();
    await chat.saveSession(UID,'workspace-chat','older',session('antiga'),cota);
    await chat.saveSession(UID,'workspace-chat','newer',session('nova'),cota);
    const latestBefore=file('users/'+UID+'/sessions/workspace-chat/latest.json');
    await chat.deleteSession(UID,'workspace-chat','older',cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal(file('users/'+UID+'/sessions/workspace-chat/latest.json'),latestBefore);
    assert.deepEqual((await chat.listSessions(UID,'workspace-chat')).map(s=>s.sessionId),['newer']);
});

test('excluir duas vezes não libera cota em duplicidade',async()=>{
    reset();
    await chat.saveSession(UID,'chat-suporte','repeat',session('uma sessão'),cota);
    await chat.deleteSession(UID,'chat-suporte','repeat',cota);
    const after=quotaBytes();
    await chat.deleteSession(UID,'chat-suporte','repeat',cota);
    assert.equal(quotaBytes(),after);
    assert.equal(quotaBytes(),physicalBytes());
});

test('falha parcial de exclusão credita somente objetos realmente removidos',async()=>{
    reset();
    await chat.saveSession(UID,'sol','a',session('um'),cota);
    await chat.saveSession(UID,'sol','b',session('dois'),cota);
    const index='users/'+UID+'/sessions/sol/_index.json';
    failWrite=index;
    await assert.rejects(chat.deleteSession(UID,'sol','b',cota),/GCS write rejected/);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal(await chat.loadSession(UID,'sol','b'),null);
    assert.equal((await chat.listSessions(UID,'sol')).length,2);
    failWrite=null;
    await chat.deleteSession(UID,'sol','b',cota);
    assert.equal(quotaBytes(),physicalBytes());
    assert.equal((await chat.listSessions(UID,'sol')).length,1);
});

test('ACK de exclusão GCS perdido é verificado por 404 e não duplica crédito',async()=>{
    reset();
    await chat.saveSession(UID,'sol','ack',session('persistida'),cota);
    loseDeleteAck='users/'+UID+'/sessions/sol/ack.json';
    await chat.deleteSession(UID,'sol','ack',cota);
    assert.equal(quotaBytes(),physicalBytes());
    await chat.deleteSession(UID,'sol','ack',cota);
    assert.equal(quotaBytes(),physicalBytes());
});

test('erro de delete antes da remoção preserva débito e permite retry',async()=>{
    reset();
    await chat.saveSession(UID,'workspace-chat','blocked',session('texto'),cota);
    const sessionFile='users/'+UID+'/sessions/workspace-chat/blocked.json';
    failDeletePath=sessionFile;
    await assert.rejects(chat.deleteSession(UID,'workspace-chat','blocked',cota),/GCS delete rejected/);
    assert.equal(quotaBytes(),physicalBytes());
    assert.ok(gcs.has(sessionFile));
    failDeletePath=null;
    await chat.deleteSession(UID,'workspace-chat','blocked',cota);
    assert.equal(quotaBytes(),physicalBytes());
});

test('ACK da transação de crédito perdido não permite devolução duplicada',async()=>{
    reset();
    await chat.saveSession(UID,'chat-suporte','ack-tx',session('hello'),cota);
    loseTxAck=true;
    await assert.rejects(chat.deleteSession(UID,'chat-suporte','ack-tx',cota),/Firestore acknowledgement lost/);
    const charged=quotaBytes();
    assert.equal(charged,physicalBytes());
    await chat.deleteSession(UID,'chat-suporte','ack-tx',cota);
    assert.equal(quotaBytes(),charged);
});

test('exclusão de sessão legada sem tracker nunca cria crédito presumido',async()=>{
    reset();
    const base='users/'+UID+'/sessions/sol/';
    gcs.set(base+'old.json',Buffer.from(JSON.stringify({sessionId:'old',messages:[]})));
    gcs.set(base+'_index.json',Buffer.from(JSON.stringify([{sessionId:'old'}])));
    gcs.set(base+'latest.json',Buffer.from(JSON.stringify({sessionId:'old'})));
    const previouslyUsed=3000;
    docs.set('clientes_premium/'+EMAIL,{data:{storage_usado_mb:previouslyUsed/(1024*1024)},revision:++seq});
    await chat.deleteSession(UID,'sol','old',cota);
    assert.equal(quotaBytes(),previouslyUsed);
    assert.equal(physicalBytes(),2); // remaining _index.json is []
    await chat.deleteSession(UID,'sol','old',cota);
    assert.equal(quotaBytes(),previouslyUsed);
});

test('chamadores antigos sem cota continuam podendo excluir sessão',async()=>{
    reset();
    await chat.saveSession(UID,'sol','legacy',session('sem cota'));
    await chat.deleteSession(UID,'sol','legacy');
    assert.equal(await chat.loadSession(UID,'sol','legacy'),null);
    assert.equal(quotaBytes(),0);
});
