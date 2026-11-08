import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {ExpressAdapter} from '@nestjs/platform-express';

// Run real commercial GET routers and EJS views without Firebase, mail,
// payments, or credentialed network calls. The production server stays on 4.
const repo=fileURLToPath(new URL('../../',import.meta.url));
const rootRequire=createRequire(new URL('../../server.js',import.meta.url));
const pilotRequire=createRequire(import.meta.resolve('@nestjs/platform-express'));
const express4=rootRequire('express');
const express5=pilotRequire('express');
const authSource=readFileSync(join(repo,'src/routes/authRoutes.js'),'utf8');
const contactSource=readFileSync(join(repo,'src/routes/contatoRoutes.js'),'utf8');
const serverSource=readFileSync(join(repo,'server.js'),'utf8');

// Fail when a future server refactor changes the rendering contract but
// silently leaves this compatibility proof with stale assumptions.
for(const statement of [
  "app.set('view engine', 'ejs')",
  "app.set('views', path.join(__dirname, 'views'))",
  'res.locals.user = req.session.user || null',
  'res.locals.currentPath = req.path',
  'res.locals.gitSha = buildInfo.gitSha'
]){
  assert.ok(serverSource.includes(statement),'production EJS contract changed: '+statement);
}

function commercialRouter(source,express){
  const module={exports:{}};
  runInNewContext(source,{
    module,exports:module.exports,Date,
    console:{log(){},warn(){},error(){}},
    process:{env:{BASE_URL:'https://softload.test.invalid',FIREBASE_API_KEY:'offline-only'}},
    // Real GET handlers execute. POST handlers are never called; their
    // dependencies are disabled to prevent remote I/O or email.
    fetch:()=>{throw Error('Identity provider must not be contacted');},
    setTimeout,
    require(id){
      if(id==='express')return express;
      if(id==='express-rate-limit')return ()=>(_req,_res,next)=>next();
      if(id==='../services/firebase')return {db:{},admin:{}};
      if(id==='../services/emailService')return {
        transporter:{sendMail(){throw Error('Email must not be sent');}},
        enviarBoasVindas(){throw Error('Email must not be sent');},
        enviarRecuperacaoSenha(){throw Error('Email must not be sent');}
      };
      throw Error('Unexpected real router dependency: '+id);
    }
  },{filename:source===authSource?'authRoutes.js':'contatoRoutes.js',timeout:2000});
  return module.exports;
}
async function serverFor(which){
  const express=which==='4'?express4:express5;
  const app=which==='4'?express4():new ExpressAdapter().getInstance();
  app.set('view engine','ejs');
  app.set('views',join(repo,'views'));
  app.use((req,res,next)=>{
    // The production server sets these locals after express-session.
    // Test identity is supplied locally, not through a real account.
    req.session={
      user:req.get('x-offline-proof-auth')==='1'?
        {uid:'fake-user',email:'proof@example.invalid',plano:'free'}:null
    };
    res.locals.user=req.session.user||null;
    res.locals.currentPath=req.path;
    res.locals.gitSha='offline-ejs-proof';
    res.locals.firebaseApiKey='';
    res.locals.firebaseAppId='';
    res.locals.bloggerCheckoutEnabled=false;
    res.locals.bloggerFilesEnabled=false;
    res.locals.mpCheckoutUrl='#';
    res.set('Cache-Control','no-store');
    next();
  });
  app.use(commercialRouter(authSource,express));
  app.use(commercialRouter(contactSource,express));
  app.use((err,_req,res,_next)=>{
    res.status(err.status||500).type('text/plain').send('EJS rendering error');
  });
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr&&typeof addr!=='string');
  return {
    base:'http://127.0.0.1:'+addr.port,
    close:()=>new Promise((resolve,reject)=>
      server.close(error=>error?reject(error):resolve()))
  };
}
async function get(base,path,authenticated=false){
  const res=await fetch(base+path,{
    redirect:'manual',
    headers:authenticated?{'x-offline-proof-auth':'1'}:{}
  });
  return {
    status:res.status,
    location:res.headers.get('location'),
    type:res.headers.get('content-type'),
    cache:res.headers.get('cache-control'),
    body:await res.text()
  };
}
test('production authentication and contact EJS render equally under Express 4 and 5',
  {timeout:30000},async()=>{
  const old=await serverFor('4');
  const next=await serverFor('5');
  try{
    const cases=[
      {path:'/login',status:200,contains:['Entre na sua conta','action="/login"','noindex, follow']},
      {path:'/register',status:200,contains:['Sua área de criação começa aqui','action="/register"','noindex, follow']},
      {path:'/recover',status:200,contains:['Recuperar senha','action="/recover"','noindex, follow']},
      {path:'/contato',status:200,contains:['Como podemos ajudar?','action="/contato"']},
      {path:'/contato?erro=%3Cscript%3Ealert(1)%3C%2Fscript%3E',status:200,
        contains:['&lt;script&gt;alert(1)&lt;/script&gt;']},
      {path:'/login',auth:true,status:302,location:'/dashboard'},
      {path:'/register',auth:true,status:302,location:'/dashboard'},
      {path:'/recover',auth:true,status:302,location:'/dashboard'}
    ];
    for(const item of cases){
      const a=await get(old.base,item.path,item.auth);
      const b=await get(next.base,item.path,item.auth);
      assert.equal(a.status,item.status,'Express 4 '+item.path);
      assert.equal(b.status,item.status,'Express 5 '+item.path);
      assert.deepEqual(b,a,'HTML/redirect regression between Express 4 and 5: '+item.path);
      assert.equal(a.cache,'no-store',item.path+' dynamic cache');
      if(item.location){
        assert.equal(a.location,item.location,'expected login redirect');
      }else{
        assert.match(a.type,/text\/html/,item.path+' actual EJS response');
        assert.ok(a.body.includes('/css/softload.css?v=offline-ejs-proof'),
          item.path+' actual EJS header include');
        assert.ok(a.body.includes('/vendor/bootstrap/js/bootstrap.bundle.min.js?v=offline-ejs-proof'),
          item.path+' actual EJS footer include');
        for(const term of item.contains??[])assert.ok(a.body.includes(term),
          'Missing rendered content '+term+' in '+item.path);
      }
      if(item.path.startsWith('/contato?erro=')){
        assert.ok(!a.body.includes('<script>alert(1)</script>'),
          'Contact error query must be HTML-escaped');
      }
    }
  }finally{
    await old.close();
    await next.close();
  }
});
