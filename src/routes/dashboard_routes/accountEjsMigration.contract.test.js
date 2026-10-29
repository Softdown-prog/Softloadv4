'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ejs=require('ejs');
const root=path.resolve(__dirname,'../../..');

function routeFile(moduleName){
  const routes=[];
  const guard=()=>{};
  const router={get(p,m,h){assert.equal(m,guard);routes.push({p,h});}};
  const mod={exports:{}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,moduleName+'.js'),'utf8'),{
    module:mod,exports:mod.exports,
    process:{env:{BLOGGER_ESSENCIAL_CHECKOUT_ENABLED:'false'}},
    require(name){
      if(name==='express')return{Router:()=>router};
      if(name==='../../middlewares/authGuard')return{exigirLogin:guard};
      throw Error('Runtime require inesperado: '+name);
    }
  },{filename:moduleName+'.js'});
  assert.equal(mod.exports,router);
  return routes;
}

test('configurações e upgrade EJS preservam autenticação e URL de checkout',()=>{
  const user={email:'user@example.test',plano:'free',nome:'Teste'};
  for(const [moduleName,url,view] of [
    ['configuracoes','/dashboard/configuracoes','pages/configuracoes-simples'],
    ['upgrade','/dashboard/upgrade','pages/plano-essencial'],
    ['upgrade','/dashboard/plano-essencial','pages/plano-essencial'],
  ]){
    const route=routeFile(moduleName).find(r=>r.p===url);
    assert.ok(route,'Rota ausente: '+url);
    let actual;
    route.h({session:{user}},{render(path,values){actual={path,values};}});
    assert.equal(actual.path,view);
    assert.equal(actual.values.user,user);
    if(moduleName==='upgrade')assert.equal(actual.values.checkoutEnabled,false);
  }
});

test('EJS conta, histórico e upgrade não requerem React e preservam downloads',async()=>{
  const values={
    gitSha:'local-test',user:{uid:'uid-test',email:'pessoa@example.test',nome:'<script>alert(1)</script>',plano:'free'},
    activePage:'configuracoes',
  };
  const render=(name,locals={})=>new Promise((resolve,reject)=>{
    ejs.renderFile(path.join(root,'views/pages/'+name+'.ejs'),{...values,...locals},{},
      (err,markup)=>err?reject(err):resolve(markup));
  });
  const account=await render('configuracoes-simples');
  assert.match(account,/dashboard\/plano-essencial/);
  assert.match(account,/dashboard\/arquivos/);
  assert.match(account,/dashboard\/historico/);
  assert.doesNotMatch(account,/<script>alert\(1\)<\/script>|react-root|\/dist\/assets\/main\.js/);
  const hist=await render('historico-simples',{activePage:'historico',arquivos:[
    {id:'legacy-01',nome:'Meu antigo blog',arquivo:'arquivo.zip',tamanhoBytes:1024,criadoEm:'29/10/2026'}
  ]});
  assert.match(hist,/compilacao\/legacy-01\/download/);
  assert.match(hist,/Meu antigo blog/);
  assert.doesNotMatch(hist,/react-root|\/dist\/assets\/main\.js/);
  const upgrade=await render('plano-essencial',{activePage:'plano-essencial'});
  assert.match(upgrade,/R\$ 5,00/);
  assert.match(upgrade,/aceitePoliticaArmazenamento/);
  assert.doesNotMatch(upgrade,/react-root|\/dist\/assets\/main\.js/);
});
