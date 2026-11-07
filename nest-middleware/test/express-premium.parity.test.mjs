import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {decidePremium} from '../dist/premium.js';

const require=createRequire(import.meta.url);
const EXPRESS_GUARD_SOURCE=readFileSync(new URL('../../src/middlewares/authGuard.js',import.meta.url),'utf8');
const past='2020-01-01T00:00:00.000Z';
const future='2099-01-01T00:00:00.000Z';
const clone=value=>value==null?value:JSON.parse(JSON.stringify(value));

function loadExpressPremium(records,fail=false){
  const calls=[];
  const db={
    collection(name){
      assert.equal(name,'clientes_premium','the adapter must read the production entitlement collection');
      return {doc(email){
        calls.push(email);
        return {async get(){
          if(fail)throw Error('simulated Firestore failure');
          const record=records[email]??null;
          return {exists:record!==null,data:()=>clone(record)};
        }};
      }};
    }
  };
  const module={exports:{}};
  runInNewContext(EXPRESS_GUARD_SOURCE,{
    module,exports:module.exports,Date,
    console:{warn(){},error(){}},
    require(id){
      if(id==='../services/firebase')return {db};
      if(id==='./accessPolicy.js')return require('../../src/middlewares/accessPolicy.js');
      throw Error('unexpected runtime dependency '+id);
    },
  },{filename:'authGuard.js'});
  assert.equal(typeof module.exports.exigirPlanoAtivo,'function');
  return {handler:module.exports.exigirPlanoAtivo,calls};
}
async function expressOutcome(legacy,user){
  const state={status:200,body:null,location:null,next:0};
  const req={path:'/api/compiler',session:user==null?undefined:{user},get(name){
    return name==='accept'?'application/json':'';
  }};
  const res={
    status(code){state.status=code;return this;},
    json(body){state.body=body;return this;},
    redirect(url){state.status=302;state.location=url;return this;}
  };
  await legacy.handler(req,res,()=>{state.next++;});
  return {state,user:req.session?.user};
}

const fixtures=[
 {name:'anonymous',user:null,records:{},expected:'session',dbCalls:0},
 {name:'valid Premium session',user:{email:'PAID@example.com',is_active:true,premium_ate:future},records:{},expected:'allow',dbCalls:0},
 {name:'free plan without database entitlement',user:{email:'free@example.com',is_active:false,plano:'free'},records:{},expected:'inactive',dbCalls:1},
 {name:'expired and not renewed',user:{email:'paid@example.com',is_active:true,plano:'essencial',premium_ate:past},records:{},expected:'expired',dbCalls:1},
 {name:'expired after webhook renewal',user:{email:'PAID@example.com',is_active:true,plano:'essencial',premium_ate:past},
  records:{'paid@example.com':{is_active:true,plano:'essencial',premium_ate:future}},expected:'allow',dbCalls:1},
 {name:'inactive session refreshed by webhook',user:{email:'Paid@Example.com',is_active:false,plano:'free'},
  records:{'paid@example.com':{is_active:true,plano:'essencial',premium_ate:future}},expected:'allow',dbCalls:1},
 {name:'Firestore unavailable denies expired Premium',user:{email:'paid@example.com',is_active:true,plano:'essencial',premium_ate:past},
  records:{},fail:true,expected:'expired',dbCalls:1},
 {name:'Firestore unavailable denies inactive session',user:{email:'free@example.com',is_active:false,plano:'free'},
  records:{},fail:true,expected:'inactive',dbCalls:1},
];
test('legacy Express Premium and Nest decisions agree across eight offline scenarios',async()=>{
  for(const scenario of fixtures){
    const legacy=loadExpressPremium(scenario.records,scenario.fail);
    const express=await expressOutcome(legacy,clone(scenario.user));
    const calls=[];
    const nestUser=clone(scenario.user);
    const reader={async findByEmail(email){
      calls.push(email);
      if(scenario.fail)throw Error('simulated Firestore failure');
      return clone(scenario.records[email]??null);
    }};
    const result=await decidePremium(nestUser==null?{}:{session:{user:nestUser}},reader);
    const outcome=result.allow?'allow':result.reason;
    assert.equal(outcome,scenario.expected,scenario.name+' Nest decision');
    assert.equal(express.state.next>0,result.allow,scenario.name+' authorization mismatch');
    assert.equal(express.state.next,result.allow?1:0,scenario.name+' callback count');
    assert.equal(express.state.status,result.allow?200:scenario.expected==='session'?401:403,
      scenario.name+' HTTP status');
    assert.equal(legacy.calls.length,scenario.dbCalls,scenario.name+' Express DB calls');
    assert.equal(calls.length,scenario.dbCalls,scenario.name+' Nest DB calls');
    assert.deepEqual(calls,legacy.calls,scenario.name+' DB lookup key normalization');
    assert.equal(express.user?.is_active,nestUser?.is_active,scenario.name+' session activation');
    assert.equal(express.user?.plano,nestUser?.plano,scenario.name+' session plan');
    assert.equal(express.user?.premium_ate,nestUser?.premium_ate,scenario.name+' expiry sync');
    if(scenario.expected==='session'){
      assert.equal(express.state.body.erro,'Sessão expirada. Faça login novamente.');
    }
    if(scenario.expected==='inactive'){
      assert.equal(express.state.body.plano_necessario,'premium');
    }
  }
});
