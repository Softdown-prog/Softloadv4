'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {criarGateCreditosWorkspace}=require('./workspaceCreditGate');
function fixture(data, now=Date.parse('2026-10-26T12:00:00.000Z')){
  const queries=[];
  const db={collection(name){queries.push(name);return {doc(email){queries.push(email);return {async get(){return {exists:true,data:()=>data};}};}};}};
  const middleware=criarGateCreditosWorkspace({db,clock:()=>now});
  return async()=>{
    let next=0;let status=200;let response;
    const req={session:{user:{email:'TEST@EXAMPLE.COM',plano:'free'}}};
    const res={status(code){status=code;return this;},json(body){response=body;return body;}};
    await middleware(req,res,()=>{next++;});
    return {status,response,next,queries};
  };
}
test('Firestore Timestamp futuro autoriza, Timestamp vencido bloqueia',async()=>{
  const now=Date.parse('2026-10-26T12:00:00Z');
  const ok=await fixture({creditos:2,creditos_expira_em:{toDate(){return new Date(now+1000);}}},now)();
  assert.equal(ok.next,1);
  assert.deepEqual(ok.queries,['clientes_premium','test@example.com']);
  const expired=await fixture({creditos:2,creditos_expira_em:{toDate(){return new Date(now-1000);}}},now)();
  assert.equal(expired.next,0);
  assert.equal(expired.status,402);
  assert.equal(expired.response.codigo,'CREDITOS_EXPIRADOS');
});
test('prazo inválido e crédito não-finito nunca liberam IA',async()=>{
  for(const data of [
    {creditos:10,creditos_expira_em:'not-a-date'},
    {creditos:NaN},
    {creditos:Infinity},
    {creditos:-1},
    {creditos:'10'}
  ]){
    const r=await fixture(data)();
    assert.equal(r.next,0);
    assert.equal(r.status,402);
  }
});
