'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {config,seal,unseal,createGithubAppService}=require('./solarisGithubApp');
const {validarFerramentaSolaris,normalizarRepositorioGithub,contextoRepositorioPublico}=require('../solaris/tools/solarisToolModes');
const settings={
 SOLARIS_GITHUB_APP_CLIENT_ID:'id-test',
 SOLARIS_GITHUB_APP_CLIENT_SECRET:'fake-test-secret',
 SOLARIS_GITHUB_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')
};
function fakeDb(){
 const data=new Map();
 return {data,collection(name){
  assert.equal(name,'solaris_github_users');
  return {doc(id){return {
   async get(){return {exists:data.has(id),data:()=>data.get(id)};},
   async set(value){data.set(id,value);},
   async update(value){data.set(id,{...data.get(id),...value});},
   async delete(){data.delete(id);}
  }}};
 }};
}
function session(uid='alice-uid'){
 return {user:{uid},save(done){done(null)}};
}
function fakeFetch(url,options){
 if(url==='https://github.com/login/oauth/access_token')return Promise.resolve({
  ok:true,json:async()=>({access_token:'access-token-abc',expires_in:3600})});
 if(url==='https://api.github.com/user')return Promise.resolve({
  ok:true,json:async()=>({login:'alice'})});
 if(url==='https://api.github.com/repos/alice/priv-repo'){
  assert.equal(options.headers.Authorization,'Bearer access-token-abc');
  return Promise.resolve({ok:true,json:async()=>({full_name:'alice/priv-repo',
   description:'teste privado',private:true,default_branch:'main'})});
 }
 return Promise.resolve({ok:false,status:404});
}
test('modo de ferramenta aceita Forge e GitHub controlado; recusa URL arbitrária',()=>{
 assert.equal(validarFerramentaSolaris('asset-forge-2d').ok,true);
 assert.equal(validarFerramentaSolaris('github','https://github.com/alice/test.git').repo,'alice/test');
 assert.equal(normalizarRepositorioGithub('https://github.com/evil.com@attacker.test/repo'),null);
 assert.equal(validarFerramentaSolaris('shell').ok,false);
 assert.equal(validarFerramentaSolaris('github','http://127.0.0.1/repo').ok,false);
});
test('credencial no Firestore é autenticada e cifrada',()=>{
 const key=crypto.randomBytes(32),record=seal('token-desconhecido',key);
 assert.equal(unseal(record,key),'token-desconhecido');
 assert.ok(!record.includes('token-desconhecido'));
 assert.throws(()=>unseal(record,crypto.randomBytes(32)));
 assert.equal(config({}).ready,false);
 assert.equal(config(settings).ready,true);
});
test('GitHub App vincula OAuth ao usuário e verifica state de uso único',async()=>{
 const db=fakeDb(),service=createGithubAppService(db,{env:settings,fetchImpl:fakeFetch});
 const request={session:session()};
 const href=await service.begin(request);
 const state=new URL(href).searchParams.get('state');
 assert.equal(new URL(href).origin,'https://github.com');
 assert.ok(state && /^[a-f0-9]{48}$/.test(state));
 assert.ok(!href.includes('fake-test-secret'));
 await assert.rejects(()=>service.finish(request,{state:'a'.repeat(48),code:'abcdefgh1234'}));
 assert.equal((await service.status('alice-uid')).connected,false);
 const real=await service.begin(request),newState=new URL(real).searchParams.get('state');
 assert.equal(await service.finish(request,{state:newState,code:'abcdefgh1234'}),'alice');
 assert.equal((await service.status('alice-uid')).account,'alice');
 assert.equal((await service.status('mallory-uid')).connected,false);
 assert.equal((await service.status('alice-uid')).repository,null);
 assert.ok(!JSON.stringify([...db.data.values()]).includes('access-token-abc'));
 await assert.rejects(()=>service.finish(request,{state:newState,code:'abcdefgh1234'}));
 const linked=await service.selectRepo('alice-uid','https://github.com/alice/priv-repo');
 assert.equal(linked,'alice/priv-repo');
 assert.match(await service.repoContext('alice-uid','alice/priv-repo'),/teste privado/);
 assert.equal((await service.status('alice-uid')).repository,linked);
 await assert.rejects(()=>service.repoContext('mallory-uid','alice/priv-repo'));
 await service.disconnect('alice-uid');
 assert.equal((await service.status('alice-uid')).connected,false);
});
test('contexto do Github não permite SSRF e repositório público exige permissão real',async()=>{
 let calls=0;
 const get=async(url)=>{
  if(url.endsWith('/contents')||url.endsWith('/readme'))return {ok:false,status:404};
  calls++;assert.equal(url,'https://api.github.com/repos/alice/public');
  return {ok:true,json:async()=>({full_name:'alice/public',private:false,
   default_branch:'main',description:'simulador HTML5'})};
 };
 assert.match(await contextoRepositorioPublico('alice/public',{fetchImpl:get}),/somente de leitura/);
 assert.equal(calls,1);
 await assert.rejects(()=>contextoRepositorioPublico('http://127.0.0.1',{fetchImpl:get}));
 assert.equal(calls,1);
 const blocked=async()=>({ok:false,status:404});
 await assert.rejects(()=>contextoRepositorioPublico('alice/private',{fetchImpl:blocked}),/privado/);
});
