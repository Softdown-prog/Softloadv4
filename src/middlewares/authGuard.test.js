'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'authGuard.js'),'utf8');
const realPolicy=require('./accessPolicy.js');
const validDate='2099-12-31T23:59:59.000Z';
const expiredDate='2020-01-01T00:00:00.000Z';

function harness({user={email:'BUYER@EXAMPLE.TEST',plano:'free',is_active:false},
  record={is_active:true,plano:'essencial',premium_ate:validDate},
  dbDown=false,missing=false,api=true}={}){
  const lookups=[];
  const db={
    collection(name){
      assert.equal(name,'clientes_premium');
      return {doc(email){
        lookups.push(email);
        return {async get(){
          if(dbDown)throw Error('simulated Firestore outage');
          return {exists:!missing,data:()=>record};
        }};
      }};
    }
  };
  const module={exports:{}};
  vm.runInNewContext(source,{
    module,exports:module.exports,Date,
    console:{warn(){},error(){}},
    require(id){
      if(id==='../services/firebase')return {db};
      if(id==='./accessPolicy.js')return realPolicy;
      throw Error('Unexpected dependency in production auth guard: '+id);
    }
  },{filename:'authGuard.js',timeout:1500});
  const req={
    path:api?'/api/premium/proof':'/dashboard/gerador-blogger',
    session:user?{user:{...user}}:null,
    get:header=>header==='accept'?(api?'application/json':'text/html'):''
  };
  const result={code:null,json:null,location:null,next:0};
  const res={
    status(code){result.code=code;return this;},
    json(value){result.json=value;return this;},
    redirect(value){result.location=value;return this;}
  };
  async function invoke(){
    await module.exports.exigirPlanoAtivo(req,res,()=>{result.next++;});
    return result;
  }
  return {req,lookups,invoke,result};
}

test('a renewed paid account is activated from Firestore only with a valid future expiration',async()=>{
  const h=harness();
  const result=await h.invoke();
  assert.equal(result.next,1);
  assert.equal(result.code,null);
  assert.deepEqual(h.lookups,['buyer@example.test']);
  assert.equal(h.req.session.user.plano,'essencial');
  assert.equal(h.req.session.user.premium_ate,validDate);
  assert.equal(h.req.session.user.is_active,true);
});

test('stale is_active in Firestore cannot renew expired, missing or invalid paid records',async()=>{
  for(const expiry of [expiredDate,null,'invalid date','']){
    const h=harness({record:{is_active:true,plano:'essencial',premium_ate:expiry}});
    const result=await h.invoke();
    assert.equal(result.next,0,String(expiry));
    assert.equal(result.code,403,String(expiry));
    assert.equal(result.json.plano_necessario,'premium');
    assert.equal(h.req.session.user.is_active,false);
    assert.equal(h.req.session.user.plano,'free');
  }
});

test('missing record, inactive account or unavailable database always deny renewal',async()=>{
  const scenarios=[
    {missing:true},
    {dbDown:true},
    {record:{is_active:false,plano:'essencial',premium_ate:validDate}}
  ];
  for(const scenario of scenarios){
    const h=harness(scenario);
    const result=await h.invoke();
    assert.equal(result.next,0);
    assert.equal(result.code,403);
    assert.equal(h.req.session.user.is_active,false);
  }
});

test('an expired session can be refreshed only after the database confirms a new paid period',async()=>{
  const user={email:'BUYER@EXAMPLE.TEST',plano:'essencial',is_active:true,premium_ate:expiredDate};
  const accepted=harness({user});
  assert.equal((await accepted.invoke()).next,1);
  assert.equal(accepted.req.session.user.premium_ate,validDate);
  const rejected=harness({user,record:{is_active:true,plano:'essencial',premium_ate:expiredDate}});
  assert.equal((await rejected.invoke()).code,403);
  assert.equal(rejected.req.session.user.is_active,false);
  assert.equal(rejected.req.session.user.plano,'free');
});

test('valid session remains allowed without extra DB read, anonymous API receives 401',async()=>{
  const active=harness({user:{email:'buyer@example.test',plano:'essencial',
    is_active:true,premium_ate:validDate}});
  assert.equal((await active.invoke()).next,1);
  assert.deepEqual(active.lookups,[]);
  const anonymous=harness({user:null});
  assert.equal((await anonymous.invoke()).code,401);
  assert.deepEqual(anonymous.lookups,[]);
});

test('HTML navigation stays a redirect and never grants expired premium',async()=>{
  const h=harness({api:false,record:{is_active:true,plano:'essencial',premium_ate:expiredDate}});
  const r=await h.invoke();
  assert.equal(r.next,0);
  assert.equal(r.location,'/dashboard/upgrade');
  assert.equal(r.code,null);
});
