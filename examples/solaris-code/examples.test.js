'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadTS(rel) {
  const filename = path.resolve(__dirname, rel);
  const source = fs.readFileSync(filename, 'utf8');
  const result = ts.transpileModule(source, {
    fileName: filename,
    reportDiagnostics: true,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  });
  assert.equal((result.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error).length, 0);
  const m = new Module(filename, module);
  m.filename = filename;
  m.paths = Module._nodeModulePaths(path.dirname(filename));
  m._compile(result.outputText, filename);
  return m.exports;
}

test('TypeScript Result separa dados válidos, formato inválido e JSON malformado', () => {
  const { parseJsonAs } = loadTS('typescript/resultado-tipado.ts');
  const hasName = x => x !== null && typeof x === 'object' && typeof x.name === 'string';
  assert.deepEqual(parseJsonAs('{"name":"Ana"}', hasName), { ok: true, value: { name: 'Ana' } });
  assert.deepEqual(parseJsonAs('{"name":1}', hasName), { ok: false, error: 'Formato inesperado' });
  assert.deepEqual(parseJsonAs('{invalido}', hasName), { ok: false, error: 'JSON inválido' });
  assert.deepEqual(parseJsonAs('null', hasName), { ok: false, error: 'Formato inesperado' });
});

test('reducer TypeScript ignora respostas antigas e impede sobrescrever resultado novo', () => {
  const { requestReducer } = loadTS('typescript/reducer-assincrono.ts');
  let state = { status: 'idle', requestId: 0 };
  state = requestReducer(state, { type: 'start', requestId: 1 });
  state = requestReducer(state, { type: 'start', requestId: 2 });
  assert.deepEqual(requestReducer(state, { type: 'resolve', requestId: 1, data: 'velho' }), state);
  state = requestReducer(state, { type: 'resolve', requestId: 2, data: 'novo' });
  assert.equal(state.data, 'novo');
  assert.deepEqual(requestReducer(state, { type: 'reject', requestId: 2, message: 'falhou' }), state);
  assert.deepEqual(requestReducer(state, { type: 'reset' }), { status: 'idle', requestId: 0 });
});

test('configuração TS rejeita porta inválida, modo desconhecido e aplica defaults', () => {
  const { readServerConfig } = loadTS('typescript/config-servidor.ts');
  assert.deepEqual(readServerConfig({}), { port: 3000, mode: 'development', trustProxy: false });
  assert.deepEqual(readServerConfig({ PORT: '8080', NODE_ENV: 'production', TRUST_PROXY: 'true' }),
    { port: 8080, mode: 'production', trustProxy: true });
  for (const raw of ['0', '65536', '12abc', '1.5', '-5', ' 80 ']) {
    assert.throws(() => readServerConfig({ PORT: raw }), /PORT/);
  }
  assert.throws(() => readServerConfig({ NODE_ENV: 'staging' }), /NODE_ENV/);
  assert.throws(() => readServerConfig({ TRUST_PROXY: 'yes' }), /TRUST_PROXY/);
});

test('React filtra nomes com acentos e escapa dados do usuário em HTML', () => {
  const { CatalogList } = loadTS('react/catalogo-filtrado.tsx');
  const items = [
    { id: '1', name: 'Café', description: '<script>alert("x")</script>' },
    { id: '2', name: 'Computador', description: 'PC moderno' },
  ];
  const found = renderToStaticMarkup(React.createElement(CatalogList, { items, query: 'CAFE' }));
  assert.match(found, /Café/);
  assert.match(found, /&lt;script&gt;/);
  assert.doesNotMatch(found, /<script>/);
  assert.doesNotMatch(found, /Computador/);
  const empty = renderToStaticMarkup(React.createElement(CatalogList, { items, query: 'não existe' }));
  assert.match(empty, /Nenhum item encontrado/);
});

test('React apresenta loading, erro e sucesso com atributos acessíveis', () => {
  const { RemoteStatus } = loadTS('react/status-requisicao.tsx');
  const common = { renderData: x => React.createElement('strong', null, x), onRetry: () => {} };
  const loading = renderToStaticMarkup(React.createElement(RemoteStatus, { ...common, state: { status: 'loading' } }));
  assert.match(loading, /aria-live="polite"/);
  const error = renderToStaticMarkup(React.createElement(RemoteStatus, {
    ...common, state: { status: 'error', message: 'Falha' },
  }));
  assert.match(error, /role="alert"/);
  assert.match(error, /Tentar novamente/);
  const success = renderToStaticMarkup(React.createElement(RemoteStatus, {
    ...common, state: { status: 'success', data: 'Carregado' },
  }));
  assert.match(success, /Carregado/);
});

test('Express health diferencia liveness e readiness sem vazar erros', async () => {
  const express = require('express');
  const { healthRouter } = require('./node/rota-saude');
  const app = express();
  app.use(healthRouter({ ready: async () => { throw new Error('senha interna'); } }));
  const server = app.listen(0, '127.0.0.1');
  try {
    await new Promise((resolve, reject) => {
      if (server.listening) return resolve();
      server.once('listening', resolve);
      server.once('error', reject);
    });
    const address = server.address();
    const base = 'http://127.0.0.1:' + address.port;
    const live = await fetch(base + '/health/live');
    assert.equal(live.status, 200);
    assert.equal(live.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await live.json(), { status: 'alive' });
    const ready = await fetch(base + '/health/ready');
    assert.equal(ready.status, 503);
    const content = await ready.text();
    assert.doesNotMatch(content, /senha interna/);
    assert.match(content, /unavailable/);
  } finally {
    await new Promise((resolve, reject) => server.close(e => e ? reject(e) : resolve()));
  }
});

test('Node fetch combina timeout, sucesso e AbortSignal externo', async () => {
  const { fetchWithTimeout } = require('./node/fetch-com-timeout');
  const reply = await fetchWithTimeout('https://example.test', {
    timeoutMs: 100,
    fetchImpl: async (_url, { signal }) => {
      assert.equal(signal.aborted, false);
      return { status: 202 };
    },
  });
  assert.equal(reply.status, 202);
  const pending = (_url, { signal }) => new Promise((_resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  });
  await assert.rejects(fetchWithTimeout('https://example.test', { timeoutMs: 10, fetchImpl: pending }), /HTTP timeout/);
  const controller = new AbortController();
  controller.abort(new Error('cancelado'));
  await assert.rejects(fetchWithTimeout('https://example.test', {
    timeoutMs: 100, fetchImpl: pending, signal: controller.signal,
  }), /cancelado/);
  await assert.rejects(fetchWithTimeout('x', { timeoutMs: 0, fetchImpl: pending }), /timeoutMs/);
});
