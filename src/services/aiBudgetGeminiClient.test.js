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

test('Flash fica sem reserva quando não há opt-in da proteção separada',async()=>{
  const h=harness();
  const stream=await h.client.models.generateContentStream(h.model('gemini-2.5-flash'));
  for await (const chunk of stream) assert.equal(chunk.text,'ok');
  assert.equal(h.steps.filter(s=>s[0]==='reservar').length,0);
});
function flashHarness(streamFactory,options={}) {
  const steps=[];let calls=0;
  const sdk={
    models:{
      async generateContent(input){calls++;steps.push(['gemini_model',input.config.maxOutputTokens]);
        return {text:'ok',usageMetadata:{promptTokenCount:900,candidatesTokenCount:100}};
      },
      async generateContentStream(input){calls++;steps.push(['gemini_stream',input.config.maxOutputTokens]);return streamFactory();},
    },
    chats:{create(){throw Error('not used')}}
  };
  const ledger={
    async reservar(data){steps.push(['reservar',data]);if(options.failReserve)throw Error('budget blocked');return {status:'reservado',reciboId:'fake-id'};},
    async liquidar(data){steps.push(['liquidar',data]);return 'liquidado';},
  };
  const client=criarClienteGeminiComOrcamento(()=>sdk,{
    email:'user@example.test',livro:ledger,modeloPro:'gemini-2.5-pro',
    modeloFlash:'gemini-2.5-flash',protegerFlash:true,cambioBrlPorUsd:5.2,maxOutputTokens:4096
  })();
  const input={model:'gemini-2.5-flash',contents:'Flash request',config:{temperature:0,maxOutputTokens:60000}};
  return {client,steps,input,get calls(){return calls}};
}
test('Flash não-stream reserva e liquida pelo custo do modelo barato',async()=>{
  const h=flashHarness(async function*(){yield {text:'unused'}});
  await h.client.models.generateContent(h.input);
  assert.deepEqual(h.steps.map(x=>x[0]),['reservar','gemini_model','liquidar']);
  assert.equal(h.steps[1][1],4096);
  assert.ok(h.steps[2][1].custoRealMicroBrl < h.steps[0][1].reservaMicroBrl);
});
test('Flash stream reserva antes de enviar e liquida conforme metadados do último chunk',async()=>{
  const h=flashHarness(async function*(){
    yield {text:'hello'};
    yield {text:'world',usageMetadata:{promptTokenCount:2000,candidatesTokenCount:500,thoughtsTokenCount:200}};
  });
  const stream=await h.client.models.generateContentStream(h.input);
  assert.equal(h.steps.length,0); // sem iniciar iteração, não envia nem reserva
  const chunks=[];
  for await (const c of stream) chunks.push(c.text);
  assert.deepEqual(chunks,['hello','world']);
  assert.deepEqual(h.steps.map(x=>x[0]),['reservar','gemini_stream','liquidar']);
  assert.equal(h.steps[1][1],4096);
  const expected=Math.ceil(Math.ceil(2000*0.3+700*2.5)*5.2);
  assert.equal(h.steps[2][1].custoRealMicroBrl,expected);
  assert.ok(h.steps[0][1].reservaMicroBrl>expected);
});
test('Flash stream sem saldo não envia requisição paga',async()=>{
  const h=flashHarness(async function*(){yield {text:'not reached'}},{failReserve:true});
  await assert.rejects(async()=>{
    const stream=await h.client.models.generateContentStream(h.input);
    for await(const _ of stream){}
  },/budget blocked/);
  assert.equal(h.calls,0);
  assert.deepEqual(h.steps.map(x=>x[0]),['reservar']);
});
test('stream interrompido liquida reserva inteira; não presume custo parcial',async()=>{
  const h=flashHarness(async function*(){
    yield {text:'part 1',usageMetadata:{promptTokenCount:25,candidatesTokenCount:1}};
    yield {text:'part 2'};
  });
  const stream=await h.client.models.generateContentStream(h.input);
  for await (const _ of stream) break;
  assert.deepEqual(h.steps.map(x=>x[0]),['reservar','gemini_stream','liquidar']);
  assert.equal(h.steps[2][1].custoRealMicroBrl,h.steps[0][1].reservaMicroBrl);
});
test('stream que falha ou não retorna metadados cobra a reserva como estimativa',async()=>{
  for(const factory of [
    async function*(){yield {text:'ok'};},
    async function*(){yield {text:'first'};throw Error('network lost');},
  ]) {
    const h=flashHarness(factory);
    const stream=await h.client.models.generateContentStream(h.input);
    try {for await(const _ of stream){}}
    catch(e){assert.match(e.message,/network lost/);}
    assert.deepEqual(h.steps.map(x=>x[0]),['reservar','gemini_stream','liquidar']);
    assert.equal(h.steps[0][1].reservaMicroBrl,h.steps[2][1].custoRealMicroBrl);
  }
});

