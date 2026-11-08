import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import ts from 'typescript';
import {ExpressAdapter} from '@nestjs/platform-express';

// Exact production express-session dependency, installed from the root lockfile.
// Express 4 also comes from that lockfile. Express 5 is Nest's pinned adapter.
const rootRequire=createRequire(new URL('../../server.js',import.meta.url));
const express4=rootRequire('express');
const session=rootRequire('express-session');
const express5=new ExpressAdapter().getInstance().constructor;
const compiled=readFileSync(new URL('../../server.js',import.meta.url),'utf8');
const ast=ts.createSourceFile('server.js',compiled,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);

function findProductionSessionDefinitions(){
  let storeClass=null, sessionCall=null;
  function walk(node){
    if(ts.isClassDeclaration(node)&&node.name?.text==='FirestoreSessionStore'){
      assert.equal(storeClass,null,'duplicate production session store');
      storeClass=node;
    }
    if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&
       node.expression.text==='session'&&node.arguments.length===1&&
       ts.isObjectLiteralExpression(node.arguments[0])){
      assert.equal(sessionCall,null,'duplicate production session configuration');
      sessionCall=node;
    }
    ts.forEachChild(node,walk);
  }
  walk(ast);
  assert.ok(storeClass,'production FirestoreSessionStore missing');
  assert.ok(sessionCall,'production express-session configuration missing');
  return {storeClass:storeClass.getText(ast),sessionCall:sessionCall.getText(ast)};
}
const production=findProductionSessionDefinitions();

function fakeFirestore(){
  const records=new Map();
  let unavailable=false;
  const clone=value=>JSON.parse(JSON.stringify(value));
  const db={
    collection(name){
      assert.equal(name,'sessions','test must exercise the real production collection name');
      return {doc(sid){
        assert.equal(typeof sid,'string');
        return {
          async get(){
            if(unavailable)throw Error('simulated Firestore outage');
            const value=records.get(sid);
            return {exists:value!==undefined,data:()=>clone(value)};
          },
          async set(value){records.set(sid,clone(value));},
          async delete(){records.delete(sid);}
        };
      }};
    }
  };
  return {db,records,setUnavailable(value){unavailable=value}};
}
function legacySessionMiddleware(db){
  // Evaluate *only* the actual store declaration and session(...) call from
  // server.js; never execute server boot, Firebase initialization or payments.
  const Store=runInNewContext('('+production.storeClass+')',{
    session,db,console:{error(){}}
  },{filename:'production-FirestoreSessionStore.js'});
  const environment={
    session,FirestoreSessionStore:Store,isProd:true,
    process:{env:{NODE_ENV:'production',SESSION_SECRET:'offline-session-contract-secret',
      SOFTLOAD_TEST_MEMORY_SESSION:'false'}}
  };
  return runInNewContext('('+production.sessionCall+')',environment,
    {filename:'production-express-session-config.js'});
}
function loginGuard(){
  const module={exports:{}};
  runInNewContext(readFileSync(new URL('../../src/middlewares/authGuard.js',import.meta.url),'utf8'),{
    module,exports:module.exports,
    require(id){
      if(id==='../services/firebase')return {db:{}};
      if(id==='./accessPolicy.js')return rootRequire('./src/middlewares/accessPolicy.js');
      throw Error('Unexpected dependency in isolated guard: '+id);
    },
    console:{warn(){},error(){}}
  },{filename:'production-authGuard.js'});
  return module.exports.exigirLogin;
}
const exigirLogin=loginGuard();

