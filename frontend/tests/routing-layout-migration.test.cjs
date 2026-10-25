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
    'frontend/components/PublicFooter.tsx',
    'frontend/components/PublicNavbar.tsx',
    'frontend/components/CookieConsent.tsx',
    'frontend/components/landing/CapabilityChecklist.tsx',
    'frontend/components/admin/DonutChart.tsx',
    'frontend/components/settings/AcessibilidadeTab.tsx',
    'frontend/components/CodeBlock.tsx',
    'frontend/components/MermaidBlock.tsx',
    'frontend/components/MarkdownRenderer.tsx',
    'frontend/components/landing/TerminalDemo.tsx',
    'frontend/pages/auth/Login.tsx',
    'frontend/pages/auth/Register.tsx',
    'frontend/pages/auth/Recover.tsx',
  ]) {
    const file = path.join(root, relative);
    const ast = ts.createSourceFile(file, source(relative), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
    assert.equal(ast.parseDiagnostics.length, 0, relative);
    assert.equal(fs.existsSync(file.replace(/\.tsx$/, '.jsx')), false, relative);
  }
});

test('Navbar, consentimento e lista de capacidades mantêm contratos públicos', () => {
  const navbar = source('frontend/components/PublicNavbar.tsx');
  const consent = source('frontend/components/CookieConsent.tsx');
  const list = source('frontend/components/landing/CapabilityChecklist.tsx');
  assert.match(navbar, /fetchAppConfig\(\)/);
  assert.match(navbar, /config\.user \?\? null/);
  assert.match(navbar, /aria-expanded={mobileOpen}/);
  assert.match(navbar, /href="\/logout"/);
  assert.match(consent, /softload_cookie_consent/);
  assert.match(consent, /365 \* 24 \* 60 \* 60 \* 1000/);
  assert.match(consent, /localStorage\.setItem/);
  assert.match(list, /IntersectionObserver/);
  assert.match(list, /CAPACIDADES\.map/);
});

test('componentes TypeScript do painel e chat preservam integrações', () => {
  const donut = source('frontend/components/admin/DonutChart.tsx');
  const accessibility = source('frontend/components/settings/AcessibilidadeTab.tsx');
  const code = source('frontend/components/CodeBlock.tsx');
  const mermaid = source('frontend/components/MermaidBlock.tsx');
  assert.match(donut, /import\('chart\.js\/auto'\)/);
  assert.match(donut, /chartRef\.current\.destroy\(\)/);
  assert.match(accessibility, /setFontScale\(value\)/);
  assert.match(accessibility, /setFontFamily\(value\)/);
  assert.match(accessibility, /aria-checked={ativo}/);
  assert.match(code, /registerLanguage\('xml', xml\)/);
  assert.match(code, /navigator\.clipboard\.writeText\(code\)/);
  assert.match(mermaid, /securityLevel: 'strict'/);
  assert.match(mermaid, /containerRef\.current\.innerHTML = svg/);
  assert.match(mermaid, /if \(!cancelado\) setErro\(/);
});

test('renderizador Markdown preserva blocos de codigo e diagramas Mermaid', () => {
  const markdown = source('frontend/components/MarkdownRenderer.tsx');
  assert.match(markdown, /React\.Children\.only\(children\)/);
  assert.match(markdown, /language-\(\\w\+\)/);
  assert.match(markdown, /match\[1\] === 'mermaid'/);
  assert.match(markdown, /<MermaidBlock code={code} \/>/);
  assert.match(markdown, /<CodeBlock code={code} language={match\?\.\[1\]} \/>/);
});

test('terminal animado preserva acessibilidade, temporizadores e cancelamento', () => {
  const demo = source('frontend/components/landing/TerminalDemo.tsx');
  assert.match(demo, /const DEMOS: readonly DemoConversation\[\]/);
  assert.match(demo, /clearAll\(\)/);
  assert.match(demo, /cancelado = true/);
  assert.match(demo, /if \(!chatArea \|\| !inputEl \|\| !indicators\) return;/);
  assert.match(demo, /addEventListener\('keydown'/);
  assert.match(demo, /e\.key === 'Enter' \|\| e\.key === ' '/);
  assert.match(demo, /role', 'button'/);
  assert.match(demo, /startDemo\(\(idx \+ 1\) % DEMOS\.length\)/);
});

test('formulários de autenticação preservam POST nativo e campos esperados pelo backend', () => {
  const login = source('frontend/pages/auth/Login.tsx');
  const register = source('frontend/pages/auth/Register.tsx');
  const recover = source('frontend/pages/auth/Recover.tsx');
  assert.match(login, /<form action="\/login" method="POST">/);
  assert.match(login, /name="email" id="email"/);
  assert.match(login, /name="password" id="password"/);
  assert.match(login, /autoComplete="current-password"/);
  assert.match(login, /searchParams\.get\('erro'\)/);
  assert.match(login, /searchParams\.get\('sucesso'\)/);
  assert.match(register, /<form action="\/register" method="POST">/);
  assert.match(register, /name="name" id="name"/);
  assert.match(register, /name="email" id="email"/);
  assert.match(register, /name="password" id="password"/);
  assert.ok(register.includes('required minLength={8}'));
  assert.match(register, /password\.length >= 8 && password === confirm/);
  assert.match(register, /disabled={!valido}/);
  assert.match(register, /<input type="password" id="confirm"/);
  assert.doesNotMatch(register, /name="confirm"/);
  assert.match(recover, /<form action="\/recover" method="POST">/);
  assert.match(recover, /id="recover-email" type="email" name="email"/);
  assert.match(recover, /searchParams\.get\('sucesso'\)/);
  assert.match(recover, /searchParams\.get\('erro'\)/);
});

test('componentes TSX de autenticação expõem retorno React tipado', () => {
  for (const name of ['Login', 'Register', 'Recover']) {
    const src = source(`frontend/pages/auth/${name}.tsx`);
    assert.match(src, new RegExp(`export default function ${name}\\(\\): React\\.JSX\\.Element`));
  }
});
