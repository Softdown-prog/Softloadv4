'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createHarness({saveGate=null,debitGate=null,failSave=false,failDebit=false}={}) {
  const handlers=new Map(), calls=[], events=[];
  const router = { get(){}, delete(){}, post(route,...stack){handlers.set(route,stack.at(-1));} };
  const storage={
    newSessionId(){return 'sess-1';},
    async saveSession(...args){
      if(saveGate) await saveGate;
      calls.push(['save',args]);
      if(failSave) throw Error('GCS indisponível');
      return {messages:args[3].messages};
    },
    async updateMemoryFromSession(){calls.push(['memory']);},
  };
  const mocks={
    'node:crypto': {randomUUID:()=> '2f071443-bd75-4fc3-98d8-d2aacbb626c8'},
    express:{Router:()=>router},
    '../../middlewares/authGuard':{exigirLogin(){},verificarSaldo(){}},
    '../../services/chatStorageService':storage,
    '../../services/chatRequestGate':{async registrarRequisicaoChat(){return 'accepted';}},
    '../../services/firebase':{db:{collection(){return {add(){return Promise.resolve();}}}},admin:{firestore:{FieldValue:{serverTimestamp(){return 0}}}}},
    '../../services/creditService':{async debitarCreditos(...args){if(debitGate)await debitGate;calls.push(['debit',args]);if(failDebit)throw Error('sem Firestore');}},
    './chat/chatGenerationFlow':{async gerarComPossivelTemplate({sendEvent,tokensRef}){
      tokensRef.input=4;tokensRef.output=6;
      sendEvent({type:'chunk',text:'resposta'});
      return {fullText:'resposta'};
    }},
    './chat/chatHistory':{montarHistoricoSeguro(){return [];}},
    '../../solaris/tools/projectStorage':{apagarProjeto(){}},
    './solaris':{SOLARIS_CHAT_SESSION_TYPE:'solaris-chat'},
  };
  const filename=path.join(__dirname,'../chat.js');
  const module={exports:{}};
  vm.runInNewContext(fs.readFileSync(filename,'utf8'),{
    module,exports:module.exports,require(id){if(!(id in mocks))throw Error('module inesperado '+id);return mocks[id];},
    console:{error(){},warn(){}},process:{env:{}},Date,
  },{filename});
  const req={body:{message:'Oi',history:[],sessionId:'sess-1',requestId:'2f071443-bd75-4fc3-98d8-d2aacbb626c8'},session:{user:{uid:'uid-1',email:'cliente@test.invalid',plano:'studio'}}};
  const response={
    setHeader(){},flushHeaders(){},write(wire){events.push(['event',JSON.parse(wire.slice(6).trim())]);},
    end(){events.push(['end']);},
    status(){return this;},json(){return this;},
  };
  return {call:()=>handlers.get('/dashboard/chat/stream')(req,response),calls,events};
}

test('Especialista aguarda gravação e crédito antes de done e fim do stream',async()=>{
  let releaseSave,releaseDebit;
  const saveGate=new Promise(resolve=>{releaseSave=resolve;});
  const debitGate=new Promise(resolve=>{releaseDebit=resolve;});
  const h=createHarness({saveGate,debitGate});
  const pending=h.call();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.some(x=>x[0]==='end'||x[1]?.type==='done'),false);
  releaseSave();
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(h.events.some(x=>x[0]==='end'||x[1]?.type==='done'),false);
  releaseDebit();
  await pending;
  assert.deepEqual(h.calls.filter(c=>c[0]==='save'||c[0]==='debit').map(c=>c[0]),['save','debit']);
  assert.equal(h.events.at(-2)[1].type,'done');
  assert.equal(h.events.at(-2)[1].reply,'resposta');
  assert.equal(h.events.at(-1)[0],'end');
});

test('falha do GCS ainda cobra e avisa o usuário em vez de afirmar que salvou',async()=>{
  const h=createHarness({failSave:true});
  await h.call();
  assert.equal(h.calls.some(c=>c[0]==='debit'),true);
  assert.match(h.events.at(-2)[1].reply,/não consegui salvar esta conversa no histórico/i);
  assert.equal(h.events.at(-1)[0],'end');
});

test('erro de débito não elimina resposta nem histórico do Especialista',async()=>{
  const h=createHarness({failDebit:true});
  await h.call();
  assert.equal(h.calls.some(c=>c[0]==='save'),true);
  assert.match(h.events.at(-2)[1].reply,/não foi possível confirmar a atualização dos créditos/i);
  assert.equal(h.events.at(-1)[0],'end');
});
