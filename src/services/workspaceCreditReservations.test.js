'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync(__dirname+'/workspaceCreditReservations.js','utf8');
function setup(wallet=5){
 const docs=new Map([['clientes_premium/user@example.com',{creditos:wallet}]]),calls=[];
 const FV={increment:x=>({inc:x}),serverTimestamp:()=>({serverTime:true})};
 const makeRef=key=>({key,collection:n=>({doc:id=>makeRef(key+'/'+n+'/'+id)})});
 const db={collection:name=>({doc:id=>makeRef(name+'/'+id)}),
  async runTransaction(fn){
    const writes=[],tx={
     async get(ref){const d=docs.get(ref.key);return {exists:!!d,data:()=>d?{...d}:null};},
     update(ref,v){writes.push([ref.key,v,'update']);},
     set(ref,v){writes.push([ref.key,v,'set']);}
    };
    const result=await fn(tx);
    for(const[k,delta]of writes){
      const old=docs.get(k)||{},next={...old};
      for(const [field,val]of Object.entries(delta))next[field]=val&&typeof val==='object'&&'inc'in val?(old[field]||0)+val.inc:val;
      docs.set(k,next);calls.push({path:k,delta});
    }
    return result;
  }};
 const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,require(id){
  if(id==='node:crypto')return {randomUUID:()=>''};
  if(id==='./firebase')return {db,admin:{firestore:{FieldValue:FV}}};
  throw Error('unexpected '+id);
 },Date,Math,Number,console}, {filename:'workspaceCreditReservations.js'});
 return {api:module.exports,docs,calls};
}
const id='11111111-1111-4111-8111-111111111111',email='user@example.com';
test('reserva limita despesa e reembolsa a diferença da medição real',async()=>{
 const f=setup(5);
 assert.equal((await f.api.reservarWorkspace(email,id)).creditosReservados,5);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,0);
 await f.api.iniciarWorkspace(email,id);
 const paid=await f.api.liquidarWorkspace(email,id,{input:1500,output:400});
 assert.equal(paid.creditos,2);assert.equal(paid.descobertos,0);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,3);
 const again=await f.api.liquidarWorkspace(email,id,{input:1500,output:400});
 assert.equal(again.idempotente,true);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,3);
});
test('cancelamento antes de chamar provedor libera toda a reserva',async()=>{
 const f=setup(3);
 await f.api.reservarWorkspace(email,id);
 const settled=await f.api.liquidarWorkspace(email,id,{});
 assert.equal(settled.creditos,0);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,3);
});
test('chamada ambígua reserva integralmente e registra estimativa',async()=>{
 const f=setup(4);
 await f.api.reservarWorkspace(email,id);await f.api.iniciarWorkspace(email,id);
 const settled=await f.api.liquidarWorkspace(email,id,{});
 assert.equal(settled.creditos,4);assert.equal(settled.estimado,true);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,0);
});
test('uso real acima da reserva nunca deixa saldo negativo e registra excedente',async()=>{
 const f=setup(2);await f.api.reservarWorkspace(email,id);await f.api.iniciarWorkspace(email,id);
 const settled=await f.api.liquidarWorkspace(email,id,{input:5000,output:1000});
 assert.equal(settled.creditos,2);assert.equal(settled.descobertos,4);
 assert.equal(f.docs.get('clientes_premium/'+email).creditos,0);
});
test('não reserva duas vezes o mesmo requestId e bloqueia sem créditos',async()=>{
 const f=setup(1);await f.api.reservarWorkspace(email,id);
 await assert.rejects(f.api.reservarWorkspace(email,id),/já reservada/);
 const next='22222222-2222-4222-8222-222222222222';
 await assert.rejects(f.api.reservarWorkspace(email,next),/insuficientes/);
});
