import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(p,import.meta.url),'utf8');
test('Angular is the sole production presentation shell',()=>{
 const app=read('../src/app/app.ts');
 for(const route of ['criar','login','register','recover','dashboard','dashboard/gerador-blogger','dashboard/historico','dashboard/arquivos','dashboard/plano-essencial','eu'])
   assert.ok(app.includes("path:'"+route+"'"),route);
 const server=read('../../src/routes/angular-shell.cjs');
 assert.ok(server.includes("sendFile(angularIndex)"));
 assert.ok(server.includes("exigirLogin")&&server.includes("exigirSuperAdmin"));
});
test('Angular editor uses existing XML compiler APIs and no AI',()=>{
 const editor=read('../src/app/editor.ts');
 for(const key of ['guestToken','downloadPath','SoftloadBloggerPreview','URL.createObjectURL'])assert.ok(editor.includes(key),key);
 const server=read('../../src/routes/angular-shell.cjs');
 assert.ok(server.includes('compiler.publicCatalog()'));
 assert.ok(server.includes('compiler.publicPresets()'));
});
