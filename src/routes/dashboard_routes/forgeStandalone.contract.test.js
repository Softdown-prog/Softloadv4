'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ejs=require('ejs');
const dirname=__dirname;
function harness({paid=false}={}) {
  const item={recipeId:'tools/visitor_forge_2d/examples/pixel_character_wizard_mini_01.json',
    command:'render-pixel-character',id:'personagem-pixel'};
  const fake={catalog(){return {recipes:[item]};},async render(){throw Error('Renderer fake (no external work)');}};
  const db={collection(name){assert.equal(name,'clientes_premium');return {doc(){return {
    async get(){return {exists:true,data:()=>({plano:paid?'essencial':'free',is_active:paid,
      premium_ate:new Date(Date.now()+86400000).toISOString()})};}
  };}};}};
  const module={exports:{}};
  const code=fs.readFileSync(path.join(dirname,'forgeStandalone.cjs'),'utf8');
  vm.runInNewContext(code,{module,exports:module.exports,Date,Set,URL,Buffer,console,
    require(id){
      if(id.startsWith('node:'))return require(id);
      if(id==='../../services/firebase')return {db};
      if(id==='../../../agent/forge/index.cjs')return fake;
      throw Error('Dependência não simulada: '+id);
    }},{filename:'forgeStandalone.cjs'});
  const res={statusCode:200,headersSent:false,status(n){this.statusCode=n;return this;},
    send(s){this.body=s;return this;},type(){return this;},
    render(view,locals){this.view=view;this.locals=locals;}};
  const req={session:{user:{email:'user@example.test'}},body:{receita:item.recipeId},
    get:()=>null};
  return {api:module.exports,req,res,prepare(){module.exports.show(req,res);req.body.forgeCsrfToken=req.session.forgeCsrfToken;}};
}
test('A7 Forge lista receitas procedurais sem Agent HTTP ou IA',()=>{
  const h=harness();h.api.show(h.req,h.res);
  assert.equal(h.res.view,'pages/forge-2d');
  assert.equal(h.res.locals.receitas.length,1);
  assert.equal(h.res.locals.receitas[0].comando,'render-pixel-character');
  assert.doesNotMatch(fs.readFileSync(path.join(dirname,'forgeStandalone.cjs'),'utf8'),/geminiService|openai|https:\/\//i);
});
test('A7 Forge bloqueia receita inexistente e conta gratuita antes de renderizar',async()=>{
  const h=harness();h.prepare();h.req.body.receita='../../segredo';
  await h.api.download(h.req,h.res);
  assert.equal(h.res.statusCode,400);
  const n=harness();n.prepare();
  await n.api.download(n.req,n.res);
  assert.equal(n.res.statusCode,402);
});
test('A7 Forge não retorna arquivo falso em falha de render',async()=>{
  const h=harness({paid:true});h.prepare();
  await h.api.download(h.req,h.res);
  assert.equal(h.res.statusCode,503);
});
test('Forge exige CSRF válido antes de consultar assinatura',async()=>{
  const h=harness({paid:true});
  await h.api.download(h.req,h.res);
  assert.equal(h.res.statusCode,403);
  const h2=harness({paid:true});
  h2.prepare();
  h2.req.body.forgeCsrfToken='f'.repeat(48);
  await h2.api.download(h2.req,h2.res);
  assert.equal(h2.res.statusCode,403);
});
test('View A7 Forge é EJS nativo, sem React',async()=>{
  const p=path.resolve(dirname,'../../../views/pages/forge-2d.ejs');
  const html=await new Promise((resolve,reject)=>ejs.renderFile(p,{gitSha:'test',user:{email:'x'},
    activePage:'forge-2d',forgeCsrfToken:'f'.repeat(48),receitas:[{id:'item',nome:'Personagem',comando:'render-pixel-character'}]}, {},
    (err,out)=>err?reject(err):resolve(out)));
  assert.match(html,/Criar imagens e objetos 2D/);
  assert.match(html,/dashboard\/forge-2d\/download/);
  assert.doesNotMatch(html,/react-root|\/dist\/assets\/main\.js/);
});
