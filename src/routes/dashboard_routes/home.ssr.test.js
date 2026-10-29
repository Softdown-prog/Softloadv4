'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ejs=require('ejs');
const root=path.resolve(__dirname,'../../..');

test('dashboard continua protegido mas entrega EJS simples no lugar do React',()=>{
  const routes=[];
  const exigirLogin=(_req,_res,next)=>next();
  const router={get(url,...handlers){routes.push({url,handlers});}};
  const sandbox={
    exports:{},module:{exports:{}},
    require(name) {
      if(name==='express')return {Router:()=>router};
      if(name==='../../middlewares/authGuard')return {exigirLogin};
      throw Error('Dependência não prevista: '+name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'home.js'),'utf8'),sandbox);
  assert.equal(sandbox.module.exports,router);
  assert.equal(routes.length,1);
  assert.equal(routes[0].url,'/dashboard');
  assert.equal(routes[0].handlers[0],exigirLogin);
  const user={uid:'teste',nome:'Cliente'};
  let received;
  routes[0].handlers[1]({session:{user}},{render(view,locals){received={view,locals};}});
  assert.equal(received.view,'pages/dashboard-simples');
  assert.equal(received.locals.user,user);
  assert.equal(received.locals.activePage,'home');
  assert.match(fs.readFileSync(path.join(__dirname,'home.ts'),'utf8'),/pages\/dashboard-simples/);
});
test('home EJS renderiza sem bundle React, protege dados e facilita o acesso ao Blogger',async()=>{
  const file=path.join(root,'views/pages/dashboard-simples.ejs');
  const html=await new Promise((resolve,reject)=>ejs.renderFile(file,{
    gitSha:'teste',activePage:'home',user:{nome:'<script>alert(1)</script>'}
  },{},(err,markup)=>err?reject(err):resolve(markup)));
  assert.match(html,/Criar meu template/);
  assert.match(html,/href="\/dashboard\/gerador-blogger"/);
  assert.match(html,/href="\/dashboard\/historico"/);
  assert.match(html,/href="\/dashboard\/configuracoes"/);
  assert.match(html,/href="\/dashboard\/forge-2d"/);
  assert.match(html,/href="\\/dashboard\\/arquivos"/);
  assert.doesNotMatch(html,/href="\/dashboard\/workspace"/);
  assert.doesNotMatch(html,/react-root|\/dist\/assets\/main\.js/);
  assert.match(html,/cookie-engine/);
});
