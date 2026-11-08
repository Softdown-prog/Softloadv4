import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import crypto from 'node:crypto';
import ts from 'typescript';
import {ExpressAdapter} from '@nestjs/platform-express';

// HTTP contract only: no API client, Firestore, paid checkout or real secrets.
// Express 4 is from the production lockfile; Express 5 is from Nest's lockfile.
const productionRequire=createRequire(new URL('../../server.js',import.meta.url));
const nestRequire=createRequire(import.meta.resolve('@nestjs/platform-express'));
const express4=productionRequire('express');
const express5=nestRequire('express');
const secret='offline-webhook-hmac-secret-not-for-production';
const source=readFileSync(new URL('../../src/routes/apiRoutes.js',import.meta.url),'utf8');
const serverSource=readFileSync(new URL('../../server.js',import.meta.url),'utf8');

function productionWebhookVerifier(){
  const ast=ts.createSourceFile('apiRoutes.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const functions=[];
  function visit(node){
    if(ts.isFunctionDeclaration(node)&&node.name?.text==='verificarAssinaturaMP'){
      functions.push(node.getText(ast));
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  assert.equal(functions.length,1,'production verifier must have exactly one definition');
  return functions[0];
}
function productionBodyParsers(){
  const ast=ts.createSourceFile('server.js',serverSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const items=[];
  function visit(node){
    if(ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&
       ts.isIdentifier(node.expression.expression)&&
       node.expression.expression.text==='app'&&node.expression.name.text==='use'&&
       node.arguments.length===1){
      const middleware=node.arguments[0];
      if(ts.isCallExpression(middleware)&&ts.isPropertyAccessExpression(middleware.expression)&&
         ts.isIdentifier(middleware.expression.expression)&&
         middleware.expression.expression.text==='express'&&
         ['urlencoded','json'].includes(middleware.expression.name.text)){
        items.push({name:middleware.expression.name.text,code:middleware.getText(ast)});
      }
    }
    ts.forEachChild(node,visit);
  }
  visit(ast);
  assert.deepEqual(items.map(item=>item.name),['urlencoded','json'],
    'the real production parser order changed');
  return items;
}
const verifierSource=productionWebhookVerifier();
const parserSource=productionBodyParsers();
function verifier(key){
  return runInNewContext('('+verifierSource+')',{
    crypto,Buffer,process:{env:{MP_WEBHOOK_SECRET:key}},
    console:{warn(){}}
  },{filename:'production-webhook-verifier.js'});
}
function makeSignature(paymentId,requestId='req-offline-123',ts='1700000000000'){
  const manifest='id:'+paymentId+';request-id:'+requestId+';ts:'+ts+';';
  return 'ts='+ts+',v1='+crypto.createHmac('sha256',secret).update(manifest).digest('hex');
}
async function start(which){
  const express=which==='Express 4'?express4:express5;
  const app=which==='Express 4'?express4():new ExpressAdapter().getInstance();
  for(const {code} of parserSource){
    app.use(runInNewContext('('+code+')',{express},{filename:'production-body-parser.js'}));
  }
  const check=verifier(secret);
  const noSecret=verifier('');
  app.post('/webhook/mercado-pago',(req,res)=>{
    // This probe calls the actual production HMAC verifier. It explicitly
    // never mounts the production handler or calls payment.get/create().
    const valid=(req.get('x-proof-no-secret')==='1'?noSecret:check)(req);
    if(!valid)return res.status(403).send('Forbidden');
    res.status(200).json({
      accepted:true,paymentId:String(req.query?.['data.id']||req.body?.data?.id||''),
      action:req.body?.action??null,type:req.body?.type??null
    });
  });
  // Normalize parser failures (400/413) without printing a stack or calling
  // any commercial handler. In production JSON errors use the error handler.
  app.use((err,_req,res,_next)=>res.status(err.status||500).json({error:'body rejected'}));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr&&typeof addr!=='string');
  return {
    url:'http://127.0.0.1:'+addr.port+'/webhook/mercado-pago',
    close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
  };
}
async function post(base,fixture){
  const requestId=fixture.requestId??'req-offline-123';
  const paymentId=fixture.signedId??'12345678';
  const headers={'content-type':fixture.form?'application/x-www-form-urlencoded':'application/json'};
  if(!fixture.omitSignature){
    const validSig=makeSignature(paymentId,requestId);
    headers['x-signature']=fixture.signature??validSig;
  }
  if(!fixture.omitRequestId)headers['x-request-id']=requestId;
  if(fixture.withoutSecret)headers['x-proof-no-secret']='1';
  const body=fixture.rawBody??(fixture.form?
    'type=payment':JSON.stringify(fixture.body??{action:'payment.updated',data:{id:'12345678'}}));
  const res=await fetch(base+(fixture.path??'?data.id=12345678'),{
    method:'POST',redirect:'manual',headers,body
  });
  const content=await res.text();
  return {status:res.status,body:res.status===200?JSON.parse(content):content==='Forbidden'?'Forbidden':
    JSON.parse(content)};
}
test('actual signed Mercado Pago webhook verifier and body parsers match on Express 4/5',
  {timeout:30000},async()=>{
  const four=await start('Express 4');
  const five=await start('Express 5');
  try{
    const cases=[
      {name:'signed query and JSON body',expect:200,expectedId:'12345678'},
      {name:'signed JSON body only',path:'',expect:200,expectedId:'12345678'},
      {name:'valid signed URL-encoded request',form:true,expect:200,expectedId:'12345678'},
      {name:'body/query ID mismatch',body:{type:'payment',data:{id:'987654'}},expect:403},
      {name:'incorrect signature for ID',signature:makeSignature('987654'),expect:403},
      {name:'missing signature',omitSignature:true,expect:403},
      {name:'missing request ID',omitRequestId:true,expect:403},
      {name:'malformed hex signature',signature:'ts=1700000000000,v1=garbage',expect:403},
      {name:'missing webhook secret',withoutSecret:true,expect:403},
      {name:'invalid nonnumeric ID',path:'?data.id=not-numeric',expect:403},
      {name:'duplicate query ID',path:'?data.id=12345678&data.id=12345678',expect:403},
      {name:'no ID in query or body',path:'',body:{type:'payment'},expect:403},
      {name:'malformed JSON payload',rawBody:'{"broken":',expect:400},
      {name:'body above Express parser default limit',
        rawBody:JSON.stringify({data:{id:'12345678'},padding:'a'.repeat(110000)}),expect:413}
    ];
    for(const fixture of cases){
      const left=await post(four.url,fixture);
      const right=await post(five.url,fixture);
      assert.deepEqual(right,left,fixture.name+' must match Express 4');
      assert.equal(left.status,fixture.expect,fixture.name);
      if(fixture.expect===200){
        assert.equal(left.body.accepted,true,fixture.name);
        assert.equal(left.body.paymentId,fixture.expectedId,fixture.name);
      }
    }
  }finally{
    await four.close();
    await five.close();
  }
});
