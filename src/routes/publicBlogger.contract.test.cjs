'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const ejs=require('ejs');
const crypto=require('node:crypto');

function fixture(){
  const routes={get:new Map(),post:new Map()};
  const router={
    get(url,...handlers){routes.get.set(url,handlers);},
    post(url,...handlers){routes.post.set(url,handlers);}
  };
  const module={exports:{}};
  let compiled=0;
  const compiler={
    publicCatalog:()=>[{id:'noticias-mag-news',nome:'Notícias',aviso:null}],
    publicPresets:()=>({cores:[{id:'tech-blue',nome:'Azul'}],fontes:[{id:'inter',nome:'Inter'}]}),
    publicCompile:()=>{compiled++;return{slug:'teste',xmlFinal:"<html><b:widget id='Blog1' type='Blog'/></html>"};}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'publicBlogger.cjs'),'utf8'),{
    module,exports:module.exports,Set,URL,Buffer,Number,console,
    require(name){
      if(name==='express')return{Router:()=>router};
      if(name==='express-rate-limit')return()=>()=>{};
      if(name==='node:crypto')return crypto;
      if(name==='./dashboard_routes/compiler')return compiler;
      throw Error('Dependência não simulada: '+name);
    }
  },{filename:'publicBlogger.cjs'});
  function req(){
    const session={save(callback){callback(null);}};
    return {session,sessionID:'guest-session-01',body:{},get:()=>undefined};
  }
  function res(){
    return {code:200,headers:{},status(v){this.code=v;return this;},
      type(){return this;},set(v){this.headers=v;return this;},
      send(v){this.text=v;return this;},render(v,locals){this.view=v;this.locals=locals;return this;},
      redirect(code,url){this.redirectCode=code;this.redirectUrl=url;return this;}};
  }
  function get(url,request=req()){
    const response=res();
    const handlers=routes.get.get(url);assert.ok(handlers);
    handlers.at(-1)(request,response);
    return {request,response};
  }
  async function post(url,request){
    const response=res();
    const handlers=routes.post.get(url);assert.ok(handlers);
    await handlers.at(-1)(request,response);
    return response;
  }
  return {req,res,get,post,routes,get compiled(){return compiled;}};
}

test('público pode abrir editor sem login e receber token CSRF',()=>{
  const f=fixture(),{request,response}=f.get('/criar');
  assert.equal(response.view,'pages/gerador-blogger');
  assert.equal(response.locals.guestMode,true);
  assert.equal(response.locals.user,null);
  assert.equal(response.locals.downloadPath,'/criar/download');
  assert.match(request.session.bloggerGuestToken,/^[0-9a-f]{48}$/);
  assert.equal(response.locals.nichos.length,1);
});

test('visitante só baixa dois XML por sessão, depois recebe 429; não exige Firebase Auth',async()=>{
  const f=fixture();
  const {request}=f.get('/criar');
  request.body={guestToken:request.session.bloggerGuestToken};
  for(let i=0;i<2;i++){
    const response=await f.post('/criar/download',request);
    assert.equal(response.code,200);
    assert.match(response.text,/Blog1/);
  }
  const denied=await f.post('/criar/download',request);
  assert.equal(denied.code,429);
  assert.equal(f.compiled,2);
  assert.equal(request.session.bloggerGuestDownloads,2);
});

test('CSRF e Origin estranhos não compilam nem consomem cota',async()=>{
  const f=fixture(),{request}=f.get('/criar');
  request.body={guestToken:'0'.repeat(48)};
  assert.equal((await f.post('/criar/download',request)).code,403);
  request.body.guestToken=request.session.bloggerGuestToken;
  request.get=n=>n==='origin'?'https://evil.example':'softload.example';
  assert.equal((await f.post('/criar/download',request)).code,403);
  assert.equal(request.session.bloggerGuestDownloads,undefined);
  assert.equal(f.compiled,0);
});

test('se a sessão não persistir, não libera o download e não consome teste',async()=>{
  const f=fixture(),{request}=f.get('/criar');
  request.body={guestToken:request.session.bloggerGuestToken};
  request.session.save=callback=>callback(new Error('Storage unavailable'));
  const response=await f.post('/criar/download',request);
  assert.equal(response.code,503);
  assert.equal(response.text.includes('Nenhum teste foi debitado'),true);
  assert.equal(request.session.bloggerGuestDownloads,0);
});

test('usuário autenticado usa a rota protegida e os benefícios da conta',async()=>{
  const f=fixture();
  const req=f.req();req.session.user={uid:'123',email:'a@example.test'};
  const {response}=f.get('/criar',req);
  assert.equal(response.redirectCode,302);
  assert.equal(response.redirectUrl,'/dashboard/gerador-blogger');
  const output=await f.post('/criar/download',req);
  assert.equal(output.redirectCode,303);
  assert.equal(f.compiled,0);
});

test('view EJS pública funciona sem conta e não anuncia Forge',async()=>{
  const file=path.resolve(__dirname,'../../views/pages/gerador-blogger.ejs');
  const locals={gitSha:'testing',user:null,activePage:null,guestMode:true,downloadPath:'/criar/download',
    guestToken:'a'.repeat(48),nichos:[{id:'noticias-mag-news',nome:'Notícias',aviso:null}],\n    cores:[{id:'tech-blue',nome:'Azul'}],fontes:[{id:'inter',nome:'Inter'}],gratuitoLimite:2};\n  const html=await new Promise((resolve,reject)=>ejs.renderFile(file,locals,{},(err,out)=>err?reject(err):resolve(out)));\n  assert.match(html,/criar\\/download/);\n  assert.match(html,/2 XML por sessão/);\n  assert.doesNotMatch(html,/A7 Forge|forge-2d|react-root/);\n});
});
