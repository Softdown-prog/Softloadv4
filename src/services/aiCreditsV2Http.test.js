'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {criarHandlerResumoCreditosV2}=require('./aiCreditsV2Http');
function res() {
  return {statusCode:200,headers:{},body:null,
    setHeader(key,v){this.headers[key]=v;},
    status(code){this.statusCode=code;return this;},
    json(b){this.body=b;return this;}};
}
const req=(email,body={})=>({session:email?{user:{email}}:undefined,body});
const data={plano:'pro',cicloExpiraEm:'2099-01-01',limiteMicroBrl:5_000_000,gastoMicroBrl:1_000_000,reservadoMicroBrl:500_000};

test('prévia V2 fica desligada por padrão e não consulta Firestore',async()=>{
  const h=criarHandlerResumoCreditosV2({async consultarSaldo(){throw Error('should not read')}});
  const response=res();const before=process.env.AI_CREDITS_V2_PREVIEW;
  delete process.env.AI_CREDITS_V2_PREVIEW;
  try {await h(req('user@example.test'),response);}
  finally {if(before!==undefined)process.env.AI_CREDITS_V2_PREVIEW=before;}
  assert.equal(response.statusCode,404);
  assert.equal(response.headers['Cache-Control'],'no-store, private');
});

test('consulta somente o dono autenticado e responde em créditos, não em reais',async()=>{
  const fetched=[];
  const h=criarHandlerResumoCreditosV2({habilitado:()=>true,async consultarSaldo(email){fetched.push(email);return {...data};}});
  const response=res();
  await h(req('OWNER@example.test',{email:'other@example.test'}),response);
  assert.deepEqual(fetched,['OWNER@example.test']);
  assert.equal(response.statusCode,200);
  assert.equal(response.body.versao,2);
  assert.equal(response.body.modo,'previsualizacao');
  assert.equal(response.body.saldo.creditosDoCiclo,500);
  assert.equal(response.body.saldo.creditosDisponiveis,350);
  assert.equal(JSON.stringify(response.body).includes('MicroBrl'),true); // unidade técnica de referência, sem valores monetários
  assert.equal(response.body.limiteMicroBrl,undefined);
  assert.equal(response.body.gastoMicroBrl,undefined);
  assert.equal(response.body.email,undefined);
});

test('sem sessão nunca consulta banco, mesmo se sinal de prévia estiver ligado',async()=>{
  let consulted=false;
  const h=criarHandlerResumoCreditosV2({habilitado:()=>true,async consultarSaldo(){consulted=true;return data;}});
  const response=res();await h(req(null),response);
  assert.equal(response.statusCode,401);
  assert.equal(consulted,false);
});

test('erros internos não vazam informações de usuários nem Firestore',async()=>{
  const cases=[['CICLO_EXPIRADO',402],['USUARIO_NAO_ENCONTRADO',404],['ANY_INTERNAL',503]];
  for(const [codigo,expected] of cases) {
    const h=criarHandlerResumoCreditosV2({habilitado:()=>true,
      async consultarSaldo(){throw Object.assign(Error('email@example.test firestore-secret'),{codigo});}});
    const response=res();await h(req('owner@example.test'),response);
    assert.equal(response.statusCode,expected);
    assert.ok(!JSON.stringify(response.body).includes('firestore-secret'));
  }
});
test('validação financeira corrompida retorna resposta genérica em vez de NaN',async()=>{
  const h=criarHandlerResumoCreditosV2({habilitado:()=>true,async consultarSaldo(){return {...data,reservadoMicroBrl:-5};}});
  const response=res();await h(req('user@example.test'),response);
  assert.equal(response.statusCode,503);
});
