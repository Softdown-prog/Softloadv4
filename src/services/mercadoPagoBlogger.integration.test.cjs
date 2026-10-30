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
  const calls={preferences:0,payments:0,usersUpdated:0,receipts:0,intentCreates:0,externalRefs:[],idempotencyKeys:[],reviewWrites:0};
  const intents=new Map();
  const reconciliations=new Map();
  const paymentById=options.paymentById||{};
  const account=options.account||{email:'buyer@example.test',uid:'firebase-user-123',plano:'free',
    is_active:false,plano_pendente:'essencial',nome:'Cliente'};
  const matches=options.missingAccount?[]:[{ref:{kind:'user',update:async data=>{calls.usersUpdated++;Object.assign(account,data)}},data:()=>account}];
  const db={
    collection:name=>({
      where:()=>({limit:()=>({get:async()=>({empty:matches.length===0,docs:matches})}),get:async()=>({empty:true,docs:[]})}),
      doc:id=>name==='softload_mp_intents'?{
        kind:'intent',id,
        async create(data){calls.intentCreates++;intents.set(id,{...data})},
        async get(){return{exists:intents.has(id),data:()=>intents.get(id)}}
      }:{kind:name==='softload_mp_payments'?'receipt':name==='softload_mp_reconciliations'?'review':'other',id}
    }),
    runTransaction:async task=>{
      if(options.failTransaction)throw Error('Firestore offline');
      return task({
        get:async ref=>ref.kind==='receipt'?{exists:!!options.receiptExists}:
          ref.kind==='review'?{exists:reconciliations.has(ref.id),data:()=>reconciliations.get(ref.id)}:
          ref.kind==='intent'?{exists:intents.has(ref.id),data:()=>intents.get(ref.id)}:
          {exists:true,data:()=>account},
        create:(ref,value)=>{
          if(ref.kind==='review'){reconciliations.set(ref.id,{...value});calls.reviewWrites++;return}
          calls.receipts++;
        },
        update:(ref,update)=>{
          if(ref.kind==='review'){Object.assign(reconciliations.get(ref.id),update);calls.reviewWrites++;return}
          if(ref.kind==='intent'){Object.assign(intents.get(ref.id),update);return}
          calls.usersUpdated++;Object.assign(account,update)
        }
      });
    },
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
      Preference:class{async create({body}){calls.preferences++;calls.externalRefs.push(body.external_reference);
        return{id:'pref-'+calls.preferences,init_point:'https://mercadopago.com.br/checkout'}}},
      Payment:class{
        async create({body,requestOptions}){calls.payments++;calls.externalRefs.push(body.external_reference);
          calls.idempotencyKeys.push(requestOptions?.idempotencyKey);
          return {id:123,status:'pending',payment_method_id:'pix'};}
        async get({id}){calls.payments++;return paymentById[String(id)]||options.paymentDetails||
          {status:'approved',currency_id:'BRL',transaction_amount:5,external_reference:'buyer@example.test'};}
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
  return{post,request,signedRequest,calls,account,env,intents,paymentById,reconciliations};
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
test('Essencial checkout creates an immutable intent without overwriting legacy pending plan',async()=>{
  const f=setup({checkoutEnabled:true});
  const out=await f.post('/dashboard/checkout-create',f.request({plano:'essencial',aceitePoliticaArmazenamento:true}));
  assert.equal(out.code,200);assert.equal(f.calls.preferences,1);
  assert.equal(f.calls.usersUpdated,0);assert.equal(f.calls.intentCreates,1);
  assert.equal(f.account.plano_pendente,'essencial');
  assert.match(f.calls.externalRefs[0],/^slb:[0-9a-f-]{36}$/);
  const [intent]=f.intents.values();
  assert.equal(intent.uid,'firebase-user-123');assert.equal(intent.precoCentavos,500);
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
  assert.equal(f.calls.receipts,1);assert.equal(f.account.creditos,undefined);
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

test('two independent purchases for one user settle against their own intent and add 60 days',async()=>{
  const initial=Date.now()+5*DAY;
  const f=setup({checkoutEnabled:true,account:{
    email:'buyer@example.test',uid:'firebase-user-123',plano:'essencial',is_active:true,
    premium_ate:new Date(initial).toISOString(),plano_pendente:null,nome:'Cliente'
  }});
  for(let i=0;i<2;i++){
    const result=await f.post('/dashboard/checkout-create',
      f.request({plano:'essencial',aceitePoliticaArmazenamento:true}));
    assert.equal(result.code,200);
  }
  assert.equal(f.calls.intentCreates,2);
  assert.notEqual(f.calls.externalRefs[0],f.calls.externalRefs[1]);
  assert.equal(f.account.plano_pendente,null);
  for(let i=0;i<2;i++){
    f.paymentById[String(500+i)]={
      external_reference:f.calls.externalRefs[i],status:'approved',currency_id:'BRL',transaction_amount:5
    };
    assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest(String(500+i)))).code,200);
  }
  assert.equal(f.calls.receipts,2);
  assert.ok(Math.abs(Date.parse(f.account.premium_ate)-initial-60*DAY)<50);
  assert.equal([...f.intents.values()].filter(i=>i.status==='approved').length,2);
});
test('webhook cannot transfer a paid intent to another UID or change its value',async()=>{
  const f=setup({checkoutEnabled:true});
  assert.equal((await f.post('/dashboard/checkout-create',
    f.request({plano:'essencial',aceitePoliticaArmazenamento:true}))).code,200);
  const intentRef=f.calls.externalRefs[0];
  f.paymentById['801']={external_reference:intentRef,status:'approved',currency_id:'BRL',transaction_amount:5.01};
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest('801'))).code,503);
  assert.equal(f.calls.receipts,0);
  f.paymentById['802']={external_reference:intentRef,status:'approved',currency_id:'BRL',transaction_amount:5};
  f.account.uid='other-uid';
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest('802'))).code,503);
  assert.equal(f.calls.receipts,0);
});
test('a completed intent cannot be reused by another approved payment',async()=>{
  const f=setup({checkoutEnabled:true});
  assert.equal((await f.post('/dashboard/checkout-create',
    f.request({plano:'essencial',aceitePoliticaArmazenamento:true}))).code,200);
  for(const id of ['901','902']){
    f.paymentById[id]={external_reference:f.calls.externalRefs[0],status:'approved',currency_id:'BRL',transaction_amount:5};
  }
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest('901'))).code,200);
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest('902'))).code,503);
  assert.equal(f.calls.receipts,1);
});
test('Bricks payment creates its own intent rather than reusing the last Checkout Pro intent',async()=>{
  const f=setup({checkoutEnabled:true});
  const result=await f.post('/dashboard/payment/process',
    f.request({plano:'essencial',aceitePoliticaArmazenamento:true,formData:{token:'fake-token',transaction_amount:999}}));
  assert.equal(result.code,200);assert.equal(f.calls.intentCreates,1);
  assert.match(f.calls.externalRefs[0],/^slb:[0-9a-f-]{36}$/);
  assert.equal([...f.intents.values()][0].canal,'bricks');
});