test('contexto do recibo identifica projeto e ferramenta sem copiar prompt da chamada',async()=>{
  const steps=[];const ledger={
    async reservar(data){steps.push(['reserva',data]);return {status:'reservado',reciboId:'receipt'};},
    async liquidar(data){steps.push(['liquida',data]);return 'liquidado';},
  };
  const sdk={models:{async generateContent(){return {text:'ok',usageMetadata:{promptTokenCount:200,candidatesTokenCount:100}};}},
    chats:{create(){throw Error('not used');}}};
  const client=criarClienteGeminiComOrcamento(()=>sdk,{
    email:'user@example.test',livro:ledger,modeloPro:'gemini-2.5-pro',
    ferramenta:'solaris-chat',projeto:'session-abc123',cambioBrlPorUsd:5.2,
  })();
  await client.models.generateContent({model:'gemini-2.5-pro',contents:'secret sensitive prompt',config:{temperature:0,maxOutputTokens:1024}});
  assert.deepEqual(steps[0][1].contexto,{ferramenta:'solaris-chat',modelo:'gemini-2.5-pro',projeto:'session-abc123'});
  assert.equal(steps[1][1].estimado,false);
  assert.ok(!JSON.stringify(steps).includes('secret sensitive prompt'));
});
test('ausência de usageMetadata sinaliza custo estimado no extrato',async()=>{
  const steps=[];const ledger={
    async reservar(data){steps.push(data);return {status:'reservado',reciboId:'receipt'};},
    async liquidar(data){steps.push(data);}
  };
  const sdk={models:{async generateContent(){return {text:'ok'};}},chats:{create(){throw Error('not used');}}};
  const client=criarClienteGeminiComOrcamento(()=>sdk,{
    email:'user@example.test',livro:ledger,modeloPro:'gemini-2.5-pro',ferramenta:'solaris-upload',
    cambioBrlPorUsd:5.2,
  })();
  await client.models.generateContent({model:'gemini-2.5-pro',contents:'inspect ZIP',config:{temperature:0,maxOutputTokens:2048}});
  assert.equal(steps[0].contexto.ferramenta,'solaris-upload');
  assert.equal(steps[1].estimado,true);
});

test('auditoria multimodal reserva custo por imagem limitado em vez de contar Base64 como texto', async () => {
    const h=harness();
    const pngData=Buffer.alloc(400*1024).toString('base64');
    const params={
        model:'gemini-2.5-pro',
        config:{temperature:0,maxOutputTokens:1024},
        contents:[{role:'user',parts:[
            {text:'Avalie este layout'},
            {inlineData:{mimeType:'image/png',data:pngData}},
        ]}],
    };
    const result=await h.client.models.generateContent(params);
    assert.equal(result.text,'ok');
    assert.deepEqual(h.steps.map(x=>x[0]),['reservar','enviar_modelo','liquidar']);
    assert.ok(h.steps[0][1].reservaMicroBrl<500000,
        'Reserva de foto deve ser conservadora mas não deve cobrar centenas de milhares de tokens Base64');
});
test('bloqueia PNG multimodal maior que 512 KiB antes do provedor', async () => {
    const h=harness();
    const params={
        model:'gemini-2.5-pro', config:{temperature:0,maxOutputTokens:1024},
        contents:[{role:'user',parts:[{inlineData:{
            mimeType:'image/png',data:Buffer.alloc(513*1024).toString('base64'),
        }}]}],
    };
    await assert.rejects(h.client.models.generateContent(params),/IMAGEM_FORA_DO_LIMITE/);
    assert.equal(h.calls.model,0);
});
