'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function fixture({ args=['gamer-playerone'], document={css_componentes:{cabecalho:'.header { color: #112233; }', blocos:[{css:'.card { background: #fff; }'}]}}, responses=[] }={}) {
  const db={read:[],written:[],gemini:[],logs:[]};
  const module={exports:{}};
  const mockRequire=id=>{
    if(id==='dotenv')return {config(){}};
    if(id==='path')return path;
    if(id==='fs')return {
      readFileSync(file, encoding) {db.read.push(file);assert.equal(encoding,'utf-8');return JSON.stringify(document);},
      writeFileSync(file,data,encoding) {db.written.push({file,data,encoding});}
    };
    if(id==='../src/services/geminiService')return {
      async gerarTexto(prompt) {db.gemini.push(prompt);const v=responses.shift();if(v instanceof Error)throw v;return v===undefined?'{"css_corrigido":[]}' : v;}
    };
    throw Error('Importação inesperada: '+id);
  };
  mockRequire.main=null;
  const sandbox={
    exports:module.exports,module,require:mockRequire,__dirname:__dirname,
    process:{argv:['node','fixImplCssVars.js',...args],cwd:()=>'/tmp',exit(code){throw Error('process.exit não esperado: '+code)}},
    console:{log(...p){db.logs.push(p.join(' '));},warn(...p){db.logs.push(p.join(' '));},error(...p){db.logs.push(p.join(' '));}},
    setTimeout(cb){cb();}
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'fixImplCssVars.js'),'utf8'),sandbox,{filename:'fixImplCssVars.js',timeout:2000});
  return {api:module.exports,db};
}

test('importação é segura; mantém quatro nichos de CSS e não chama Gemini',()=>{
  const {api,db}=fixture();
  assert.equal(api.NICHOS_COM_CSS.length,4);
  assert.equal(db.read.length,0);
  assert.equal(db.gemini.length,0);
  assert.equal(db.written.length,0);
});

test('dry-run é padrão; --apply explícito necessário para gastar API',async()=>{
  const a=fixture({args:['gamer-playerone']});
  await a.api.main();
  assert.equal(a.db.gemini.length,0);
  assert.equal(a.db.read.length,0);
  assert.equal(a.db.written.length,0);
  const b=fixture({args:['gamer-playerone','--apply','--dry-run']});
  await b.api.main();
  assert.equal(b.db.gemini.length,0);
  assert.equal(b.db.written.length,0);
});

test('parser aceita JSON direto e entre fences, rejeita conteúdo inválido',()=>{
  const {api}=fixture();
  assert.equal(api.extrairJSON('{"css_corrigido":[]}').css_corrigido.length,0);
  assert.equal(api.extrairJSON('```json\n{"css_corrigido":["css"]}\n```').css_corrigido[0],'css');
  assert.equal(api.extrairJSON('Prefácio {"css_corrigido":["c"]} fim').css_corrigido[0],'c');
  assert.equal(api.extrairJSON('Inválido!'),null);
});

test('localiza regras CSS em objetos/arrays sem incluir strings comuns e reescreve pelo caminho',()=>{
  const {api}=fixture();
  const data={area:[{css:'.a{color:red}'},{titulo:'Não tem estilo'}],footer:{css:'.b {background:#fff}'}};
  const items=api.coletarCssStrings(data);
  assert.equal(items.length,2);
  assert.equal(items[0].caminho,'area[0].css');
  assert.equal(items[1].caminho,'footer.css');
  api.setByPath(data,items[0].caminho,'.a{color:var(--sl-primary)}');
  assert.match(data.area[0].css,/var\(--sl-primary\)/);
});

test('prompt preserva variáveis de tema e exige cardinalidade dos blocos',()=>{
  const {api}=fixture();
  const p=api.buildPrompt('gamer-playerone',[{caminho:'cabecalho',valor:'.a {color:red;}'}]);
  assert.match(p,/var\(--sl-primary\)/);
  assert.match(p,/var\(--sl-card-bg\)/);
  assert.match(p,/EXATAMENTE 1 elementos/);
  assert.match(p,/NÃO substitua cores que são específicas/);
});

test('aplica CSS validado apenas no JSON simulado do nicho, sem remover outros campos',async()=>{
  const doc={id:'preserve',css_componentes:{cabecalho:'.header { color: #112233; }',blocos:[{css:'.card { background: #fff; }'}]}};
  const corrections=['.header { color: var(--sl-primary); }','.card { background: var(--sl-card-bg); }'];
  const a=fixture({args:['gamer-playerone','--apply'],document:doc,responses:[JSON.stringify({nicho:'gamer-playerone',css_corrigido:corrections,substituicoes:[]})]});
  assert.equal(await a.api.processarNicho('gamer-playerone'),true);
  assert.equal(a.db.gemini.length,1);
  assert.equal(a.db.written.length,1);
  const saved=JSON.parse(a.db.written[0].data);
  assert.equal(saved.id,'preserve');
  assert.equal(saved.css_componentes.cabecalho,corrections[0]);
  assert.equal(saved.css_componentes.blocos[0].css,corrections[1]);
  assert.equal(a.db.written[0].encoding,'utf-8');
  assert.match(a.db.written[0].file,/tema-gamer-playerone-impl\.json$/);
});

test('recusa respostas sem css_corrigido ou cardinalidade divergente, sem escrita',async()=>{
  for(const payload of ['sem json','{"nicho":"gamer-playerone"}','{"css_corrigido":[".a{color:#fff}"]}']) {
    const a=fixture({responses:[payload]});
    assert.equal(await a.api.processarNicho('gamer-playerone'),false);
    assert.equal(a.db.written.length,0);
  }
});

test('429 faz retry somente com o serviço simulado',async()=>{
  const a=fixture({responses:[new Error('429 quota'), 'texto correto']});
  assert.equal(await a.api.gerarTextoComRetry('qualquer prompt'), 'texto correto');
  assert.equal(a.db.gemini.length,2);
});
