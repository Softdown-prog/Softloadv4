'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const ejs=require('ejs');

function readAuthRouter(){
  const routes=[];
  const router={
    get(url,handler){routes.push({method:'GET',url,handler});},
    post(url,limiter,handler){routes.push({method:'POST',url,handler});},
  };
  const context={
    module:{exports:{}},exports:{},console,
    require(name){
      if(name==='express')return {Router:()=>router};
      if(name==='express-rate-limit')return ()=>((_req,_res,next)=>next());
      if(name==='../services/firebase')return {db:{},admin:{}};
      if(name==='../services/emailService')return {enviarBoasVindas(){},enviarRecuperacaoSenha(){}};
      throw Error('Dependência inesperada: '+name);
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'authRoutes.js'),'utf8'),context);
  assert.equal(context.module.exports,router);
  return routes;
}
test('autenticação GET renderiza EJS sem React e preserva URLs POST Firebase',()=>{
  const routes=readAuthRouter();
  for(const mode of ['login','register','recover']){
    const route=routes.find(r=>r.method==='GET'&&r.url==='/'+mode);
    assert.ok(route,'rota GET ausente: '+mode);
    const received=[];
    route.handler({session:{}},{render(view,locals){received.push([view,locals.authMode]);}});
    assert.equal(JSON.stringify(received),JSON.stringify([['pages/auth-simples',mode]]));
    let redirect='';
    route.handler({session:{user:{uid:'abc'}}},{redirect(url){redirect=url;}});
    assert.equal(redirect,'/dashboard');
    assert.ok(routes.find(r=>r.method==='POST'&&r.url==='/'+mode),'POST não deve ser removido: '+mode);
  }
});
test('as 3 telas autenticam por formulário simples, sem React nem dependências de IA',async()=>{
  const file=path.resolve(__dirname,'../../views/pages/auth-simples.ejs');
  for(const [mode,action] of [['login','/login'],['register','/register'],['recover','/recover']]){
    const html=await new Promise((resolve,reject)=>ejs.renderFile(file,{
      gitSha:'test',user:null,authMode:mode,activePage:'auth',
    },{},(err,result)=>err?reject(err):resolve(result)));
    assert.match(html,new RegExp('action="'+action+'"'));
    assert.match(html,/href="\/privacidade"|Política de Privacidade|Recuperar senha|Entrar na Softload/);
    assert.match(html,/name="email"/);
    assert.match(html,/textContent = message/);
    assert.doesNotMatch(html,/id="react-root"|\/dist\/assets\/main\.js/);
  }
});
