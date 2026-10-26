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
 const db={
  collection:name=>({
    doc:id=>makeRef(name+'/'+id),
    where:(field,op,value)=>{
      assert.equal(name,'workspace_recovery_queue');
      assert.equal(field,'criadoMs');assert.equal(op,'<=');
      return {orderBy:field2=>{assert.equal(field2,'criadoMs');return {limit:n=>({async get(){
        return {docs:[...docs.entries()].filter(([key,v])=>key.startsWith('workspace_recovery_queue/')&&v.criadoMs<=value).sort((a,b)=>a[1].criadoMs-b[1].criadoMs).slice(0,n).map(([key,value])=>({id:key.split('/').pop(),data:()=>value}))};
      }})}}};
    }
  }),
  async runTransaction(fn){
    const writes=[],tx={
     async get(ref){const d=docs.get(ref.key);return {exists:!!d,data:()=>d?{...d}:null};},
     update(ref,v){writes.push([ref.key,v,'update']);},
     set(ref,v){writes.push([ref.key,v,'set']);},
     delete(ref){writes.push([ref.key,null,'delete']);}
    };
    const result=await fn(tx);
    for(const[k,delta,kind]of writes){
      if(kind==='delete'){docs.delete(k);continue;}
      const old=docs.get(k)||{},next={...old};
      for(const [field,val]of Object.entries(delta))next[field]=val&&typeof val==='object'&&'inc'in val?(old[field]||0)+val.inc:val;
      docs.set(k,next);calls.push({path:k,delta});
    }
    return result;
  }};
 const module={exports:{}};
 vm.runInNewContext(source,{module,exports:module.exports,require(id){
  if(id==='node:crypto')return {createHash:require('node:crypto').createHash};
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

test('recuperação automática devolve reserva não iniciada e usa estimativa em chamada iniciada',async()=>{
  const f=setup(25);
  const other='22222222-2222-4222-8222-222222222222';
  await f.api.reservarWorkspace(email,id);
  await f.api.reservarWorkspace(email,other);
  await f.api.iniciarWorkspace(email,other);
  // reservas recentes não devem ser recuperadas; após 2h, podem ser.
  const fresh=await f.api.recuperarReservasWorkspace({agora:Date.now()+10_000});
  assert.equal(fresh.recuperadas,0);
  const done=await f.api.recuperarReservasWorkspace({agora:Date.now()+3*60*60*1000});
  assert.equal(done.recuperadas,2);
  // 25 - 12 - 12 + 12 devolvidos = 13
  assert.equal(f.docs.get('clientes_premium/'+email).creditos,13);
  const again=await f.api.recuperarReservasWorkspace({agora:Date.now()+4*60*60*1000});
  assert.equal(again.recuperadas,0);
});

test('não reserva duas vezes o mesmo requestId e bloqueia sem créditos',async()=>{
 const f=setup(1);await f.api.reservarWorkspace(email,id);
 await assert.rejects(f.api.reservarWorkspace(email,id),/já reservada/);
 const next='22222222-2222-4222-8222-222222222222';
 await assert.rejects(f.api.reservarWorkspace(email,next),/insuficientes/);
});
