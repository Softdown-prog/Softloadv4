'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const ejs=require('ejs');
const path=require('node:path');
const views=path.resolve(__dirname,'../../views');

async function browserScenario({status=200,mime='application/xml; charset=utf-8',text='',allowFetch=true,redirected=false}={}){
  const html=await new Promise((resolve,reject)=>ejs.renderFile(
    path.join(views,'pages/gerador-blogger.ejs'),{
      gitSha:'browser-test',user:null,guestMode:true,activePage:null,
      guestToken:'a'.repeat(48),downloadPath:'/criar/download',
      gratuitoLimite:2,nichos:[{id:'noticias-mag-news',nome:'Notícias',aviso:null}],
      cores:[{id:'tech-blue',nome:'Azul'}],fontes:[{id:'inter',nome:'Inter'}]
    },{},(err,result)=>err?reject(err):resolve(result)));
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m=>m[1]);
  const generator=scripts.find(s=>s.includes("const form=document.getElementById('generator-form')"));
  assert.ok(generator,'script real do formulário não está no HTML');
  assert.match(html,/id="download-link"/);
  const events={};const elements={};
  function element(id,extra={}){
    const el={
      id,value:'',hidden:false,disabled:false,selectedIndex:0,
      style:{},dataset:{},options:[{value:'tech-blue'}],
      selectedOptions:[{dataset:{aviso:''}}],classList:{toggle(){}},
      textContent:'',clicks:0,
      addEventListener(name,handler){events[id+':'+name]=handler;},
      removeAttribute(name){delete this[name];},
      click(){this.clicks++;},
      ...extra
    };
    elements[id]=el;return el;
  }
  const form=element('generator-form',{action:'https://softload.analysepro.com/criar/download',
    fields:[['guestToken','a'.repeat(48)],['modo','novo'],['siteName','Blog Demo'],
      ['colorPreset','tech-blue'],['typography','inter'],['gridLayout','revista'],['sidebarPosition','right']],
    querySelector(){return {value:'novo'};}});
  element('nichoTema');element('nicho-wrapper');element('fake-body');
  element('fake-grid');element('fake-aside');element('nicho-aviso');
  element('preview-title');element('siteName',{value:'Blog Demo'});
  element('sidebarPosition',{value:'right'});
  element('gridLayout',{value:'revista'});
  element('colorPreset',{value:'tech-blue'});
  element('typography',{value:'inter'});
  element('download-template');
  element('download-link',{hidden:true});
  element('form-message');
  element('surpreender-estilo');element('salvar-escolhas');
  const document={
    getElementById(id){assert.ok(elements[id],'missing fake '+id);return elements[id];},
    querySelector(selector){assert.equal(selector,'.fake-header');return {style:{}};}
  };
  let created=0,revoked=0,requests=[];
  const urlAPI={createObjectURL(){created++;return 'blob:fake-xml-download';},revokeObjectURL(){revoked++;}};
  const resultResponse={
    status,ok:status>=200&&status<300,redirected,
    headers:{get(key){
      if(key==='content-type')return mime;
      if(key==='content-disposition')return 'attachment; filename="blog-demo.xml"';
      return null;
    }},
    async text(){return text;},
    async blob(){return {size:47000,type:'application/xml'};}
  };
  const fetch=async (url,options)=>{requests.push({url,options});return resultResponse;};
  const ctx={
    document,fetch,
    URL:urlAPI,URLSearchParams,
    window:{fetch:allowFetch?fetch:null,URL:urlAPI,addEventListener(){}},
    localStorage:{getItem(){return null;},setItem(){}},
    crypto:{getRandomValues(a){a[0]=5;}},
    Uint32Array,
    FormData:class {constructor(node){assert.equal(node,form);return node.fields;}}
  };
  vm.runInNewContext(generator,ctx,{timeout:1000,filename:'rendered-blogger-editor.js'});
  assert.equal(typeof events['generator-form:submit'],'function');
  let prevented=false;
  await events['generator-form:submit']({preventDefault(){prevented=true;}});
  return {elements,requests,prevented,created,revoked};
}

test('editor do navegador usa POST com sessão e conserva link XML caso download automático falhe',async()=>{
  const s=await browserScenario();
  assert.equal(s.prevented,true);
  assert.equal(s.requests.length,1);
  assert.equal(s.requests[0].options.method,'POST');
  assert.equal(s.requests[0].options.credentials,'same-origin');
  assert.match(s.requests[0].options.body,/guestToken=a{48}/);
  assert.equal(s.elements['download-link'].hidden,false);
  assert.equal(s.elements['download-link'].download,'blog-demo.xml');
  assert.equal(s.elements['download-link'].href,'blob:fake-xml-download');
  assert.equal(s.elements['download-link'].clicks,1);
  assert.match(s.elements['form-message'].textContent,/XML gerado com sucesso/);
  assert.equal(s.elements['download-template'].disabled,false);
});

test('limite atingido e erro de sessão aparecem no editor sem navegar ou gerar link falso',async()=>{
  for(const [status,mime,text,expected] of [
    [402,'text/plain; charset=utf-8','Você já utilizou seus 2 downloads gratuitos.',/2 downloads gratuitos/],
    [429,'text/plain','Seus testes sem cadastro nesta sessão terminaram.',/testes sem cadastro/],
    [503,'text/plain','Não foi possível salvar sua sessão.',/salvar sua sessão/],
    [403,'text/plain','Formulário expirado. Reabra o gerador.',/Formulário expirado/]
  ]){
    const s=await browserScenario({status,mime,text});
    assert.equal(s.prevented,true);
    assert.equal(s.elements['download-link'].hidden,true);
    assert.equal(s.created,0);
    assert.match(s.elements['form-message'].textContent,expected);
    assert.equal(s.elements['download-template'].disabled,false);
  }
});

test('sem fetch o formulário continua usando POST HTML nativo; redirect para login não vira download',async()=>{
  const noJs=await browserScenario({allowFetch:false});
  assert.equal(noJs.prevented,false);
  assert.equal(noJs.requests.length,0);
  const redirected=await browserScenario({status:200,mime:'text/html',redirected:true});
  assert.match(redirected.elements['form-message'].textContent,/sessão mudou/i);
  assert.equal(redirected.elements['download-link'].hidden,true);
});
