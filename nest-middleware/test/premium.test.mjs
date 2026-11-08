import {test} from 'node:test';
import assert from 'node:assert/strict';
import {decidePremium} from '../dist/premium.js';
import {PremiumAccessModule} from '../dist/premium.module.js';

const NOW=Date.parse('2026-11-06T12:00:00.000Z');
const past='2024-01-01T00:00:00.000Z';
const future='2099-01-01T00:00:00.000Z';
function makeReader(records={},options={}){
 const calls=[];
 return {calls,async findByEmail(email){
   calls.push(email);
   if(options.fail)throw Error('simulated Firestore outage');
   return records[email]??null;
 }};
}
test('no session and free session never inherit Premium without DB proof',async()=>{
 const reader=makeReader();
 assert.deepEqual(await decidePremium({},reader,NOW),{allow:false,reason:'session'});
 assert.deepEqual(await decidePremium({session:{user:{email:'free@example.com',is_active:false}}},reader,NOW),
   {allow:false,reason:'inactive'});
 assert.equal(reader.calls.length,1);
});
test('active session avoids a redundant DB call',async()=>{
 const reader=makeReader();
 assert.deepEqual(await decidePremium({session:{user:{email:'paid@example.com',is_active:true,premium_ate:future}}},reader,NOW),{allow:true});
 assert.equal(reader.calls.length,0);
});
test('expired Premium is renewed only after an active future database record',async()=>{
 const reader=makeReader({'paid@example.com':{is_active:true,plano:'essencial',premium_ate:future}});
 const user={email:'PAID@EXAMPLE.COM',is_active:true,plano:'essencial',premium_ate:past};
 assert.deepEqual(await decidePremium({session:{user}},reader,NOW),{allow:true});
 assert.equal(user.premium_ate,future);
 assert.equal(user.is_active,true);
 assert.deepEqual(reader.calls,['paid@example.com']);
});
test('expired session without renewal downgrades to free; DB outage never grants access',async()=>{
 for(const reader of [makeReader(),makeReader({}, {fail:true})]){
   const user={email:'paid@example.com',is_active:true,plano:'essencial',premium_ate:past};
   assert.deepEqual(await decidePremium({session:{user}},reader,NOW),{allow:false,reason:'expired'});
   assert.equal(user.is_active,false);
   assert.equal(user.plano,'free');
 }
});
test('inactive session rechecks a successful webhook renewal and rejects missing email',async()=>{
 const reader=makeReader({'paid@example.com':{is_active:true,plano:'essencial',premium_ate:future}});
 const user={email:'Paid@Example.com',is_active:false,plano:'free'};
 assert.deepEqual(await decidePremium({session:{user}},reader,NOW),{allow:true});
 assert.equal(user.is_active,true);
 assert.equal(user.plano,'essencial');
 assert.deepEqual(reader.calls,['paid@example.com']);
 assert.deepEqual(await decidePremium({session:{user:{is_active:false}}},reader,NOW),
   {allow:false,reason:'inactive'});
});

test('inactive sessions cannot regain access from expired, missing or invalid Firestore deadlines',async()=>{
 for(const deadline of [past,null,'not-a-date','']){
   const reader=makeReader({'paid@example.com':{
     is_active:true,plano:'essencial',premium_ate:deadline
   }});
   const user={email:'PAID@example.com',is_active:false,plano:'free'};
   assert.deepEqual(await decidePremium({session:{user}},reader,NOW),
     {allow:false,reason:'inactive'},String(deadline));
   assert.equal(user.is_active,false);
   assert.equal(user.plano,'free');
   assert.deepEqual(reader.calls,['paid@example.com']);
 }
});
test('Premium module refuses to start without an explicitly injected reader',()=>{
  assert.throws(()=>PremiumAccessModule.register(null),/requires a PremiumStatusReader/);
  assert.throws(()=>PremiumAccessModule.register({}),/requires a PremiumStatusReader/);
});
