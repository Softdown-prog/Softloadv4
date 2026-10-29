'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const crypto=require('node:crypto');
const ejs=require('ejs');
const MB=1024*1024;
function fixture({enabled=true,used=0,premium=false,saveFails=false}={}){
  const owner='uid-firebase-user-001';
  const email='user@example.test';
  const token='a'.repeat(48);
  const root='clientes_premium/'+email;
  const dbFiles=new Map([[root,{uid:owner,plano:premium?'essencial':'free',is_active:premium,
    premium_ate:premium?'2099-01-01T00:00:00.000Z':null,
    essencial_storage_expira_em:'2099-01-01T00:00:00.000Z',
    essencial_storage_aceite_em:premium?'2026-10-29T10:00:00.000Z':null,
    storage_usado_mb:used,lite_storage_pendente_bytes:0}]]);
  const blobStore=new Map(),requests=[],routes=new Map();
  function ref(key){
    return {key,collection(name){return collection(key+'/'+name);},async get(){return read(key);}};
  }
  function read(key){
    return {id:key.split('/').at(-1),exists:dbFiles.has(key),
      data:()=>dbFiles.get(key)?{...dbFiles.get(key)}:undefined};
  }
  function collection(key){
    return {doc(id){return ref(key+'/'+id);},
      orderBy(){return this;},limit(){return this;},
      async get(){return {docs:[...dbFiles.keys()].filter(k=>k.startsWith(key+'/')&&k.split('/').length===key.split('/').length+1)
        .map(read)};}};
  }
  const db={
    collection,
    async runTransaction(fn){
      const writes=[];
      const tx={
        async get(doc){return read(doc.key);},
        set(doc,values,options){writes.push(()=>dbFiles.set(doc.key,{...(options?.merge?dbFiles.get(doc.key):{}),...values}));},
        create(doc,values){if(dbFiles.has(doc.key))throw Error('ALREADY_EXISTS');writes.push(()=>dbFiles.set(doc.key,values));},
        update(doc,values){writes.push(()=>dbFiles.set(doc.key,{...dbFiles.get(doc.key),...values}));},
        delete(doc){writes.push(()=>dbFiles.delete(doc.key));}
      };
      const out=await fn(tx);for(const w of writes)w();return out;
    }
  };
  const bucket={file(name){return {
    async save(data){requests.push(['upload',name]);if(saveFails)throw Error('GCS offline');blobStore.set(name,Buffer.from(data));},
    async delete(){requests.push(['delete',name]);blobStore.delete(name);},
    createReadStream(){requests.push(['read',name]);return {on(){return this;},pipe(res){res.streamed=name;}};}
  };}};
  const router={
    get(url,...handlers){routes.set('GET '+url,handlers);},
    post(url,...handlers){routes.set('POST '+url,handlers);}
  };
  const module={exports:{}};
  const code=fs.readFileSync(path.join(__dirname,'liteFiles.cjs'),'utf8');
  const flags={SOFTLOAD_LITE_FILES_ENABLED:enabled?'true':'false'};
  vm.runInNewContext(code,{module,exports:module.exports,Buffer,URL,Date,console,process:{env:flags},
    require(name){
      if(name==='express')return {Router:()=>router,raw:()=>(_req,_res,next)=>next()};
      if(name==='express-rate-limit')return ()=>((_req,_res,next)=>next());
      if(name==='node:crypto')return crypto;
      if(name==='node:path')return path;
      if(name==='../../services/firebase')return {db,bucket};
      if(name==='../../middlewares/authGuard')return {exigirLogin:(_req,_res,next)=>next()};
      if(name==='../../services/essentialStoragePolicy.cjs')return {
        MB,DAY:86400000,currentStorageLimit(a){
          const exp=Date.parse(a.premium_ate||'');
          return a.is_active&&exp>Date.now()&&a.plano==='essencial'?50:5;
        }};
      throw Error('Unexpected dependency: '+name);
    }},{filename:'liteFiles.cjs'});
  const req={session:{user:{uid:owner,email},liteFilesCsrf:token},body:Buffer.from('a'),
    params:{},get(key){return ({
      'x-lite-csrf':token,'x-file-name':'modelo.xml',origin:'https://softload.example.test',
      host:'softload.example.test'})[key.toLowerCase()];}};
  function res(){
    return {code:200,headersSent:false,body:null,status(n){this.code=n;return this;},
      json(a){this.body=a;return this;},send(s){this.body=s;return this;},
      render(view,data){this.view=view;this.locals=data;return this;},
      redirect(...args){this.redirected=args;return this;},
      set(a){this.headers=a;return this;},end(){this.ended=true;return this;},
      destroy(){this.destroyed=true;return this;}};
  }
  async function call(method,url,request=req){const response=res();const handlers=routes.get(method+' '+url);
    assert.ok(handlers,'Missing route: '+method+' '+url);
    for(const handler of handlers){let continued=false;
      await handler(request,response,()=>{continued=true;});
      if(!continued)break;
    }
    return response;}
  return {owner,root,token,req,routes,dbFiles,blobStore,requests,call};
}
test('feature flag desligada impede gravações e não expõe arquivos',async()=>{
  const x=fixture({enabled:false});
  const list=await x.call('GET','/dashboard/arquivos');
  assert.equal(list.view,'pages/arquivos-simples');assert.equal(list.locals.enabled,false);
  assert.equal(x.routes.has('POST /dashboard/arquivos/upload'),true);
  const denied=await x.call('POST','/dashboard/arquivos/upload');
  assert.equal(denied.code,503);
  assert.equal(x.blobStore.size,0);
});
test('conta gratuita reserva/debita bytes no mesmo saldo Firestore e usa prefixo privado',async()=>{
  const f=fixture();
  const saved=await f.call('POST','/dashboard/arquivos/upload');
  assert.equal(saved.code,201);assert.equal(saved.body.bytes,1);
  assert.match(saved.body.id,/^[a-f0-9-]{36}$/i);
  const account=f.dbFiles.get(f.root);
  assert.equal(account.lite_storage_pendente_bytes,0);
  assert.equal(account.storage_usado_mb,1/MB);
  assert.equal(f.blobStore.size,1);
  assert.equal([...f.blobStore.keys()][0],'users/'+f.owner+'/lite-v1/'+saved.body.id);
  const page=await f.call('GET','/dashboard/arquivos');
  assert.equal(page.locals.items.length,1);
  assert.equal(page.locals.limitMb,5);
  assert.equal(page.locals.items[0].state,'ready');
});
test('limite Free é 5 MB; plano Essencial ativo aceita 50 MB, mas não 51 MB',async()=>{
  const free=fixture({used:5});
  assert.equal((await free.call('POST','/dashboard/arquivos/upload')).code,413);
  assert.equal(free.blobStore.size,0);
  const paid=fixture({premium:true,used:49});
  assert.equal((await paid.call('POST','/dashboard/arquivos/upload')).code,201);
  assert.equal((await paid.call('GET','/dashboard/arquivos')).locals.limitMb,50);
  const full=fixture({premium:true,used:50});
  assert.equal((await full.call('POST','/dashboard/arquivos/upload')).code,413);
});
test('CSRF ou nome inválidos bloqueiam upload antes de Firestore/GCS',async()=>{
  const f=fixture();
  const bad={...f.req,session:{...f.req.session,liteFilesCsrf:'b'.repeat(48)}};
  assert.equal((await f.call('POST','/dashboard/arquivos/upload',bad)).code,403);
  const name={...f.req,get(key){return key==='x-file-name'?'../segredo.sh':f.req.get(key);}};
  assert.equal((await f.call('POST','/dashboard/arquivos/upload',name)).code,400);
  assert.equal(f.blobStore.size,0);
});
test('erro de gravação devolve reserva e não publica arquivo quebrado',async()=>{
  const f=fixture({saveFails:true});
  assert.equal((await f.call('POST','/dashboard/arquivos/upload')).code,503);
  assert.equal(f.dbFiles.get(f.root).lite_storage_pendente_bytes,0);
  assert.equal((await f.call('GET','/dashboard/arquivos')).locals.items.length,0);
});
test('download e exclusão usam manifestos de dono autenticado, sem afetar arquivos legados',async()=>{
  const f=fixture(),u=await f.call('POST','/dashboard/arquivos/upload');const id=u.body.id;
  f.req.params={id};
  const get=await f.call('GET','/dashboard/arquivos/:id/download');
  assert.equal(get.streamed,'users/'+f.owner+'/lite-v1/'+id);
  const wrong={...f.req,session:{...f.req.session,user:{uid:'uid-foreign-user-001',email:'other@example.test'}}};
  assert.equal((await f.call('GET','/dashboard/arquivos/:id/download',wrong)).code,404);
  const deletion={...f.req,body:{liteFilesCsrf:f.token}};
  const deleted=await f.call('POST','/dashboard/arquivos/:id/excluir',deletion);
  assert.deepEqual(deleted.redirected,[303,'/dashboard/arquivos']);
  assert.equal(f.blobStore.size,0);
  assert.equal(f.dbFiles.get(f.root).storage_usado_mb,0);
  assert.equal(f.requests.some(([op,p])=>op==='delete'&&!p.includes('/lite-v1/')),false);
});
test('página EJS apresenta cotas, histórico e upload sem carregar React',async()=>{
  const view=path.join(__dirname,'../../../views/pages/arquivos-simples.ejs');
  const html=await new Promise((resolve,reject)=>ejs.renderFile(view,{
    enabled:true,items:[],limitMb:50,usedMb:0,csrfToken:'a'.repeat(48),
    gitSha:'demo',activePage:'arquivos',user:{email:'user@example.test'}
  },{},(e,s)=>e?reject(e):resolve(s)));
  assert.match(html,/Meus arquivos/);
  assert.match(html,/50 MB/);
  assert.match(html,/X-Lite-CSRF/);
  assert.match(html,/dashboard\/historico/);
  assert.doesNotMatch(html,/react-root|\/dist\/assets\/main\.js/);
});
