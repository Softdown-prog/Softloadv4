'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('painel administrativo pagina usuários e permite voltar sem interpretar HTML', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../../public/js/admin-simples.js'), 'utf8');
  function node() {
    return {
      children: [], disabled: false, textContent: '', colSpan: 0,
      handlers: {},
      addEventListener(name, fn) { this.handlers[name] = fn; },
      click() { this.handlers.click?.(); },
      replaceChildren() { this.children = []; },
      appendChild(child) { this.children.push(child); }
    };
  }
  const elements = new Map();
  for (const id of ['admin-status', 'admin-usuarios', 'admin-usuarios-prev',
    'admin-usuarios-next', 'admin-usuarios-page']) elements.set(id, node());
  const root = { getAttribute: () => 'usuarios' };
  const document = {
    querySelector: () => root,
    getElementById: id => elements.get(id) || null,
    createElement: () => node()
  };
  const urls = [];
  const first = { usuarios: [
    {email: '<script>alert(1)</script>', nome: 'Primeira', plano: 'free', is_active: false, tentativas_compilacao: 1, storage_usado_mb: '0.00'},
    {email: 'user2@example.test', nome: 'Segunda', plano: 'essencial', is_active: true, tentativas_compilacao: 2, storage_usado_mb: '0.20'}
  ], nextCursor: 'user2@example.test' };
  const second = { usuarios: [
    {email: 'user3@example.test', nome: 'Terceira', plano: 'free', is_active: false, tentativas_compilacao: 0, storage_usado_mb: '0.00'}
  ], nextCursor: null };
  async function fetch(url) {
    urls.push(url);
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => url.includes('cursor=') ? second : first };
  }
  vm.runInNewContext(source, { document, fetch, Intl }, { filename: 'admin-simples.js', timeout: 1000 });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  await settle();
  const previous = elements.get('admin-usuarios-prev');
  const next = elements.get('admin-usuarios-next');
  const label = elements.get('admin-usuarios-page');
  const table = elements.get('admin-usuarios');
  assert.equal(urls[0], '/eu/api/usuarios?limit=50');
  assert.equal(table.children.length, 2);
  assert.equal(table.children[0].children[0].textContent, '<script>alert(1)</script>');
  assert.equal(previous.disabled, true);
  assert.equal(next.disabled, false);
  next.click();
  await settle();
  assert.equal(urls[1], '/eu/api/usuarios?limit=50&cursor=user2%40example.test');
  assert.equal(table.children.length, 1);
  assert.equal(label.textContent, 'Página 2');
  assert.equal(previous.disabled, false);
  assert.equal(next.disabled, true);
  previous.click();
  await settle();
  assert.equal(urls[2], '/eu/api/usuarios?limit=50');
  assert.equal(table.children.length, 2);
  assert.equal(label.textContent, 'Página 1');
});

test('cursor do Firestore usa DocumentSnapshot e consulta um item extra', () => {
  for (const extension of ['ts', 'js']) {
    const source = fs.readFileSync(path.join(__dirname, 'adminRoutes.' + extension), 'utf8');
    assert.match(source, /query\.startAfter\(cursorDoc\)/);
    assert.match(source, /\.limit\(limit \+ 1\)/);
    assert.match(source, /pageDocs\[pageDocs\.length - 1\]\.id/);
    assert.doesNotMatch(source, /query\.startAfter\(cursor\)/);
  }
});
