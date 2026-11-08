import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {runInNewContext} from 'node:vm';
import {once} from 'node:events';
import ts from 'typescript';
import {ExpressAdapter} from '@nestjs/platform-express';

// Actual commercial routers / error handler; only their external dependencies
// are stubbed. No payment, Firebase, email, or remote network is exercised.
const root=fileURLToPath(new URL('../../',import.meta.url));
const productionRequire=createRequire(new URL('../../server.js',import.meta.url));
const adapterRequire=createRequire(import.meta.resolve('@nestjs/platform-express'));
const express4=productionRequire('express');
const express5=adapterRequire('express');
const rateLimit=productionRequire('express-rate-limit');
const authSource=readFileSync(join(root,'src/routes/authRoutes.js'),'utf8');
const contactSource=readFileSync(join(root,'src/routes/contatoRoutes.js'),'utf8');
const serverSource=readFileSync(join(root,'server.js'),'utf8');

function realCommercialRouter(source,express){
  const module={exports:{}};
  runInNewContext(source,{
    module,exports:module.exports,Date,
    console:{log(){},warn(){},error(){}},
    process:{env:{FIREBASE_API_KEY:'offline',BASE_URL:'https://offline.invalid'}},
    fetch:async()=>{throw Error('Offline Identity Toolkit only');},
    require(id){
      if(id==='express')return express;
      if(id==='express-rate-limit')return rateLimit; // the REAL production limiter
      if(id==='../services/firebase')return {db:{},admin:{}};
      if(id==='../services/emailService')return {
        transporter:{sendMail(){throw Error('Email sending is forbidden in CI');}},
        enviarBoasVindas(){throw Error('Email sending is forbidden in CI');},
        enviarRecuperacaoSenha(){throw Error('Email sending is forbidden in CI');}
      };
      throw Error('Unexpected commercial router dependency: '+id);
    }
  },{filename:source===authSource?'authRoutes.js':'contatoRoutes.js',timeout:2000});
  return module.exports;
}
async function serveCommercialLimiters(express){
  const app=express();
  app.set('trust proxy',1);
  app.use(express.urlencoded({extended:true}));
  app.use(express.json());
  app.use(realCommercialRouter(authSource,express));
  app.use(realCommercialRouter(contactSource,express));
  app.use((_err,_req,res,_next)=>res.status(500).json({error:'fixture error'}));
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr&&typeof addr!=='string');
  return {
    base:'http://127.0.0.1:'+addr.port,
    close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
  };
}
async function post(base,route,ip='198.51.100.40'){
  const response=await fetch(base+route,{
    method:'POST',redirect:'manual',
    headers:{
      'content-type':'application/x-www-form-urlencoded',
      'x-forwarded-for':ip
    },
    body:'email=proof%40example.invalid&password=invalid&name=Example'
  });
  const location=response.headers.get('location');
  assert.equal(response.status,302,'HTML form must keep redirect semantics: '+route);
  assert.ok(location?.startsWith(route+'?'),route+' returned unexpected Location '+location);
  // express-rate-limit supports multiple IETF drafts across pinned versions.
  // Require at least one modern header and report the actual header set if
  // behavior changes, rather than silently passing with no observability.
  const limitHeader=response.headers.get('ratelimit')||
    response.headers.get('ratelimit-limit')||
    response.headers.get('ratelimit-policy');
  assert.ok(limitHeader,'standard RateLimit header missing for '+route+
    ': '+JSON.stringify(Object.fromEntries(response.headers.entries())));
  assert.equal(response.headers.get('x-ratelimit-limit'),null,
    'deprecated rate limit headers must stay disabled');
  return {status:response.status,location:decodeURI(location),limitHeader};
}
async function exerciseLimiters(which){
  const api=await serveCommercialLimiters(which);
  try{
    const targets=[
      {route:'/login',max:10,denied:'Muitas tentativas de login'},
      {route:'/register',max:5,denied:'Muitas tentativas de cadastro'},
      {route:'/recover',max:5,denied:'Muitas tentativas de recuperação'},
      {route:'/contato',max:1,denied:'Aguarde 1 minuto antes de enviar'}
    ];
    const outcomes=[];
    for(const {route,max,denied} of targets){
      let before;
      for(let i=0;i<max;i++){
        before=await post(api.base,route);
        assert.ok(!before.location.includes(denied),
          route+' should accept attempt '+(i+1)+'/'+max);
      }
      const blocked=await post(api.base,route);
      assert.ok(blocked.location.includes(denied),
        route+' must use its real commercial redirect when throttled');
      const otherIp=await post(api.base,route,'198.51.100.41');
      assert.ok(!otherIp.location.includes(denied),
        route+' must not block a distinct proxied IP');
      outcomes.push({
        route,max,
        allowedStatus:before.status,allowedLocation:before.location,
        blockedStatus:blocked.status,blockedLocation:blocked.location,
        alternateIp:otherIp.location
      });
    }
    return outcomes;
  }finally{await api.close();}
}

