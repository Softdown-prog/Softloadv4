'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {inventariar,auditar}=require('./check-typescript-remaining.cjs');
const conf={runtime:['src/a.js'],tooling:['scripts/helper.cjs']};
const front={include:['frontend/main.tsx']};
test('espelhos e testes não geram falsas pendências',()=>{
 const src=['src/a.js','src/b.ts','src/b.js','src/x.test.js','scripts/helper.cjs',
 'public/dist/assets/main.js','src/solaris/code-examples/js/demo.js','frontend/main.tsx'];
 const r=auditar({tracked:src,lista:conf,tsconfig:front});
 assert.deepEqual(r.runtime,['src/a.js']);assert.deepEqual(r.tooling,['scripts/helper.cjs']);
 assert.equal(r.inesperados.length,0);assert.equal(r.ok,true);
});
test('novo JS sem TS interrompe o CI; TS frontend fora do typecheck também',()=>{
 const src=['src/a.js','src/novo.js','frontend/main.tsx','frontend/components/novo.tsx'];
 const r=auditar({tracked:src,lista:conf,tsconfig:front});
 assert.deepEqual(r.inesperados,['src/novo.js']);
 assert.deepEqual(r.frontendForaTypecheck,['frontend/components/novo.tsx']);
 assert.equal(r.ok,false);
});
test('migrar um JS para TS reduz a dívida sem editar inventário histórico',()=>{
 const src=['src/a.js','src/a.ts','scripts/helper.cjs','frontend/main.tsx'];
 const r=inventariar(src,conf);
 assert.deepEqual(r.runtime,[]);assert.deepEqual(r.tooling,['scripts/helper.cjs']);
});
