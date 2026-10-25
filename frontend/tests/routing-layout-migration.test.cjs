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
    'frontend/pages/DashboardHome.tsx',
    'frontend/pages/Historico.tsx',
    'frontend/pages/Upgrade.tsx',
    'frontend/pages/Configuracoes.tsx',
    'frontend/pages/Landing.tsx',
    'frontend/pages/admin/Analytics.tsx',
    'frontend/pages/admin/Dashboard.tsx',
    'frontend/pages/admin/Usuarios.tsx',
    'frontend/pages/admin/Sol.tsx',
    'frontend/pages/Preview.tsx',
    'frontend/pages/Chat.tsx',
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

test('dashboard TypeScript preserva carregamento de indicadores e atalhos', () => {
  const home = source('frontend/pages/DashboardHome.tsx');
  assert.ok(home.includes("fetch('/api/dashboard/stats')"));
  assert.ok(home.includes('useState<DashboardStats | null>(null)'));
  assert.ok(home.includes('useOutletContext<{ user: DashboardUser }>()'));
  assert.ok(home.includes('/dashboard/workspace'));
  assert.ok(home.includes('/dashboard/historico'));
});

test('historico TypeScript preserva exclusao, importacao e exibicao mobile', () => {
  const history = source('frontend/pages/Historico.tsx');
  assert.ok(history.includes("fetch('/api/historico')"));
  assert.ok(history.includes("method: 'DELETE'"));
  assert.ok(history.includes("fetch('/api/workspace/importar'"));
  assert.ok(history.includes('compilacaoId: id'));
  assert.ok(history.includes('useState<Set<CompilationId>>'));
  assert.ok(history.includes('d-xl-none'));
  assert.ok(history.includes('d-none d-xl-block'));
});

test('upgrade TypeScript preserva checkout e feedback de pagamento', () => {
  const upgrade = source('frontend/pages/Upgrade.tsx');
  assert.ok(upgrade.includes("fetch('/dashboard/checkout-create'"));
  assert.ok(upgrade.includes("method: 'POST'"));
  assert.ok(upgrade.includes('body: JSON.stringify({ plano: planoId })'));
  assert.ok(upgrade.includes('window.location.href = data.checkoutUrl'));
  assert.ok(upgrade.includes('STATUS_FEEDBACK[status as PaymentStatus]'));
});

test('configurações TypeScript preservam abas, foco e exclusão nativa protegida', () => {
  const settings = source('frontend/pages/Configuracoes.tsx');
  assert.ok(settings.includes('useFocusTrap(modalRef, showExcluirModal, fecharModal)'));
  assert.ok(settings.includes("next.set('tab', value)"));
  assert.ok(settings.includes("next.delete('erro')"));
  assert.ok(settings.includes("confirmacao !== 'EXCLUIR'"));
  assert.ok(settings.includes('excluirFormRef.current?.submit()'));
  assert.ok(settings.includes('method="POST" action="/dashboard/conta/excluir"'));
  assert.ok(settings.includes('name="confirmacao"'));
  assert.ok(settings.includes('<AcessibilidadeTab />'));
});

test('landing TypeScript mantém animações, toast e início da demo', () => {
  const landing = source('frontend/pages/Landing.tsx');
  assert.ok(landing.includes("searchParams.get('conta') === 'apagada'"));
  assert.ok(landing.includes('setTimeout(() => setVisivel(false), 6000)'));
  assert.ok(landing.includes('useHeroEntrance(useCallback(() => setDemoStart(true), []))'));
  assert.ok(landing.includes('<TerminalDemo start={demoStart} />'));
  assert.ok(landing.includes('<CapabilityChecklist />'));
});

test('analytics TypeScript preserva filtro, atualização periódica e diagnóstico Firestore', () => {
  const analytics = source('frontend/pages/admin/Analytics.tsx');
  assert.ok(analytics.includes("fetch(`/eu/api/analytics/creditos?dias=${diasAtuais}`)"));
  assert.ok(analytics.includes('setInterval(() => carregar(dias), 60000)'));
  assert.ok(analytics.includes('clearInterval(interval)'));
  assert.ok(analytics.includes("searchParams.get('dias') ?? ''"));
  assert.ok(analytics.includes('setSemIndice(!!data.semIndice)'));
  assert.ok(analytics.includes('navigator.clipboard.writeText(DEPLOY_CMD)'));
});

