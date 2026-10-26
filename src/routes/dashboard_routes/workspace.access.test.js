'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const workspace=fs.readFileSync(path.join(__dirname,'workspace.js'),'utf8');
const chat=fs.readFileSync(path.join(__dirname,'workspaceChat.js'),'utf8');
test('Workspace e chat não dependem de Studio',()=>{
 assert.doesNotMatch(workspace,/exigirPlanoStudio/);
 assert.doesNotMatch(chat,/exigirPlanoStudio/);
 assert.match(workspace,/router\.get\('\/dashboard\/workspace', exigirLogin/);
 assert.match(chat,/router\.get\('\/dashboard\/workspace\/chat', exigirLogin/);
});
test('chat Workspace mantém idempotência e gate de créditos Gemini',()=>{
 assert.match(chat,/router\.post\('\/dashboard\/workspace\/chat\/stream', exigirLogin, verificarCreditosWorkspace/);
 assert.match(chat,/await debitarCreditos\(email, inputToks, outputToks, billingOperationId\)/);
});
