'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
const read = p => fs.readFileSync(path.join(root,p),'utf8');

test('todos os planos informam Workspace, mesmo com saldo de IA limitado', () => {
  const page = read('frontend/pages/Upgrade.tsx');
  const plans = ['free','starter','pro','studio'];
  for (let i=0; i<plans.length; i++) {
    const start=page.indexOf("id: '"+plans[i]+"'");
    const end=i<plans.length-1?page.indexOf("id: '"+plans[i+1]+"'",start):page.indexOf('const STATUS_FEEDBACK',start);
    assert.ok(start>=0 && end>start,'Plano não encontrado: '+plans[i]);
    const block=page.slice(start,end);
    assert.match(block,/Workspace/,'Workspace precisa aparecer no plano '+plans[i]);
    assert.doesNotMatch(block,/Workspace[^\n]*ok: false/,'Workspace não pode ser negado ao '+plans[i]);
  }
  assert.match(page,/O uso da IA depende dos créditos disponíveis/);
  const gate=read('src/middlewares/workspaceCreditGate.ts');
  assert.match(gate,/Permite Workspace em todos os planos/);
  assert.doesNotMatch(gate,/exigirPlanoStudio/);
});

test('documentos públicos não prometem Workspace exclusivo e informam os limites', () => {
  const termos=read('views/pages/termos-de-uso.ejs');
  const privacidade=read('views/pages/privacidade.ejs');
  assert.doesNotMatch(termos,/Workspace[^<\n]{0,110}exclusiv[oa] d[oa] plano Studio/i);
  assert.doesNotMatch(termos,/não inclui o Workspace|único plano com acesso ao compilador/i);
  assert.match(termos,/todos os planos/i);
  assert.match(termos,/28 de outubro de 2026/);
  assert.match(privacidade,/28 de outubro de 2026/);
  assert.match(privacidade,/transferência internacional/);
  assert.match(privacidade,/formulário de contato/);
  assert.match(privacidade,/LGPD/);
});