test('dashboard admin em TSX preserva KPIs, saude e auditoria', () => {
  const src = source('frontend/pages/admin/Dashboard.tsx');
  for (const url of ['/eu/api/kpis', '/eu/api/saude', '/eu/api/logs?limit=20']) {
    assert.ok(src.includes(url));
  }
  assert.ok(src.includes('setInterval(carregarKpis, 30000)'));
  assert.ok(src.includes('setInterval(carregarSaude, 60000)'));
  assert.ok(src.includes('useState<AdminKpis | null>'));
  assert.ok(src.includes('<DonutChart data={['));
});

test('administracao de usuarios em TSX preserva paginacao, quotas e focus traps', () => {
  const src = source('frontend/pages/admin/Usuarios.tsx');
  assert.ok(src.includes('/eu/api/usuarios?limit=50'));
  assert.ok(src.includes('encodeURIComponent(nextCursor)'));
  assert.ok(src.includes('body: JSON.stringify({ ativo: true, plano })'));
  assert.ok(src.includes('body: JSON.stringify({ ativo: false })'));
  assert.ok(src.includes('body: JSON.stringify(body)'));
  assert.ok(src.includes('if (!modalAtivar) return;'));
  assert.ok(src.includes('if (!modalCreditos) return;'));
  assert.ok(src.includes('useFocusTrap(modalAtivarRef, !!modalAtivar, fecharModalAtivar)'));
});

test('chat Sol administrativo em TSX preserva SSE e cancelamento do streaming', () => {
  const src = source('frontend/pages/admin/Sol.tsx');
  assert.ok(src.includes('/eu/api/sol/perguntar/stream'));
  assert.ok(src.includes('new AbortController()'));
  assert.ok(src.includes('const reader = response.body?.getReader()'));
  assert.ok(src.includes('JSON.parse(dLine[1]) as SolStreamEvent'));
  assert.ok(src.includes('abortControllerRef.current.abort()'));
  assert.ok(src.includes('useFocusTrap(drawerRef, drawerOpen, fecharDrawer)'));
  assert.ok(src.includes('<MarkdownRenderer>{m.content}</MarkdownRenderer>'));
});

test('preview TSX preserva carregamento, isolamento de iframe e viewports', () => {
  const preview = source('frontend/pages/Preview.tsx');
  assert.ok(preview.includes("'/api/preview/session'"));
  assert.ok(preview.includes('/api/preview/${id}?from='));
  assert.ok(preview.includes("window.addEventListener('message', onMessage)"));
  assert.ok(preview.includes('h != null && h > 200'));
  assert.ok(preview.includes('useRef<HTMLIFrameElement | null>(null)'));
  assert.ok(preview.includes('buildHeightScript()'));
  assert.ok(preview.includes('sandbox="allow-same-origin allow-scripts allow-popups allow-forms"'));
  assert.ok(preview.includes("maxWidth: VIEWPORTS[viewport].maxWidth"));
});

test('chat TSX mantém créditos, sessões, SSE e cancelamento', () => {
  const chat = source('frontend/pages/Chat.tsx');
  assert.ok(chat.includes("fetch('/api/chat/status')"));
  assert.ok(chat.includes("fetch('/api/chat/sessions?type=chat-suporte')"));
  assert.ok(chat.includes("fetch('/dashboard/chat/stream'"));
  assert.ok(chat.includes("model: 'gemini-flash'"));
  assert.ok(chat.includes('JSON.parse(dLine[1]) as ChatStreamEvent'));
  assert.ok(chat.includes("event.type === 'code_patch'"));
  assert.ok(chat.includes('pendingPatchRef.current = event'));
  assert.ok(chat.includes('useRef<AbortController | null>(null)'));
  assert.ok(chat.includes('abortControllerRef.current.abort()'));
  assert.ok(chat.includes('useFocusTrap(drawerRef, drawerOpen, fecharDrawer)'));
  assert.ok(chat.includes('handleSend(null, s)'));
});
