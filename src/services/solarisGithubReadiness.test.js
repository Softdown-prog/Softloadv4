'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { resolveGithubChatAccess } = require('./solarisGithubReadiness');

test('conta autorizada + repositório vinculado habilita agente no escopo certo', () => {
  assert.deepEqual(resolveGithubChatAccess(
    { connected: true, account: 'Alice', repository: 'Alice/Projeto' },
    'https://github.com/alice/projeto.git'
  ), { mode: 'agent', repository: 'Alice/Projeto' });
});
test('conta conectada sem vínculo não permite executar como agente', () => {
  assert.throws(() => resolveGithubChatAccess(
    { connected: true, account: 'alice', repository: null }, 'https://github.com/alice/projeto'
  ), /Vincular repositório/);
});
test('conta conectada não pode operar outro repositório', () => {
  assert.throws(() => resolveGithubChatAccess(
    { connected: true, repository: 'alice/um' }, 'https://github.com/alice/outro'
  ), /não está vinculado/);
});
test('token expirado nunca degrada silenciosamente para consulta pública', () => {
  assert.throws(() => resolveGithubChatAccess(
    { connected: false, account: 'alice', repository: 'alice/um' }, 'alice/um'
  ), /expirou/);
});
test('sem conta conectada mantém análise somente leitura para repositório público', () => {
  assert.deepEqual(resolveGithubChatAccess(
    { connected: false }, 'https://github.com/alice/projeto'
  ), { mode: 'public-readonly', repository: 'alice/projeto' });
});
test('URL inválida é rejeitada antes de chamar o modelo', () => {
  assert.throws(() => resolveGithubChatAccess(
    { connected: false }, 'https://attacker.example/alice/projeto'
  ), /válido/);
});
