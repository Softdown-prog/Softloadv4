'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {modoCreditosSolarisV2,criarGateCreditosSolarisV2,debitoLegadoSolaris}=require('./aiCreditsV2Mode');
function makeResponse(){
  return {code:200,body:null,status(n){this.code=n;return this},json(body){this.body=body;return this}};
}
test('modo V2 nao habilita sem guard Pro e Flash simultaneos',()=>{
  assert.equal(modoCreditosSolarisV2({}),'legado');
  assert.equal(modoCreditosSolarisV2({SOLARIS_AI_CREDITS_V2:'true'}),'configuracao_incompleta');
  assert.equal(modoCreditosSolarisV2({SOLARIS_AI_CREDITS_V2:'true',SOLARIS_AI_BUDGET_ENFORCE:'true'}),'configuracao_incompleta');
  assert.equal(modoCreditosSolarisV2({SOLARIS_AI_CREDITS_V2:'true',SOLARIS_AI_BUDGET_FLASH:'true'}),'configuracao_incompleta');
  assert.equal(modoCreditosSolarisV2({SOLARIS_AI_CREDITS_V2:'true',SOLARIS_AI_BUDGET_ENFORCE:'true',SOLARIS_AI_BUDGET_FLASH:'true'}),'ativo');
});
test('modo legado continua usando apenas middleware legado',async()=>{
  let legacy=0,queries=0,next=0;
  const gate=criarGateCreditosSolarisV2({modo:()=> 'legado',
    verificarLegado(_req,_res,fn){legacy++;fn();},async consultar(){queries++;throw Error('never')}});
  await gate({session:{user:{email:'x@y.test'}}},makeResponse(),()=>{next++});
  assert.deepEqual([legacy,queries,next],[1,0,1]);
});
test('V2 rejeita configuracao incompleta sem consultar nem cobrar',async()=>{
  let calls=0;const gate=criarGateCreditosSolarisV2({modo:()=> 'configuracao_incompleta',
    verificarLegado(){calls++},async consultar(){calls++}});
  const res=makeResponse();await gate({session:{user:{email:'x@y.test'}}},res,()=>{calls++});
  assert.equal(res.code,503);assert.equal(calls,0);
});
test('V2 bloqueia debito esgotado, falha de banco e ciclo expirado sem fail open',async()=>{
  for(const [query,status] of [
    [async()=>({limiteMicroBrl:20000,gastoMicroBrl:10001,reservadoMicroBrl:0}),402],
    [async()=>{throw Error('Firestore secret 123')},503],
    [async()=>{throw Object.assign(Error('ciclo'),{codigo:'CICLO_EXPIRADO'})},402],
  ]) {
    let next=0;const gate=criarGateCreditosSolarisV2({modo:()=> 'ativo',
      verificarLegado(){throw Error('legacy run')},consultar:query});
    const res=makeResponse();await gate({session:{user:{email:'user@example.test'}}},res,()=>next++);
    assert.equal(next,0);assert.equal(res.code,status);assert.ok(!JSON.stringify(res.body).includes('secret'));
  }
});
test('V2 consulta somente email autenticado e libera chamadas com orçamento',async()=>{
  let asked='';let next=0;const gate=criarGateCreditosSolarisV2({
    modo:()=> 'ativo',verificarLegado(){throw Error('legacy blocked')},
    async consultar(email){asked=email;return {limiteMicroBrl:500000,gastoMicroBrl:200000,reservadoMicroBrl:0}},
  });
  const res=makeResponse();await gate({session:{user:{email:'me@example.test'}},body:{email:'attacker@example.test'}},res,()=>next++);
  assert.equal(asked,'me@example.test');assert.equal(next,1);
});
test('V2 desativa segunda cobranca de token mantendo legado nos outros modos',async()=>{
  let calls=0;const legacy=async()=>{calls++;return 3};
  const noDebit=debitoLegadoSolaris('ativo',legacy);
  assert.equal(await noDebit('x@y.test',1000,0),0);
  assert.equal(calls,0);
  assert.equal(await debitoLegadoSolaris('legado',legacy)('x@y.test',1000,0),3);
  assert.equal(calls,1);
});
