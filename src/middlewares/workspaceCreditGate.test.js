'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {criarGateCreditosWorkspace}=require('./workspaceCreditGate');
async function simulate(data,{exists=true,offline=false,plan='free',email='USER@TEST.COM'}={}) {
 const db={collection(name){assert.equal(name,'clientes_premium');return{doc(key){assert.equal(key,'user@test.com');return{async get(){if(offline)throw Error('unavailable');return{exists,data:()=>data};}}}}}};
 const gate=criarGateCreditosWorkspace({db});
 const req={session:{user:{email,plano:plan}},body:{model:'gpt-5.4'}};
 const res={code:200,body:null,status(n){this.code=n;return this;},json(x){this.body=x;return this;}};
 let next=false;await gate(req,res,()=>{next=true;});
 return {next,code:res.code,body:res.body};
}
test('free, starter, pro, studio e premium usam o mesmo saldo Gemini',async()=>{
 for(const plan of ['free','starter','pro','studio','premium']){
  const v=await simulate({creditos:5,creditos_expira_em:'2099-01-01'},{plan});
  assert.equal(v.next,true);assert.equal(v.code,200);
 }
});
test('saldo zero, expirado, ausente ou Firestore offline são bloqueados',async()=>{
 for(const [data,opts,code,status] of [
 [{creditos:0},{},'SEM_CREDITOS',402],
 [{creditos:5,creditos_expira_em:'2000-01-01'},{},'CREDITOS_EXPIRADOS',402],
 [null,{exists:false},'SEM_CREDITOS',402],
 [null,{offline:true},'SALDO_INDISPONIVEL',503],
 ]){const v=await simulate(data,opts);assert.equal(v.code,status);assert.equal(v.body.codigo,code);assert.equal(v.next,false);}
});
test('usuário sem sessão não consome IA',async()=>{
 const v=await simulate({creditos:4},{email:''});assert.equal(v.code,401);assert.equal(v.next,false);
});