async function serve(express,db){
  const app=express();
  app.set('trust proxy',1);
  app.use(legacySessionMiddleware(db));
  app.get('/api/proof/private',exigirLogin,(req,res)=>{
    res.json({uid:req.session.user.uid,plano:req.session.user.plano});
  });
  app.get('/dashboard/proof/private',exigirLogin,(_req,res)=>res.status(200).send('private'));
  // This mirrors the production login's session.user assignment and explicit
  // req.session.save(), with a *fake identity* instead of Firebase Auth.
  app.post('/probe/login',(req,res)=>{
    req.session.user={uid:'offline-user',email:'proof@example.invalid',plano:'free'};
    req.session.save(err=>err?res.status(503).end():res.status(200).json({ok:true}));
  });
  app.get('/probe/logout',(req,res)=>{
    req.session.destroy(err=>err?res.status(503).end():res.status(204).end());
  });
  const server=app.listen(0,'127.0.0.1');
  await once(server,'listening');
  const addr=server.address();
  assert.ok(addr&&typeof addr!=='string');
  return {
    base:'http://127.0.0.1:'+addr.port,
    close:()=>new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()))
  };
}
async function request(base,path,{method='GET',cookie='',accept='application/json'}={}){
  const headers={accept,'x-forwarded-proto':'https'};
  if(cookie)headers.cookie=cookie;
  const res=await fetch(base+path,{method,headers,redirect:'manual'});
  return {status:res.status,location:res.headers.get('location'),
    setCookie:res.headers.get('set-cookie')||'',body:await res.text()};
}
async function scenario(express,label){
  const fake=fakeFirestore();
  let server=await serve(express,fake.db);
  try{
    const anonymous=await request(server.base,'/api/proof/private');
    assert.equal(anonymous.status,401,label+' anon API');
    assert.equal(anonymous.setCookie,'',label+' must not save anonymous session');
    const nav=await request(server.base,'/dashboard/proof/private',{accept:'text/html'});
    assert.equal(nav.status,302,label+' anonymous HTML');
    assert.ok(nav.location?.startsWith('/login?erro='),label+' login redirect');

    const loggedIn=await request(server.base,'/probe/login',{method:'POST'});
    assert.equal(loggedIn.status,200,label+' login');
    assert.match(loggedIn.setCookie,/^connect\.sid=/,label+' signed session cookie');
    for(const attribute of ['HttpOnly','Secure','SameSite=Lax']){
      assert.ok(loggedIn.setCookie.includes(attribute),label+' missing cookie '+attribute);
    }
    assert.equal(fake.records.size,1,label+' Firestore persisted after login');
    const cookie=loggedIn.setCookie.split(';',1)[0];
    const privatePage=await request(server.base,'/api/proof/private',{cookie});
    assert.equal(privatePage.status,200,label+' authenticated request');
    assert.deepEqual(JSON.parse(privatePage.body),{uid:'offline-user',plano:'free'});

    // A tampered signed cookie must be rejected before reaching Firestore.
    const tampered=cookie.slice(0,-1)+(cookie.endsWith('a')?'b':'a');
    assert.equal((await request(server.base,'/api/proof/private',{cookie:tampered})).status,
      401,label+' tampered cookie');

    await server.close();
    server=null;
    server=await serve(express,fake.db);
    assert.equal((await request(server.base,'/api/proof/private',{cookie})).status,
      200,label+' persisted session after app restart');

    fake.setUnavailable(true);
    assert.equal((await request(server.base,'/api/proof/private',{cookie})).status,
      401,label+' fail closed during Firestore outage');
    fake.setUnavailable(false);
    assert.equal((await request(server.base,'/api/proof/private',{cookie})).status,
      200,label+' session restored when Firestore is reachable');

    const logout=await request(server.base,'/probe/logout',{cookie});
    assert.equal(logout.status,204,label+' logout');
    assert.equal(fake.records.size,0,label+' Firestore document removed on logout');
    assert.equal((await request(server.base,'/api/proof/private',{cookie})).status,
      401,label+' revoked cookie denied');

    // Expiry cleanup uses the *real* production Store.get() implementation.
    const login2=await request(server.base,'/probe/login',{method:'POST'});
    assert.equal(login2.status,200);
    const cookie2=login2.setCookie.split(';',1)[0];
    assert.equal(fake.records.size,1);
    for(const [sid,row] of fake.records){
      fake.records.set(sid,{...row,expires:Date.now()-1});
    }
    assert.equal((await request(server.base,'/api/proof/private',{cookie:cookie2})).status,
      401,label+' expired Firestore record denied');
    assert.equal(fake.records.size,0,label+' expired record cleaned');
    return {anonymous:anonymous.status,navigation:nav.status,
      login:loggedIn.status,private:privatePage.status,restart:200,outage:401,
      logout:logout.status,expired:401};
  }finally{
    if(server)await server.close();
  }
}
test('real express-session and production FirestoreSessionStore have Express 4/5 HTTP parity',
  {timeout:30000},async()=>{
  const four=await scenario(express4,'Express 4');
  // Nest's ExpressAdapter creates a genuine Express 5 application.
  const five=await scenario(()=>new ExpressAdapter().getInstance(),'Express 5');
  assert.deepEqual(five,four);
});
