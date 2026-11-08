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
  let unavailable=false, deleteUnavailable=false;
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
          async delete(){
            if(deleteUnavailable)throw Error('simulated Firestore delete failure');
            records.delete(sid);
          }
        };
      }};
    }
  };
  return {
    db,records,
    setUnavailable(value){unavailable=value},
    setDeleteUnavailable(value){deleteUnavailable=value}
  };
}
function legacySessionMiddleware(db,secret='offline-session-contract-secret'){
  // Evaluate *only* the actual store declaration and session(...) call from
  // server.js; never execute server boot, Firebase initialization or payments.
  const Store=runInNewContext('('+production.storeClass+')',{
    session,db,console:{error(){}}
  },{filename:'production-FirestoreSessionStore.js'});
  const environment={
    session,FirestoreSessionStore:Store,isProd:true,
    process:{env:{NODE_ENV:'production',SESSION_SECRET:secret,
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

async function serve(express,db,{secret='offline-session-contract-secret'}={}){
  const app=express();
  app.set('trust proxy',1);
  app.use(legacySessionMiddleware(db,secret));
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

    // Sem confirmação de exclusão, o cookie antigo continua válido.
    fake.setDeleteUnavailable(true);
    const failedLogout=await request(server.base,'/probe/logout',{cookie});
    assert.equal(failedLogout.status,503,label+' failed revocation reported');
    assert.equal(fake.records.size,1,label+' session record not removed');
    assert.equal((await request(server.base,'/api/proof/private',{cookie})).status,
      200,label+' old cookie stays valid if deletion fails');
    fake.setDeleteUnavailable(false);
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


// A real rollback retains the signed cookie and the Firestore session ID.
// Both HTTP versions must point at the same persisted store and use the same
// SESSION_SECRET. This deliberately restarts HTTP servers while preserving the
// in-memory Firestore document backing the actual production Store logic.
async function switchAndRollback(firstAdapter,secondAdapter,label){
  const firestore=fakeFirestore();
  let original=await serve(firstAdapter,firestore.db);
  let candidate=null,rolledBack=null,differentSecret=null;
  const close=async server=>{if(server)await server.close();};
  try {
    const originalLogin=await request(original.base,'/probe/login',{method:'POST'});
    assert.equal(originalLogin.status,200,label+' initial login');
    const initialCookie=originalLogin.setCookie.split(';',1)[0];
    assert.match(initialCookie,/^connect\.sid=/,label+' signed initial cookie');
    assert.equal(firestore.records.size,1,label+' one durable session document');
    const stored=[...firestore.records.values()][0];
    assert.equal(stored.sess.user.uid,'offline-user',label+' production store persisted the user');

    candidate=await serve(secondAdapter,firestore.db);
    const upgraded=await request(candidate.base,'/api/proof/private',{cookie:initialCookie});
    assert.equal(upgraded.status,200,label+' candidate must accept old cookie');
    assert.deepEqual(JSON.parse(upgraded.body),{uid:'offline-user',plano:'free'});
    assert.equal(upgraded.setCookie,'',label+' candidate must not rotate an unchanged cookie');
    assert.equal((await request(candidate.base,'/dashboard/proof/private',
      {cookie:initialCookie,accept:'text/html'})).status,200,
      label+' candidate HTML session continuity');

    // A wrong cookie-signing secret is an explicit rollback blocker, even if
    // both runtimes can read the same underlying Firestore document.
    differentSecret=await serve(secondAdapter,firestore.db,
      {secret:'offline-different-secret-do-not-use'});
    assert.equal((await request(differentSecret.base,'/api/proof/private',
      {cookie:initialCookie})).status,401,label+' mismatched SESSION_SECRET denied');
    assert.equal(firestore.records.size,1,label+' mismatched secret cannot erase session');
    await close(differentSecret);
    differentSecret=null;

    // The original process is retired, then brought back: this is a real
    // direction switch of HTTP runtimes, not only side-by-side parity.
    await close(original);
    original=null;
    rolledBack=await serve(firstAdapter,firestore.db);
    assert.equal((await request(rolledBack.base,'/api/proof/private',
      {cookie:initialCookie})).status,200,label+' rollback reuses original signed cookie');

    // Sessions created by the candidate must ALSO remain usable after
    // rollback. No client-side reauthentication or cookie rewrite required.
    const candidateLogin=await request(candidate.base,'/probe/login',{method:'POST'});
    assert.equal(candidateLogin.status,200,label+' candidate login');
    const candidateCookie=candidateLogin.setCookie.split(';',1)[0];
    assert.match(candidateCookie,/^connect\.sid=/);
    assert.notEqual(candidateCookie,initialCookie,label+' sessions have unique IDs');
    assert.equal(firestore.records.size,2,label+' both sessions persisted in shared store');
    assert.equal((await request(rolledBack.base,'/api/proof/private',
      {cookie:candidateCookie})).status,200,
      label+' rolled-back runtime accepts cookie minted by candidate');

    firestore.setUnavailable(true);
    for(const current of [candidate,rolledBack]){
      for(const cookie of [initialCookie,candidateCookie]){
        assert.equal((await request(current.base,'/api/proof/private',{cookie})).status,
          401,label+' neither runtime grants sessions without a Firestore read');
      }
    }
    firestore.setUnavailable(false);
    assert.equal((await request(candidate.base,'/api/proof/private',
      {cookie:initialCookie})).status,200,label+' candidate recovers after outage');
    assert.equal((await request(rolledBack.base,'/api/proof/private',
      {cookie:candidateCookie})).status,200,label+' rollback recovers after outage');

    firestore.setDeleteUnavailable(true);
    assert.equal((await request(candidate.base,'/probe/logout',
      {cookie:initialCookie})).status,503,label+' failed candidate logout is not confirmed');
    assert.equal(firestore.records.size,2,label+' failed revoke keeps both records');
    assert.equal((await request(rolledBack.base,'/api/proof/private',
      {cookie:initialCookie})).status,200,label+' failed revoke cannot fake cookie invalidation');
    firestore.setDeleteUnavailable(false);

    assert.equal((await request(rolledBack.base,'/probe/logout',
      {cookie:initialCookie})).status,204,label+' rollback can revoke original session');
    assert.equal((await request(candidate.base,'/api/proof/private',
      {cookie:initialCookie})).status,401,label+' candidate observes rollback revocation');
    assert.equal((await request(candidate.base,'/probe/logout',
      {cookie:candidateCookie})).status,204,label+' candidate can revoke its session');
    assert.equal((await request(rolledBack.base,'/api/proof/private',
      {cookie:candidateCookie})).status,401,label+' rollback observes candidate revocation');
    assert.equal(firestore.records.size,0,label+' no active sessions left after logout');
  } finally {
    await Promise.all([close(original),close(candidate),close(rolledBack),close(differentSecret)]);
  }
}

test('rollback from Express 5 to Express 4 preserves both directions of session cookies',
  {timeout:30000},async()=>{
  await switchAndRollback(express4,()=>new ExpressAdapter().getInstance(),
    'Express 4 => Express 5 => Express 4');
});

test('reverse switch from Express 5 to Express 4 also preserves session cookies',
  {timeout:30000},async()=>{
  await switchAndRollback(()=>new ExpressAdapter().getInstance(),express4,
    'Express 5 => Express 4 => Express 5');
});
