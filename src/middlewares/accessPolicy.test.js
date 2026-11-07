'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {decideAccess,wantsJson}=require('./accessPolicy.js');
const req=(session,path='/dashboard')=>({path,session,get:(name)=>
  name==='accept'?'text/html':name==='x-requested-with'?'':'undefined'});
test('legacy session decisions are strict, and APIs get JSON instead of redirect',()=>{
  assert.deepEqual(decideAccess('session',req(null)),{allow:false,reason:'session-required',transport:'navigation'});
  assert.deepEqual(decideAccess('session',req({},'/api/private')),{allow:false,reason:'session-required',transport:'json'});
  assert.deepEqual(decideAccess('session',req({user:{uid:'abc'}})),{allow:true});
  assert.equal(wantsJson(req({},'/api/private')),true);
  assert.equal(wantsJson({...req({}),get:(k)=>k==='accept'?'application/json':''}),true);
  assert.equal(wantsJson({...req({}),get:(k)=>k==='x-requested-with'?'XMLHttpRequest':''}),true);
});
test('admin and worker decisions always conceal unauthorized access',()=>{
  assert.equal(decideAccess('admin',req({user:{is_super_admin:true}})).allow,true);
  for(const user of [{},{is_super_admin:1},{is_super_admin:'true'},null]){
    assert.deepEqual(decideAccess('admin',req({user})),{allow:false,reason:'not-found'});
  }
  assert.equal(decideAccess('worker',req({user:{email:'SOFTLOADY@GMAIL.COM'}})).allow,true);
  for(const email of ['other@example.com','softloady@gmail.com.evil',null,{}]){
    assert.deepEqual(decideAccess('worker',req({user:{email}})),{allow:false,reason:'not-found'});
  }
  assert.throws(()=>decideAccess('unknown',req({})),/Unknown access scope/);
});
