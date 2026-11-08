import 'reflect-metadata';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {once} from 'node:events';
import {Controller,Get,Module,UseGuards} from '@nestjs/common';
import {NestFactory} from '@nestjs/core';
import {ExpressAdapter} from '@nestjs/platform-express';
import ts from 'typescript';
import {MiddlewareModule} from '../dist/middleware.module.js';
import {LegacyRedirectModule} from '../dist/legacy-redirect.module.js';
import {SessionGuard} from '../dist/guards.js';
import {AccessContractFilter} from '../dist/response-contract.js';

// The *real* server.js factory is extracted by AST; requiring server.js
// would run environment validation, Firebase, monitoring and a listener.
const root=fileURLToPath(new URL('../../',import.meta.url));
const productionRequire=createRequire(new URL('../../server.js',import.meta.url));
const adapterRequire=createRequire(import.meta.resolve('@nestjs/platform-express'));
const express4=productionRequire('express');
const express5=adapterRequire('express');
const session=productionRequire('express-session');
const path=productionRequire('node:path');
const source=readFileSync(join(root,'server.js'),'utf8');
const authSource=readFileSync(join(root,'src/routes/authRoutes.js'),'utf8');

function extractProductionFunctions(){
  const ast=ts.createSourceFile('server.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const names=['createLegacyApp','mountLegacyFallback'];
  const result=new Map(names.map(name=>[name,[]]));
  function walk(node){
    if(ts.isFunctionDeclaration(node)&&result.has(node.name?.text)){
      result.get(node.name.text).push(node.getText(ast));
    }
    ts.forEachChild(node,walk);
  }
  walk(ast);
  for(const name of names){
    assert.equal(result.get(name).length,1,'production bootstrap must define exactly one '+name);
  }
  assert.match(source,/const app = createLegacyApp\(\);\s*mountLegacyFallback\(app\);/);
  assert.equal((source.match(/app\.listen\(/g)||[]).length,1,
    'production must keep exactly one listen call outside the factory');
  return Object.fromEntries(names.map(name=>[name,result.get(name)[0]]));
}
const production=extractProductionFunctions();

function actualAuthRouter(express){
  const module={exports:{}};
  runInNewContext(authSource,{
    module,exports:module.exports,console:{error(){},warn(){},log(){}},
    process:{env:{BASE_URL:'https://offline.invalid',FIREBASE_API_KEY:'offline'}},
    Date,setTimeout,
    fetch(){throw Error('No Firebase Identity Toolkit network allowed');},
    require(id){
      if(id==='express')return express;
      if(id==='express-rate-limit')return ()=>(_req,_res,next)=>next();
      if(id==='../services/firebase')return {db:{},admin:{}};
      if(id==='../services/emailService')return {
        enviarBoasVindas(){throw Error('No mail allowed');},
        enviarRecuperacaoSenha(){throw Error('No mail allowed');}
      };
      throw Error('Unexpected dependency: '+id);
    }
  },{filename:'authRoutes.js',timeout:1500});
  return module.exports;
}
function makeLegacyFactory(express){
  const dashboardRoutes=express.Router();
  dashboardRoutes.get('/dashboard/legacy-proof',(req,res)=>
    res.json({legacy:true,user:req.session?.user?.uid??null}));
  const apiRoutes=express.Router();
  apiRoutes.get('/api/legacy-proof',(_req,res)=>res.json({source:'legacy-api'}));
  const emptyRouter=()=>express.Router();
  const sentinelWorker={getStatus(){return {running:false};}};
  const db={collection(name){
    assert.equal(name,'sessions');
    return {limit(n){assert.equal(n,1);return {async get(){return {docs:[]};}}}};
  }};
  const context={
    express,path,__dirname:root,session,isProd:false,
    process:{env:{
      NODE_ENV:'test',SOFTLOAD_TEST_MEMORY_SESSION:'true',
      SESSION_SECRET:'offline-bridge-not-a-real-secret'
    }},
    // MemoryStore is selected by the actual production session(...) call;
    // FirestoreSessionStore is deliberately never constructed.
    FirestoreSessionStore:class {constructor(){throw Error('Firestore unavailable in bridge proof');}},
    helmetMiddleware:productionRequire('./src/middlewares/security.js').helmetMiddleware,
    corsMiddleware:productionRequire('./src/middlewares/security.js').corsMiddleware,
    setPublicStaticHeaders:()=>{},
    authRoutes:actualAuthRouter(express),
    dashboardRoutes,apiRoutes,
    contatoRoutes:emptyRouter(),adminRoutes:emptyRouter(),workersRoutes:emptyRouter(),
    sentinelWorker,db,buildInfo:{gitSha:'offline-bridge-rev',gitDate:null,buildTime:null},
    console:{log(){},warn(){},error(){}},
    require(id){
      if(id==='./src/routes/angular-shell.cjs'||id==='./src/routes/publicBlogger.cjs'){
        return emptyRouter();
      }
      throw Error('Unexpected production route: '+id);
    }
  };
  const factory=runInNewContext('('+production.createLegacyApp+')',context,
    {filename:'isolated-production-createLegacyApp.js'});
  const fallback=runInNewContext('('+production.mountLegacyFallback+')',context,
    {filename:'isolated-production-mountLegacyFallback.js'});
  return {factory,fallback};
}

class BridgeController {
  get(){return {nest:true,user:'authenticated'};}
}
Controller('api/nest-proof')(BridgeController);
const descriptor=Object.getOwnPropertyDescriptor(BridgeController.prototype,'get');
Get('shared-port')(BridgeController.prototype,'get',descriptor);
UseGuards(SessionGuard)(BridgeController.prototype,'get',descriptor);
class BridgeModule {}
Module({imports:[MiddlewareModule,LegacyRedirectModule],controllers:[BridgeController]})(BridgeModule);

async function fetchText(base,uri,headers={}){
  const response=await fetch(base+uri,{headers,redirect:'manual'});
  return {status:response.status,headers:response.headers,body:await response.text()};
}
test('actual legacy factory and Nest guards share one Express 5 app and listener',
  {timeout:30000},async()=>{
  const expressApp=new ExpressAdapter().getInstance();
  const {factory}=makeLegacyFactory(express5);
  const registered=[];
  const originalGet=expressApp.get.bind(expressApp);
  expressApp.get=(route,...args)=>{
    if(typeof route==='string' && route.startsWith('/'))registered.push(route);
    return originalGet(route,...args);
  };
  assert.strictEqual(factory(expressApp,{nestOwnsBloggerRedirect:true}),expressApp,
    'must decorate injected app and delegate exactly one legacy redirect');
  assert.equal(registered.filter(route=>route==='/dashboard/blogger-ai').length,0,
    'do not mount the Express redirect when Nest explicitly owns it');

  // Fixture login happens in the same express-session middleware/MemoryStore
  // as the production factory; it is not a second process or session store.
  expressApp.get('/offline/bridge-login',(req,res)=>{
    req.session.user={uid:'offline-fixture',email:'proof@example.invalid'};
    req.session.save(err=>err?res.status(503).end():res.json({created:true}));
  });
  const nest=await NestFactory.create(BridgeModule,new ExpressAdapter(expressApp),{
    logger:false,abortOnError:false
  });
  nest.useGlobalFilters(new AccessContractFilter());
  try{
    // Nest is the ONLY listener; legacy factory never calls listen().
    await nest.listen(0,'127.0.0.1');
    const server=nest.getHttpServer();
    const addr=server.address();
    assert.ok(addr&&typeof addr!=='string');
    const base='http://127.0.0.1:'+addr.port;
    assert.equal((await fetchText(base,'/api/legacy-proof')).status,200);
    const html=await fetchText(base,'/login');
    assert.equal(html.status,200,'real commercial authentication EJS route');
    assert.match(html.body,/Entre na sua conta/);
    assert.match(html.body,/offline-bridge-rev/);
    assert.equal((await fetchText(base,'/health')).status,200);
    const redirect=await fetchText(base,'/dashboard/blogger-ai?legacy=1');
    assert.equal(redirect.status,301,'Nest must own migrated noncommercial GET');
    assert.equal(redirect.headers.get('location'),'/dashboard/gerador-blogger');
    assert.equal(redirect.headers.get('cache-control'),'no-store');
    const redirectedHead=await fetch(base+'/dashboard/blogger-ai',{method:'HEAD',redirect:'manual'});
    assert.equal(redirectedHead.status,301);
    assert.equal(redirectedHead.headers.get('location'),'/dashboard/gerador-blogger');
    const anonymous=await fetchText(base,'/api/nest-proof/shared-port',
      {accept:'application/json'});
    assert.equal(anonymous.status,401,'Nest guard consumes the legacy session');
    const login=await fetchText(base,'/offline/bridge-login');
    assert.equal(login.status,200);
    const cookie=login.headers.get('set-cookie')?.split(';')[0];
    assert.match(cookie??'',/^connect\.sid=/);
    const legacy=await fetchText(base,'/dashboard/legacy-proof',{cookie});
    assert.equal(legacy.status,200);
    assert.equal(JSON.parse(legacy.body).user,'offline-fixture');
    const authorized=await fetchText(base,'/api/nest-proof/shared-port',{cookie});
    assert.equal(authorized.status,200,'Nest must read the SAME session cookie');
    assert.deepEqual(JSON.parse(authorized.body),{nest:true,user:'authenticated'});
    assert.equal((await fetchText(base,'/no-such-path')).status,404,
      'Nest owns the unmatched route when legacy fallback is deferred');
  }finally{await nest.close();}
});

test('production factory keeps legacy 404 and error middleware on Express 4',
  {timeout:30000},async()=>{
  const {factory,fallback}=makeLegacyFactory(express4);
  const expressApp=factory(express4());
  // The commercial entrypoint installs its fallback after the factory.
  fallback(expressApp);
  const server=expressApp.listen(0,'127.0.0.1');
  try{
    await once(server,'listening');
    const addr=server.address();
    assert.ok(addr&&typeof addr!=='string');
    const base='http://127.0.0.1:'+addr.port;
    assert.equal((await fetchText(base,'/api/legacy-proof')).status,200);
    const oldRedirect=await fetchText(base,'/dashboard/blogger-ai?legacy=1');
    assert.equal(oldRedirect.status,301,'Express 4 owns redirect by default');
    assert.equal(oldRedirect.headers.get('location'),'/dashboard/gerador-blogger');
    assert.equal(oldRedirect.headers.get('cache-control'),'no-store');
    const missing=await fetchText(base,'/no-such-path');
    assert.equal(missing.status,404);
    assert.match(missing.body,/<!DOCTYPE html>/,'real EJS 404 page');
  }finally{
    await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
  }
});