function realProductionFallback(){
  const ast=ts.createSourceFile('server.js',serverSource,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
  const found=[];
  function walk(node){
    if(ts.isFunctionDeclaration(node)&&node.name?.text==='mountLegacyFallback'){
      found.push(node.getText(ast));
    }
    ts.forEachChild(node,walk);
  }
  walk(ast);
  assert.equal(found.length,1,'production fallback must remain unique');
  assert.match(serverSource,/const app = createLegacyApp\(\);\s*mountLegacyFallback\(app\)/,
    'production entrypoint must still install commercial fallback');
  return runInNewContext('('+found[0]+')',{
    console:{error(){},warn(){}}
  },{filename:'production-mountLegacyFallback.js',timeout:1500});
}
async function serveFallback(express){
  const app=express();
  app.set('view engine','ejs');
  app.set('views',join(root,'views'));
  app.use((req,res,next)=>{
    // Same server-side view locals as the commercial bootstrap.
    res.set('Cache-Control','no-store');
    res.locals.user=null;
    res.locals.currentPath=req.path;
    res.locals.gitSha='offline-error-proof';
    res.locals.firebaseApiKey='';
    res.locals.firebaseAppId='';
    res.locals.bloggerCheckoutEnabled=false;
    res.locals.bloggerFilesEnabled=false;
    res.locals.mpCheckoutUrl='#';
    next();
  });
  for(const route of ['/api/proof/error','/dashboard/proof/error']){
    app.get(route,(_req,_res,next)=>{
      next(Object.assign(Error('private-database-password-must-not-appear'),{status:503}));
    });
  }
  app.get('/api/proof/unexpected',(_req,_res,next)=>
    next(Error('private-unknown-error-must-not-appear')));
  realProductionFallback()(app);
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr&&typeof addr!=='string');
  return {
    base:'http://127.0.0.1:'+addr.port,
    close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
  };
}
async function getResponse(base,route,headers={}){
  const response=await fetch(base+route,{headers,redirect:'manual'});
  return {
    status:response.status,
    contentType:response.headers.get('content-type')?.split(';')[0],
    cache:response.headers.get('cache-control'),
    body:await response.text()
  };
}
test('real commercial login/register/recover/contact rate limits agree on Express 4 and 5',
  {timeout:30000},async()=>{
  const old=await exerciseLimiters(express4);
  const next=await exerciseLimiters(express5);
  assert.deepEqual(next,old,'production form limiter contract changed on Express 5');
});

test('real commercial 404 / JSON error / EJS error fallback agrees on Express 4 and 5',
  {timeout:30000},async()=>{
  const old=await serveFallback(express4);
  const next=await serveFallback(express5);
  try{
    const fixtures=[
      {route:'/missing',status:404,type:'text/html',contains:'Página não encontrada'},
      {route:'/api/missing',status:404,type:'text/html',contains:'Página não encontrada'},
      {route:'/api/proof/error',status:503,type:'application/json',contains:'Erro interno do servidor'},
      {route:'/api/proof/unexpected',status:500,type:'application/json',contains:'Erro interno do servidor'},
      {route:'/dashboard/proof/error',status:503,type:'text/html',contains:'Página não encontrada'},
      {route:'/dashboard/proof/error',headers:{accept:'application/json'},status:503,
        type:'application/json',contains:'Erro interno do servidor'},
      {route:'/dashboard/proof/error',headers:{'x-requested-with':'XMLHttpRequest'},status:503,
        type:'application/json',contains:'Erro interno do servidor'}
    ];
    for(const {route,headers={},status,type,contains} of fixtures){
      const four=await getResponse(old.base,route,headers);
      const five=await getResponse(next.base,route,headers);
      assert.equal(four.status,status,'Express 4 '+route);
      assert.equal(four.contentType,type,'Express 4 '+route);
      assert.equal(four.cache,'no-store','commercial dynamic cache');
      assert.ok(four.body.includes(contains),route+' missing expected error content');
      assert.ok(!four.body.includes('private-database-password-must-not-appear'),
        'never expose internal exception message');
      assert.ok(!four.body.includes('private-unknown-error-must-not-appear'),
        'never expose unknown exception message');
      assert.deepEqual(five,four,'error/404 regression on Express 5 for '+route);
    }
  }finally{
    await old.close();
    await next.close();
  }
});
