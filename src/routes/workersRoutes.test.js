'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
function setup(){
 const routes=new Map(),calls=[],zip={};
 const router={get:(p,...args)=>{routes.set(p,{middlewares:args.slice(0,-1),handler:args.at(-1)});}};
 const requireFake=id=>{
   if(id==='express')return {Router:()=>router};
   if(id==='archiver')return (type,config)=>{assert.equal(type,'zip');assert.equal(config.zlib.level,6);return {
       on:(e,cb)=>{zip.error=cb},pipe:dest=>{zip.destination=dest},append:(s,opt)=>{zip.payload=s;zip.name=opt.name},
       finalize:()=>{zip.finalized=true}
   }};
   if(id.includes('workerGuard'))return {exigirWorkerAccess:function workerGuard(){}};
   if(id.includes('authGuard'))return {exigirLogin:function loginGuard(){}};
   if(id.includes('sentinelWorker'))return {getStatus:()=>({healthy:true}),getHistoryScores:n=>{calls.push(n);return ['score']}};
   if(id.includes('errorLogWorker'))return {getLogsAndStats:()=>({stats:{n:2},logs:[{code:'test'}]})};
   throw Error('Unmocked dependency '+id);
 };
 const mod={exports:{}};
 vm.runInNewContext(fs.readFileSync(path.join(__dirname,'workersRoutes.js'),'utf8'),
  {module:mod,exports:mod.exports,require:requireFake,console,Math,parseInt,JSON,Date},{filename:'workersRoutes.js'});
 const req=(query={})=>({session:{user:{id:1}},query});
 const res=()=>{const value={headers:{},statusCode:200,body:null,view:null,
    status(n){this.statusCode=n;return this;},json(b){this.body=b;return this},
    render(v,ctx){this.view=v;this.context=ctx},send(v){this.body=v;return this},
    setHeader(k,v){this.headers[k]=v}};return value;};
 return {routes,calls,zip,req,res};
}
test('seis rotas de worker mantêm guards e endpoints estáveis',()=>{
 const f=setup();
 assert.equal(f.routes.size,6);
 for(const item of f.routes.values())assert.equal(item.middlewares.length,2);
 const r=f.res();f.routes.get('/workers').handler(f.req(),r);
 assert.equal(r.view,'pages/workers/worker_health');
 assert.equal(r.context.titulo,'Workers — Sentinel Health Dashboard');
 const s=f.res();f.routes.get('/workers/api/status').handler(f.req(),s);
 assert.equal(s.body.healthy,true);
});
test('limites do histórico, log JSON e stream ZIP preservados',()=>{
 const f=setup();
 const limit=f.res();f.routes.get('/workers/api/scores').handler(f.req({limit:'200'}),limit);
 assert.equal(f.calls[0],100);
 const json=f.res();f.routes.get('/workers/api/errors/download').handler(f.req({format:'json'}),json);
 assert.match(json.headers['Content-Type'],/application\/json/);
 assert.match(json.body,/"n": 2/);
 const zip=f.res();f.routes.get('/workers/api/errors/download').handler(f.req(),zip);
 assert.equal(f.zip.name,'error-log.json');assert.equal(f.zip.destination,zip);assert.equal(f.zip.finalized,true);
 assert.equal(zip.headers['Content-Type'],'application/zip');
});
