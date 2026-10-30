'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const ejs=require('ejs');
const preview=require('../../public/js/blogger-preview.js');
const {COLOR_PRESETS}=require('../core/presets');
const {NICHO_PAGE_TYPE_MAP}=require('../core/nichoTaxonomy');

test('código servido ao navegador é igual à fonte TypeScript, sem divergência',()=>{
  const fs=require('node:fs');
  const base=path.resolve(__dirname,'../../public/js/blogger-preview');
  const ts=fs.readFileSync(base+'.ts','utf8').replace(/^\/\/ @ts-nocheck[^\n]*\n/,'');
  const js=fs.readFileSync(base+'.js','utf8');
  assert.equal(ts,js);
});
function config(niche,pageType){
  const p=COLOR_PRESETS['tech-blue'];
  return {siteName:'Blog de Teste',niche,pageType,accent:p.primary,bg:p.bgBody,surface:p.cardBg,text:p.textMain,footer:p.footerBg,typography:'playfair',layout:'dupla',side:'left'};
}

test('prévia é um HTML local sem Chromium, script de terceiro ou rede',()=>{
  const html=preview.renderMarkup(config('noticias-mag-news','portal-noticias'));
  assert.match(html,/<!doctype html>/i);
  assert.match(html,/lang="pt-BR"/);
  assert.match(html,/Blog de Teste/);
  assert.match(html,/EM DESTAQUE/);
  assert.match(html,/side-left/);
  assert.match(html,/layout-dupla/);
  assert.match(html,/Georgia,Times New Roman,serif/);
  assert.doesNotMatch(html,/<script|<iframe|<link|https?:\/\/|fetch\(/i);
});
test('prévia distingue todas as famílias visuais e os 15 nichos',()=>{
  const examples={
    'biolink-social':'bio-link',
    'portfolio-minimalista':'portfolio-tile',
    'saas-nexus':'landing-visual',
    'elearning-academy':'learning-grid',
    'appstore-bulma-mobile':'apps-grid',
    'tecnologia-mag-tech':'breaking',
    'gamer-playerone':'post-card'
  };
  for(const [niche,expected] of Object.entries(examples)){
    const html=preview.renderMarkup(config(niche,NICHO_PAGE_TYPE_MAP[niche]));
    assert.ok(html.includes(expected),niche+' deveria conter '+expected);
  }
  for(const [niche,pageType] of Object.entries(NICHO_PAGE_TYPE_MAP)){
    const html=preview.renderMarkup(config(niche,pageType));
    assert.match(html,/Blog de Teste/);
    assert.ok(html.length>7000,niche+' HTML incompleto');
  }
});
test('cores inválidas e título digitado não injetam HTML/CSS na prévia',()=>{
  const html=preview.renderMarkup({
    siteName:'<img src=x onerror=alert(1)>',
    niche:'__proto__',
    pageType:'foo',
    accent:'red; background:url(https://evil.test)',
    bg:'red',surface:'#ffffff',text:'#121212',footer:'#002244',
    layout:'__proto__',side:'__proto__',typography:'__proto__'
  });
  assert.match(html,/&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html,/<img src=x|evil\.test|background:url/);
  assert.match(html,/#0ea5e9/);
  assert.match(html,/layout-revista/);
  assert.match(html,/side-right/);
});
test('viewport aplica dimensões reais no iframe sem alterar o DOM do editor',()=>{
  const iframe={style:{},srcdoc:''};
  const stage={style:{},dataset:{},clientWidth:550};
  const viewer=preview.mount(iframe,stage);
  assert.ok(viewer);
  viewer.render(config('saas-nexus','landing-page'));
  assert.match(iframe.srcdoc,/landing-visual/);
  assert.equal(stage.dataset.width,'1080');
  assert.equal(iframe.style.width,'1080px');
  assert.ok(iframe.style.transform.includes('scale(0.509'));
  viewer.setDevice('tablet');
  assert.equal(iframe.style.width,'768px');
  viewer.setDevice('mobile');
  assert.equal(iframe.style.width,'390px');
  assert.equal(stage.dataset.width,'390');
  assert.match(iframe.style.transform,/scale\(1\)/);
  viewer.setDevice('invalido');
  assert.equal(stage.dataset.device,'mobile');
});
test('editor EJS inclui iframe sem scripts e controles de tela com dados de paleta',async()=>{
  const html=await ejs.renderFile(path.resolve(__dirname,'../../views/pages/gerador-blogger.ejs'),{
    gitSha:'preview-test',user:null,guestMode:true,guestToken:'a'.repeat(48),
    activePage:null,downloadPath:'/criar/download',gratuitoLimite:2,
    nichos:[{id:'noticias-mag-news',nome:'Notícias',pageType:'portal-noticias'}],
    cores:[{id:'tech-blue',nome:'Azul',hex:'#0ea5e9',bg:'#f8fafc',surface:'#ffffff',text:'#1e293b',footer:'#0f172a'}],
    fontes:[{id:'inter',nome:'Inter'}],exemplos:[]
  });
  assert.match(html,/id="preview-iframe"/);
  assert.match(html,/sandbox=""/);
  assert.match(html,/id="preview-stage"/);
  assert.match(html,/data-preview-device="desktop"/);
  assert.match(html,/data-preview-device="tablet"/);
  assert.match(html,/data-preview-device="mobile"/);
  assert.match(html,/data-page-type="portal-noticias"/);
  assert.match(html,/data-bg="#f8fafc"/);
  assert.match(html,/\/js\/blogger-preview\.js\?v=preview-test/);
  assert.doesNotMatch(html,/fake-blog|fake-card|fake-grid/);
  assert.match(html,/não substitui|precisam ser conferidos no Blogger/i);
});
