#!/usr/bin/env node
'use strict';
// A lista da dívida fica fixa no JSON até virar TS ou ser eliminada.
// Arquivos JS gerados a partir de TS não são dívida. Testes continuam JS.
const { execFileSync }=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');

function inventariar(tracked,lista) {
  const entries=new Set(tracked),comFonte=x=>entries.has(x.replace(/\.jsx?$/, m=>m==='.jsx'?'.tsx':'.ts').replace(/\.(?:cjs|mjs)$/,'.ts'));
  const excluir=x=>/(?:\.test\.|\.spec\.|__testUtils__|__tests__|\/test\/|\.e2e\.)/.test(x)
    ||x.startsWith('public/dist/')||x.startsWith('examples/')||x.startsWith('src/solaris/code-examples/')
    ||x==='scripts/check-typescript-remaining.cjs';
  const candidatos=[...entries].filter(x=>/\.(?:js|jsx|cjs|mjs)$/.test(x)&&!excluir(x)&&!comFonte(x)).sort();
  const previstos=new Set([...lista.runtime,...lista.tooling]);
  const inesperados=candidatos.filter(x=>!previstos.has(x));
  const runtime=candidatos.filter(x=>lista.runtime.includes(x));
  const tooling=candidatos.filter(x=>lista.tooling.includes(x));
  const frontendTs=[...entries].filter(x=>x.startsWith('frontend/')&&/\.tsx?$/.test(x));
  return {runtime,tooling,inesperados,frontendTs};
}
function auditar({root=path.resolve(__dirname,'..'),tracked=null,lista=null,tsconfig=null}={}) {
  const files=tracked||execFileSync('git',['ls-files','-z'],{cwd:root,encoding:'utf8'}).split('\0').filter(Boolean);
  const baseline=lista||JSON.parse(fs.readFileSync(path.join(root,'scripts/typescript-remaining.json'),'utf8'));
  // Frontend React aposentado: fixtures podem fornecer tsconfig, mas produção não o exige.
  const config=tsconfig||{include:[]};
  const result=inventariar(files,baseline);
  const ausentes=result.frontendTs.filter(x=>!config.include.includes(x));
  return {...result,frontendForaTypecheck:ausentes,ok:result.inesperados.length===0&&ausentes.length===0};
}
// Browsers carregam scripts clássicos, não módulos CommonJS.
function verificarEspelhosWorkers(root=path.resolve(__dirname,'..')) {
  const ts=require('@typescript/typescript6');
  const arquivos=['w-utils','w-init','w-log-init','w-errorlog','w-sentinel'];
  const divergentes=[];
  for(const nome of arquivos) {
    const base=path.join(root,'public/js/workers',nome);
    const fonte=fs.readFileSync(base+'.ts','utf8');
    const emitido=ts.transpileModule(fonte,{compilerOptions:{
      target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,removeComments:false,newLine:ts.NewLineKind.LineFeed
    }}).outputText;
    const atual=fs.readFileSync(base+'.js','utf8');
    if(emitido!==atual){divergentes.push(nome);if(process.env.TS_MIRROR_DIAGNOSTICS==='1')console.error('TS_EMITTED_WORKER='+JSON.stringify({nome,content:emitido}));}
  }
  // Script EJS do painel admin: transpilar TypeScript e comparar AST canônica
  // com o JavaScript servido ao navegador, ignorando apenas formatação/comentários.
  const adminBase=path.join(root,'public/js/admin-simples');
  const adminTs=fs.readFileSync(adminBase+'.ts','utf8');
  const adminJs=fs.readFileSync(adminBase+'.js','utf8');
  const adminGenerated=ts.transpileModule(adminTs,{compilerOptions:{
    target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,removeComments:false,newLine:ts.NewLineKind.LineFeed
  }}).outputText;
  const printer=ts.createPrinter({removeComments:true});
  const canonical=(code)=>printer.printFile(ts.createSourceFile('admin-simples.js',code,ts.ScriptTarget.ES2022,true,ts.ScriptKind.JS));
  if(canonical(adminGenerated)!==canonical(adminJs)){divergentes.push('admin-simples');if(process.env.TS_MIRROR_DIAGNOSTICS==='1')console.error('TS_EMITTED_ADMIN='+JSON.stringify({content:adminGenerated}));}
  return divergentes;
}
if(require.main===module){
  const r=auditar();
  console.log('[TS-MIGRACAO] Fontes JS de runtime ainda sem TS:',r.runtime.length);
  console.log('[TS-MIGRACAO] Ferramentas auxiliares mantidas em JS:',r.tooling.length);
  if(process.argv.includes('--json'))console.log(JSON.stringify(r,null,2));
  for(const x of r.inesperados)console.error('JS novo sem fonte TypeScript no inventário:',x);
  for(const x of r.frontendForaTypecheck)console.error('TypeScript ignorado pelo typecheck frontend:',x);
  const browsers=verificarEspelhosWorkers();
  for(const nome of browsers)console.error('Espelho browser JS não sincronizado com TypeScript:',nome);
  if(!r.ok||browsers.length)process.exitCode=1;
}
module.exports={inventariar,auditar,verificarEspelhosWorkers};
