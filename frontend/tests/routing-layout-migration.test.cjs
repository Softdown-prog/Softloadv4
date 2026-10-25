'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const source = relative => fs.readFileSync(path.join(root, relative), 'utf8');

test('entrypoint React preserva a inicialização de acessibilidade antes do primeiro render', () => {
  const entry = source('frontend/main.tsx');
  assert.ok(entry.includes("applyAccessibilityPrefs();"));
  assert.ok(entry.indexOf('applyAccessibilityPrefs();') < entry.indexOf('createRoot(container)'));
  assert.match(entry, /document\.getElementById\('react-root'\)/);
  assert.match(entry, /<React\.StrictMode>/);
});

test('todas as rotas públicas, administrativas e de dashboard permanecem declaradas', () => {
  const app = source('frontend/App.tsx');
  const declaredPaths = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map(match => match[1]);
  const expectedPaths = [
    '/', '/login', '/register', '/recover',
    '/eu', 'usuarios', 'sol', 'analytics',
    '/dashboard', 'workspace', 'workspace/chat', 'solaris', 'configuracoes',
    'chat', 'historico', 'upgrade', 'preview/session', 'preview/:id',
  ];
  assert.deepEqual(declaredPaths.slice().sort(), expectedPaths.sort());
  assert.equal((app.match(/<Route\s+index\b/g) || []).length, 2);
  assert.match(app, /<Route element={<PublicLayout/);
  assert.match(app, /<Route path="\/eu" element={<AdminLayout/);
  assert.match(app, /<Route path="\/dashboard" element={<DashboardLayout/);
});

test('layouts mantêm contexto de usuário, logout e menu com acessibilidade', () => {
  const dashboard = source('frontend/layouts/DashboardLayout.tsx');
  const admin = source('frontend/layouts/AdminLayout.tsx');
  const publicLayout = source('frontend/layouts/PublicLayout.tsx');
  assert.match(dashboard, /useFocusTrap\(drawerRef, drawerOpen, fecharDrawer\)/);
  assert.match(dashboard, /aria-modal="true"/);
  assert.match(dashboard, /<Outlet context={{ user }}/);
  assert.match(dashboard, /href="\/logout"/);
  assert.match(admin, /<Outlet context={{ user }}/);
  assert.match(admin, /href="\/logout"/);
  assert.match(publicLayout, /<CookieConsent/);
});

test('Vite aponta para main.tsx e fontes TSX passam pelo parser TypeScript', () => {
  const vite = source('vite.config.js');
  assert.match(vite, /frontend\/main\.tsx/);
  for (const relative of [
    'frontend/main.tsx', 'frontend/App.tsx',
    'frontend/layouts/PublicLayout.tsx',
    'frontend/layouts/AdminLayout.tsx',
    'frontend/layouts/DashboardLayout.tsx',
    'frontend/components/Pill.tsx',
  ]) {
    const file = path.join(root, relative);
    const ast = ts.createSourceFile(file, source(relative), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0, relative);
    assert.equal(fs.existsSync(file.replace(/\.tsx$/, '.jsx')), false, relative);
  }
});