test('Bricks binds Mercado Pago idempotency keys to distinct persisted payment intents',async()=>{
  const f=setup({checkoutEnabled:true});
  for(let i=0;i<2;i++){
    const result=await f.post('/dashboard/payment/process',f.request({
      plano:'essencial',aceitePoliticaArmazenamento:true,
      formData:{payment_method_id:'pix',payer:{email:'buyer@example.test'}}
    }));
    assert.equal(result.code,200);
  }
  assert.equal(f.calls.idempotencyKeys.length,2);
  assert.equal(new Set(f.calls.idempotencyKeys).size,2);
  for(let i=0;i<2;i++){
    const key=f.calls.idempotencyKeys[i];
    assert.match(key,/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
    assert.equal(f.calls.externalRefs[i],'slb:'+key);
    assert.ok(f.intents.has(key));
    assert.equal(f.intents.get(key).canal,'bricks');
  }
});

test('refunds, chargebacks and mediation require review without changing account entitlements',async()=>{
  for(const status of ['refunded','charged_back','in_mediation']){
    const f=setup({receiptExists:true,paymentDetails:{
      status,status_detail:status==='refunded'?'refunded':'in_process',
      currency_id:'BRL',transaction_amount:5,external_reference:'buyer@example.test'
    }});
    const previous=JSON.stringify(f.account);
    assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
    assert.equal(f.calls.reviewWrites,1);
    assert.equal(f.calls.receipts,0);
    assert.equal(f.calls.usersUpdated,0);
    assert.equal(JSON.stringify(f.account),previous);
    const review=f.reconciliations.get('123');
    assert.equal(review.status,status);
    assert.equal(review.receipt_exists,true);
    assert.equal(review.needs_manual_review,true);
    const before=review.observed_at;
    assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
    assert.equal(f.calls.reviewWrites,1);
    assert.equal(f.reconciliations.get('123').observed_at,before);
  }
});
test('partially refunded approved payment must not grant a full subscription',async()=>{
  const f=setup({paymentDetails:{
    status:'approved',status_detail:'partially_refunded',currency_id:'BRL',
    transaction_amount:5,external_reference:'buyer@example.test'
  }});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
  assert.equal(f.calls.receipts,0);
  assert.equal(f.calls.usersUpdated,0);
  assert.equal(f.reconciliations.get('123').status_detail,'partially_refunded');
  assert.equal(f.reconciliations.get('123').receipt_exists,false);
});
test('a changed dispute status updates one review case, not account or receipt',async()=>{
  const f=setup({receiptExists:true,paymentDetails:{
    status:'in_mediation',status_detail:'pending'
  }});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
  f.paymentById['123']={status:'charged_back',status_detail:'settled'};
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,200);
  assert.equal(f.reconciliations.size,1);
  assert.equal(f.calls.reviewWrites,2);
  assert.equal(f.reconciliations.get('123').status,'charged_back');
  assert.equal(f.calls.usersUpdated,0);
  assert.equal(f.calls.receipts,0);
});
test('Firestore failure processing a reversal returns 500 so MP can retry',async()=>{
  const f=setup({failTransaction:true,paymentDetails:{
    status:'refunded',status_detail:'refunded'
  }});
  assert.equal((await f.post('/webhook/mercado-pago',f.signedRequest())).code,500);
  assert.equal(f.reconciliations.size,0);
  assert.equal(f.calls.usersUpdated,0);
});
