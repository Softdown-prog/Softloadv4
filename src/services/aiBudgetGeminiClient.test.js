'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarClienteGeminiComOrcamento } = require('./aiBudgetGeminiClient');

function harness(options={}) {
  const steps=[];
  let counter=0;
  const calls={model:0,chat:0};
  const ledger={
    async reservar(data) {
      steps.push(['reservar',data]);
      if(options.failReserve) throw Error('ORCAMENTO_INSUFICIENTE');
      return {status:'reservado',reciboId:'r'+(++counter)};
    },
    async liquidar(data) {
      steps.push(['liquidar',data]);
      if(options.failSettle) throw Error('offline');
      return 'liquidado';
    }
  };
  const sdk={
    models:{
      async generateContent(data) {
        steps.push(['enviar_modelo',data.config.maxOutputTokens]);calls.model++;
        if(options.failApi) throw Error('provider connection lost');
        return {text:'ok',usageMetadata:options.usage===undefined?{promptTokenCount:600,candidatesTokenCount:100,thoughtsTokenCount:50}:options.usage};
      },
      async generateContentStream() {steps.push(['stream_flash']);return (async function*(){yield {text:'ok'}})();},
    },
    chats:{create(data) {
      steps.push(['create_chat',data.config.maxOutputTokens]);
      return {async sendMessage({message}) {
        steps.push(['enviar_chat',message]);calls.chat++;
        if(options.failApi) throw Error('provider connection lost');
        return {text:'hello',usageMetadata:{promptTokenCount:500,candidatesTokenCount:50,thoughtsTokenCount:100}};
      }};
    }},
  };
  const client=criarClienteGeminiComOrcamento(()=>sdk,{
    email:'user@example.test',livro:ledger,modeloPro:'gemini-2.5-pro',
    cambioBrlPorUsd:5.2,maxOutputTokens:4096,
  })();
  const model=(name='gemini-2.5-pro')=>({model:name,contents:'write a short template',config:{temperature:0,maxOutputTokens:60000}});
  return {client,steps,calls,model};
}
test('reserva antes de chamar Gemini Pro e liquida com usage real, incluindo pensamento',async()=>{
  const h=harness();
  const res=await h.client.models.generateContent(h.model());
  assert.equal(res.text,'ok');
  assert.deepEqual(h.steps.map(s=>s[0]),['reservar','enviar_modelo','liquidar']);
  assert.equal(h.steps[1][1],4096);
  assert.equal(h.steps[2][1].custoRealMicroBrl,Math.ceil(Math.ceil(600*1.25+150*10)*5.2));
  assert.ok(h.steps[0][1].reservaMicroBrl>h.steps[2][1].custoRealMicroBrl);
  assert.ok(!JSON.stringify(h.steps[0][1]).includes('write a short template'));
});
test('Chat Pro reserva cada turno separadamente, não apenas na criação',async()=>{
  const h=harness();
  const chat=h.client.chats.create({model:'gemini-2.5-pro',config:{temperature:0,maxOutputTokens:60000}});
  await chat.sendMessage({message:'first'});
  await chat.sendMessage({message:'second'});
  assert.equal(h.calls.chat,2);
  assert.deepEqual(h.steps.map(x=>x[0]),['create_chat','reservar','enviar_chat','liquidar','reservar','enviar_chat','liquidar']);
  assert.equal(h.steps[0][1],4096);
  assert.notEqual(h.steps[1][1].operacaoId,h.steps[4][1].operacaoId);
});
test('sem orçamento bloqueia antes de gastar com a API',async()=>{
  const h=harness({failReserve:true});
  await assert.rejects(h.client.models.generateContent(h.model()),/ORCAMENTO_INSUFICIENTE/);
  assert.equal(h.calls.model,0);
});
test('erro depois de enviar liquida valor reservado integral sem liberar saldo',async()=>{
  const h=harness({failApi:true});
  await assert.rejects(h.client.models.generateContent(h.model()),/provider connection lost/);
  assert.equal(h.calls.model,1);
  assert.equal(h.steps[0][1].reservaMicroBrl,h.steps[2][1].custoRealMicroBrl);
});
test('metadados ausentes também liquidam reserva integral como estimativa',async()=>{
  const h=harness({usage:null});
  await h.client.models.generateContent(h.model());
  assert.equal(h.steps[0][1].reservaMicroBrl,h.steps[2][1].custoRealMicroBrl);
});
test('acerto Firestore indisponível não duplica chamada nem esconde reserva retida',async()=>{
  const h=harness({failSettle:true});const old=console.error;console.error=()=>{};
  try {assert.equal((await h.client.models.generateContent(h.model())).text,'ok');}
  finally {console.error=old;}
  assert.equal(h.calls.model,1);
  assert.equal(h.steps.filter(x=>x[0]==='reservar').length,1);
});
test('Flash mantém streaming e não cria reservas de Pro',async()=>{
  const h=harness();
  await h.client.models.generateContent(h.model('gemini-2.5-flash'));
  await h.client.models.generateContentStream(h.model('gemini-2.5-flash'));
  assert.equal(h.steps.filter(x=>x[0]==='reservar').length,0);
  assert.equal(h.calls.model,1);
});
test('Pro streaming, precificação desconhecida e prompt gigante falham antes de enviar',async()=>{
  const h=harness();
  await assert.rejects(h.client.models.generateContentStream(h.model()),/STREAM_PRO_NAO_SUPORTADO/);
  await assert.rejects(h.client.models.generateContent({...h.model(),contents:'a'.repeat(1_000_001)}),/PROMPT_MUITO_GRANDE/);
  assert.equal(h.calls.model,0);
  assert.equal(h.steps.length,0);
  const other=criarClienteGeminiComOrcamento(()=>h.client,{email:'user@example.test',livro:{reservar(){throw Error('should not reach')}} ,modeloPro:'gemini-9-pro',cambioBrlPorUsd:5.2})()
  await assert.rejects(other.models.generateContent(h.model('gemini-9-pro')), /MODELO_NAO_PRECIFICADO/);
});
