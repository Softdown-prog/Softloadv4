'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const crypto=require('node:crypto');
const ejs=require('ejs');

const source=fs.readFileSync(path.join(__dirname,'../routes/apiRoutes.js'),'utf8');
const DAY=86400000;
function setup(options={}){
  const routes={get:new Map(),post:new Map()};
  const calls={preferences:0,payments:0,usersUpdated:0,receipts:0};
  const account=options.account||{email:'buyer@example.test',uid:'firebase-user-123',plano:'free',
    is_active:false,plano_pendente:'essencial',nome:'Cliente'};
  const matches=options.missingAccount?[]:[{ref:{kind:'user',update:async data=>{calls.usersUpdated++;Object.assign(account,data)}},data:()=>account}];
  const db={
    collection:name=>({
      where:()=>({limit:()=>({get:async()=>({empty:matches.length===0,docs:matches})}),get:async()=>({empty:true,docs:[]})}),
      doc:id=>({kind:name==='softload_mp_payments'?'receipt':'other',id})
    }),
    runTransaction:async task=>task({
      get:async ref=>ref.kind==='receipt'?{exists:!!options.receiptExists}:{exists:true,data:()=>account},
      create:()=>{calls.receipts++},
      update:(ref,update)=>{calls.usersUpdated++;Object.assign(account,update)}
    }),
    batch:()=>({update(){},async commit(){}})
  };
  const router={
    get:(uri,...handlers)=>routes.get.set(uri,handlers.at(-1)),
    post:(uri,...handlers)=>routes.post.set(uri,handlers.at(-1))
  };
  const env={MP_ACCESS_TOKEN:'test-token',MP_WEBHOOK_SECRET:'test-secret',
    BLOGGER_ESSENCIAL_CHECKOUT_ENABLED:options.checkoutEnabled?'true':'false',
    BASE_URL:'https://softload.analysepro.com',NODE_ENV:'test'};
  const mock={
    express:{Router:()=>router},'express-rate-limit':()=>()=>{},
    '../services/firebase':{db},
    '../services/creditService':{PLAN_CREDITS:{essencial:0,starter:150,pro:600,studio:1200,free:0},
      GPT_PLAN_CREDITS:{essencial:0},BLOGGERAI_PLAN_CREDITS:{essencial:0}},
    '../services/mpPlanRules':require('./mpPlanRules'),
    '../services/storageService':{STORAGE_LIMITS_MB:{}},
    '../services/emailService':{enviarPlanoAtivado:async()=>{}},
    '../middlewares/authGuard':{exigirLogin:()=>{}},
    mercadopago:{
      MercadoPagoConfig:class{},
      Preference:class{async create(){calls.preferences++;return{id:'pref-1',init_point:'https://mercadopago.com.br/checkout'}}},
      Payment:class{
        async create(){calls.payments++;return {id:123,status:'pending',payment_method_id:'pix'};}
        async get(){calls.payments++;return options.paymentDetails||{status:'approved',currency_id:'BRL',transaction_amount:5,external_reference:'buyer@example.test'};}
      }
    }
  };
  const module={exports:{}};
  vm.runInNewContext(source,{
    module,exports:module.exports,console:{log(){},warn(){},error(){}},Buffer,Date,Number,Object,String,RegExp,Promise,
    process:{env},
    require:id=>id==='crypto'?crypto:(mock[id]||(()=>{throw Error('Unexpected import '+id)})())
  },{filename:'apiRoutes.js'});
  const request=(body={},more={})=>({body,query:{},headers:{},
    session:{user:{email:'buyer@example.test',uid:'firebase-user-123',nome:'Cliente'}},
    protocol:'https',get:()=> 'softload.analysepro.com',...more});
  async function post(route,req=request()){
    const handler=routes.post.get(route);assert.ok(handler,'Missing '+route);
    const res={code:200,status(n){this.code=n;return this},json(x){this.body=x;return this},send(x){this.body=x;return this}};
    await handler(req,res);return res;
  }
  function signedRequest(id='123',bodyId=id){
    const ts=String(Date.now()),requestId='request-test-123';
    const signature=crypto.createHmac('sha256',env.MP_WEBHOOK_SECRET)
      .update('id:'+id+';request-id:'+requestId+';ts:'+ts+';').digest('hex');
    return request({type:'payment',action:'payment.updated',data:{id:bodyId}},{
      query:{'data.id':id},headers:{'x-signature':'ts='+ts+',v1='+signature,'x-request-id':requestId}
    });
  }
  return{post,request,signedRequest,calls,account,env};
}
test('legacy AI plans cannot be purchased by either checkout',async()=>{
  const f=setup({checkoutEnabled:true});
  for(const plan of ['starter','pro','studio']){
    assert.equal((await f.post('/dashboard/checkout-create',f.request({plano:plan}))).code,410);
    assert.equal((await f.post('/dashboard/payment/process',f.request({plano:plan,formData:{}}))).code,410);
  }
  assert.equal(f.calls.preferences,0);assert.equal(f.calls.payments,0);
});
test('Essencial cannot charge before feature enablement or if account missing',async()=>{
  const disabled=setup();
  assert.equal((await disabled.post('/dashboard/checkout-create',disabled.request({plano:'essencial',aceitePoliticaArmazenamento:true}))).code,503);
  assert.equal(disabled.calls.preferences,0);
  const f=setup({checkoutEnabled:true,missingAccount:true});
  assert.equal((await f.post('/dashboard/checkout-create',f.request({plano:'essencial',aceitePoliticaArmazenamento:true}))).code,503);
  assert.equal((await f.post('/dashboard/payment/process',f.request({plano:'essencial',formData:{},aceitePoliticaArmazenamento:true}))).code,503);
  assert.equal(f.calls.preferences,0);assert.equal(f.calls.payments,0);
});
test('Essencial valid checkout records pending plan on existing Firebase account',async()=>{
  const f=setup({checkoutEnabled:true});
  const out=await f.post('/dashboard/checkout-create',f.request({plano:'essencial',aceitePoliticaArmazenamento:true}));
  assert.equal(out.code,200);assert.equal(f.calls.preferences,1);assert.equal(f.calls.usersUpdated,1);
  assert.equal(f.account.plano_pendente,'essencial');
});
test('unsigned webhook and mismatched signed payment resource are refused',async()=>{
  const f=setup();
  const req=f.signedRequest();f.env.MP_WEBHOOK_SECRET='';
  assert.equal((await f.post('/webhook/mercado-pago',req)).code,403);
  f.env.MP_WEBHOOK_SECRET='test-secret';
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest('123','456'))).code,403);
  assert.equal(f.calls.payments,0);
});
test('approved payment for missing user causes retry, not silent discard',async()=>{
  const f=setup({missingAccount:true});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,503);
  assert.equal(f.calls.receipts,0);
});
test('valid signed payment extends Essencial and keeps exactly one receipt',async()=>{
  const initial=Date.now()+10*DAY;
  const f=setup({account:{email:'buyer@example.test',uid:'firebase-user-123',plano:'essencial',
    is_active:true,plano_pendente:'essencial',premium_ate:new Date(initial).toISOString(),nome:'Cliente'}});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
  assert.equal(f.calls.receipts,1);assert.equal(f.account.creditos,0);
  assert.equal(f.account.plano_pendente,null);
  assert.ok(Math.abs(Date.parse(f.account.premium_ate)-initial-30*DAY)<30);
});
test('duplicate payment receipt does not renew twice',async()=>{
  const f=setup({receiptExists:true});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
  assert.equal(f.calls.receipts,0);assert.equal(f.calls.usersUpdated,0);
});
test('disabled Essencial view has no payment button',async()=>{
  const file=path.join(__dirname,'../../views/pages/plano-essencial.ejs');
  const disabled=await ejs.renderFile(file,{gitSha:'test',user:{email:'buyer@example.test'},checkoutEnabled:false});
  assert.match(disabled,/Pagamento temporariamente indisponível/);
  assert.doesNotMatch(disabled,/id="pagarEssencial"/);
  const enabled=await ejs.renderFile(file,{gitSha:'test',user:{email:'buyer@example.test'},checkoutEnabled:true});
  assert.match(enabled,/id="pagarEssencial"/);
});
