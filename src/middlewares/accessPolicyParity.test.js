'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {createRequire}=require('node:module');
const moduleRequire=createRequire(__filename);
function loadLegacy(name){
  const current=path.join(__dirname,name);
  const module={exports:{}};
  const localRequire=(id)=>{
    if(id==='../services/firebase')return {db:{collection:()=>{throw Error('Unexpected database access in guard parity test');}}};
    if(id==='./accessPolicy.js')return moduleRequire('./accessPolicy.js');
    throw Error('Unexpected dependency '+id);
  };
  vm.runInNewContext(fs.readFileSync(current,'utf8'),{
    module,exports:module.exports,require:localRequire,console,Date,Error,Object,Number,
  },{filename:current});
  return module.exports;
}
function simulate(fn,session,{path='/dashboard',accept='text/html',xhr=''}={}){
  let nextCount=0;
  const result={status:200,payload:null,location:null,view:null};
  const res={
    status(code){result.status=code;return this;},
    json(body){result.payload=body;return this;},
    redirect(url){result.status=302;result.location=url;return this;},
    render(view){result.view=view;return this;}
  };
  const req={session,path,get(name){return name==='accept'?accept:name==='x-requested-with'?xhr:'';}};
  fn(req,res,()=>{nextCount++;});
  return {...result,nextCount};
}
test('Express login keeps API JSON 401 and HTML redirect after shared-policy migration',()=>{
  const {exigirLogin}=loadLegacy('authGuard.js');
  const api=simulate(exigirLogin,{}, {path:'/api/files'});
  assert.equal(api.status,401);
  assert.equal(api.payload.error,'Sessão expirada. Recarregue a página e faça login novamente.');
  const html=simulate(exigirLogin,{}, {path:'/dashboard'});
  assert.equal(html.location,'/login?erro=Faça login para continuar.');
  assert.equal(simulate(exigirLogin,{user:{uid:'user'}}, {path:'/api/files'}).nextCount,1);
  assert.equal(simulate(exigirLogin,{}, {accept:'application/json'}).status,401);
});
test('Express admin and worker still deny with concealed 404 and the same EJS view',()=>{
  const {exigirSuperAdmin}=loadLegacy('adminGuard.js');
  const {exigirWorkerAccess}=loadLegacy('workerGuard.js');
  for(const fn of [exigirSuperAdmin,exigirWorkerAccess]){
    const denied=simulate(fn,{user:{uid:'some-user'}});
    assert.equal(denied.status,404);
    assert.equal(denied.view,'pages/404');
    assert.equal(denied.nextCount,0);
  }
  assert.equal(simulate(exigirSuperAdmin,{user:{is_super_admin:true}}).nextCount,1);
  assert.equal(simulate(exigirWorkerAccess,{user:{email:'SOFTLOADY@GMAIL.COM'}}).nextCount,1);
});
