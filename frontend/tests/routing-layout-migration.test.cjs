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
    'frontend/components/admin/BillingRecoveryPanel.tsx',
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
    'frontend/pages/Workspace.tsx',
    'frontend/pages/Solaris.tsx',
    'frontend/pages/WorkspaceChat.tsx',
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
  assert.match(navbar, /navbar-expand-md/);
  assert.match(navbar, /href: '\/#solucoes'/);
  assert.match(navbar, /onClick=\{\(\) => setMobileOpen\(false\)\}/);
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
  assert.ok(landing.includes('id="solucoes"'));
  assert.ok(landing.includes('Solaris Code'));
  assert.ok(landing.includes('id="demo-solaris"'));
  assert.ok(landing.includes('preload="none"'));
  assert.ok(landing.includes('controls'));
  assert.ok(landing.includes('poster="/media/solaris-code-demo.png"'));
  assert.ok(landing.includes('src="/media/solaris-code-demo.mp4"'));
  assert.ok(landing.includes('resposta simulada'));
  assert.ok(source('frontend/components/PublicNavbar.tsx').includes("href: '/#demo-solaris'"));
  const publisher = source('.github/workflows/publish-solaris-demo.yml');
  assert.ok(publisher.includes('12686667041') || publisher.includes('40396522894'));
  assert.ok(publisher.includes('sha256sum -c'));
  const publicLanding = source('views/pages/react-landing.ejs');
  const publicAuth = source('views/pages/react-public.ejs');
  assert.match(publicLanding, /Softload V4/);
  assert.match(publicLanding, /rel="canonical"/);
  assert.match(publicLanding, /property="og:description"/);
  assert.match(publicAuth, /noindex, follow/);
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
  assert.ok(src.includes('<BillingRecoveryPanel />'));
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
  assert.ok(chat.includes('parseSseJsonFrame<ChatStreamEvent>(frame)'));
  assert.ok(chat.includes("event.type === 'code_patch'"));
  assert.ok(chat.includes('pendingPatchRef.current = event'));
  assert.ok(chat.includes('useRef<AbortController | null>(null)'));
  assert.ok(chat.includes('abortControllerRef.current.abort()'));
  assert.ok(chat.includes('useFocusTrap(drawerRef, drawerOpen, fecharDrawer)'));
  assert.ok(chat.includes('handleSend(null, s)'));
});

test('workspace TSX mantém projetos, sessões, versões e reversão sem apagar histórico', () => {
  const ws = source('frontend/pages/Workspace.tsx');
  assert.ok(ws.includes("fetch('/api/workspace/projetos')"));
  assert.ok(ws.includes("method: 'DELETE'"));
  assert.ok(ws.includes('body: JSON.stringify({ compilacaoId })'));
  assert.ok(ws.includes('useState<WorkspaceProject[]>([])'));
  assert.ok(ws.includes('useState<WorkspaceHistory | null>(null)'));
  assert.ok(ws.includes('setSelectedProjeto(prev =>'));
  assert.ok(ws.includes('useOutletContext<{ user: AppUser }>()'));
  assert.ok(ws.includes('sessaoHistorico?.versoes.map'));
  assert.ok(ws.includes('/dashboard/workspace/chat'));
});

test('Solaris TSX preserva importação ZIP, créditos, streaming e downloads', () => {
  const code = source('frontend/pages/Solaris.tsx');
  assert.ok(code.includes("fetch('/dashboard/solaris/upload'"));
  assert.ok(code.includes("formData.append('arquivo', file)"));
  assert.ok(code.includes("fetch('/dashboard/solaris/chat/stream'"));
  assert.ok(code.includes('response.body?.getReader()'));
  assert.ok(code.includes('parseSseJsonFrame<ChatStreamEvent>(frame)'));
  assert.ok(code.includes('const assistantMsg: ChatMessage'));
  assert.ok(code.includes('m.zip.base64'));
  assert.ok(code.includes('abortControllerRef.current.abort()'));
});

test('WorkspaceChat TSX mantém sessão, preview e refresh sem sobrescrever mensagens', () => {
  const code = source('frontend/pages/WorkspaceChat.tsx');
  assert.ok(code.includes("fetch('/api/workspace/chat/info')"));
  assert.ok(code.includes("fetch('/dashboard/workspace/chat/stream'"));
  assert.ok(code.includes("fetch('/api/workspace/set-preview'"));
  assert.ok(code.includes("window.open('/dashboard/preview/session', '_blank')"));
  assert.ok(code.includes('parseSseJsonFrame<ChatStreamEvent>(frame)'));
  assert.ok(code.includes('const assistantMsg: ChatMessage'));
  assert.ok(code.includes('pendingPatchRef.current = event'));
  assert.ok(code.includes('atualizarCreditosSnapshot()'));
  assert.ok(code.includes('abortControllerRef.current.abort()'));
});

test('SSE compartilhado reconhece LF, CRLF, fragmentação, heartbeat e dados multilinha', () => {
  const vm = require('node:vm');
  const compiled = ts.transpileModule(source('frontend/utils/sseFrames.ts'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  vm.runInNewContext(compiled, { exports: mod.exports, module: mod });
  const { drainSseFrames, parseSseJsonFrame } = mod.exports;

  const prefix = ': ping\r\ndata: {"type":"status","label":"pronto"}\r';
  const first = drainSseFrames(prefix);
  assert.equal(first.frames.length, 0);
  assert.equal(first.remainder, prefix);

  const second = drainSseFrames(first.remainder + '\n\r\n'
      + 'data: {"type":"chunk",\ndata: "text":"olá"}\n\n'
      + 'data: {"type":"done"}\n');
  assert.equal(second.frames.length, 2);
  assert.equal(second.remainder, 'data: {"type":"done"}\n');
  assert.equal(parseSseJsonFrame(second.frames[0]).label, 'pronto');
  assert.equal(parseSseJsonFrame(second.frames[1]).text, 'olá');
  const final = drainSseFrames(second.remainder + '\n');
  assert.equal(parseSseJsonFrame(final.frames[0]).type, 'done');
  assert.equal(parseSseJsonFrame(': heartbeat\nretry: 5000'), null);
  assert.equal(parseSseJsonFrame('data: [DONE]'), null);
  assert.equal(parseSseJsonFrame('data: {"wrong":"shape"}'), null);
});

test('os tres chats deixam o cancelamento terminar antes de habilitar novo envio', () => {
  for (const path of [
    'frontend/pages/Chat.tsx',
    'frontend/pages/Solaris.tsx',
    'frontend/pages/WorkspaceChat.tsx',
  ]) {
    const code = source(path);
    assert.ok(code.includes('drainSseFrames(buffer)'), path);
    assert.ok(code.includes('parseSseJsonFrame<ChatStreamEvent>(frame)'), path);
    assert.ok(code.includes('if (controller.signal.aborted) return;'), path);
    assert.ok(code.includes('if (abortControllerRef.current === controller) abortControllerRef.current = null;'), path);
    assert.doesNotMatch(code, /abortControllerRef\.current\.abort\(\);\s*setLoading\(false\);/, path);
  }
});

test('dashboard visual: navegação com acesso inicial, rota ativa e tema responsivo',()=>{
  const layout=source('frontend/layouts/DashboardLayout.tsx');
  const home=source('frontend/pages/DashboardHome.tsx');
  const workspace=source('frontend/pages/Workspace.tsx');
  const css=source('public/css/softload.css');
  for(const required of [
    'label="Visão geral"', 'aria-current={active', "startsWith('/dashboard/workspace/')",
    'mobileSectionLabel', 'sl-dashboard-mobile-topbar','sl-dashboard-main'
  ]) assert.ok(layout.includes(required),'Navegação perdeu '+required);
  for(const required of ['sl-dashboard-page','sl-dashboard-stat','sl-dashboard-quicklink','ArrowUpRight'])
    assert.ok(home.includes(required),'Dashboard perdeu '+required);
  for(const required of ['sl-dashboard-page','sl-workspace-project-item','sl-workspace-list-header'])
    assert.ok(workspace.includes(required),'Workspace perdeu '+required);
  for(const required of ['.sl-dashboard-sidebar','.sl-dashboard-stat','.sl-dashboard-quicklink',
    '.sl-dashboard-main > .sl-conversation','[data-bs-theme="light"] .sl-dashboard-sidebar'])
    assert.ok(css.includes(required),'CSS ausente '+required);
});

test('histórico, configurações e upgrade seguem o tema unificado',()=>{
  const history=source('frontend/pages/Historico.tsx');
  const settings=source('frontend/pages/Configuracoes.tsx');
  const upgrade=source('frontend/pages/Upgrade.tsx');
  const css=source('public/css/softload.css');
  for(const markup of [history,settings,upgrade]){
    assert.ok(markup.includes('sl-dashboard-page-header'));
    assert.ok(markup.includes('sl-dashboard-page p-3 p-md-5'));
  }
  assert.ok(history.includes('sl-dashboard-empty'));
  assert.ok(history.includes('sl-dashboard-stat'));
  assert.ok(settings.includes('sl-dashboard-settings-tabs'));
  assert.ok(upgrade.includes('sl-dashboard-plan-card--featured'));
  for(const selector of ['.sl-dashboard-settings-tabs','.sl-dashboard-plan-card','.sl-dashboard-empty']){
    assert.ok(css.includes(selector),'Estilo ausente: '+selector);
  }
});

test('arquivos aprovados do vídeo Solaris são MP4 e PNG válidos e leves', () => {
  const mp4 = fs.readFileSync(path.join(root, 'public/media/solaris-code-demo.mp4'));
  const poster = fs.readFileSync(path.join(root, 'public/media/solaris-code-demo.png'));
  assert.ok(mp4.length > 100_000 && mp4.length < 5 * 1024 * 1024, 'MP4 da demonstração fora dos limites');
  assert.equal(mp4.toString('ascii', 4, 8), 'ftyp', 'Assinatura MP4 ausente');
  assert.ok(poster.length > 10_000 && poster.length < 1024 * 1024, 'Capa PNG fora dos limites');
  assert.equal(poster.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'Assinatura PNG ausente');
});

// Regressão de identidade e responsividade nas páginas EJS fora do React Router.
test('navegação EJS é responsiva e usa os mesmos links e marca da landing React', () => {
  const header=source('views/partials/header.ejs');
  const footer=source('views/partials/footer.ejs');
  const navbar=source('frontend/components/PublicNavbar.tsx');
  for(const label of ['Início','Ferramentas','Demonstração','Contato']){
    assert.ok(header.includes('>'+label+'</a>'),label);
    assert.ok(navbar.includes("label: '"+label+"'"),label);
  }
  assert.match(header,/navbar-expand-md/);
  assert.match(header,/data-bs-toggle="collapse"/);
  assert.match(header,/aria-controls="sl-nav-collapse"/);
  assert.match(header,/SOFTLOAD<span class="sl-accent"> V4<\/span>/);
  assert.match(footer,/SOFTLOAD<span class="sl-accent"> V4<\/span>/);
  assert.doesNotMatch(header+footer,/Softload Engine v3|>ENGINE<\/span>/);
});

test('contato não altera pontuação inserida e valida o limite de 100 palavras', () => {
  const contact=source('views/pages/contato.ejs');
  assert.match(contact,/Pontuação comum é aceita/);
  assert.match(contact,/mensagemInput\.addEventListener\('input', atualizarContador\)/);
  assert.doesNotMatch(contact,/mensagemInput\.value\.replace/);
  assert.match(contact,/REGEX_OK\.test\(mensagem\)/);
  assert.match(contact,/MAX_PALAVRAS\s+= 100/);
});

test('templates EJS das páginas externas compilam', () => {
  const ejs=require('ejs');
  for(const name of ['contato','privacidade','termos-de-uso','404']){
    const file=path.join(root,'views/pages',name+'.ejs');
    assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}),name);
  }
  for(const name of ['header','footer']){
    const file=path.join(root,'views/partials',name+'.ejs');
    assert.doesNotThrow(()=>ejs.compile(fs.readFileSync(file,'utf8'),{filename:file}),name);
  }
});

test('documentos legais descrevem Solaris, GitHub, conteúdo e limites reais de créditos',()=>{
  const terms=source('views/pages/termos-de-uso.ejs');
  const privacy=source('views/pages/privacidade.ejs');
  assert.match(terms,/Solaris Code/);
  assert.match(terms,/GitHub/);
  assert.match(terms,/saldo de créditos e limites de uso/);
  assert.doesNotMatch(terms,/Créditos funcionam como contadores de uso analítico/);
  for(const required of ['Conteúdo das ferramentas','Inteligência artificial e arquivos',
                         'Integração com GitHub','Google Gemini','Acesso, correção e exclusão']){
    assert.ok(privacy.includes(required),required);
  }
  assert.match(privacy,/pageCanonical: '\/privacidade'/);
});


// Testes de consistência comercial, clareza e acessibilidade das rotas públicas de autenticação.
test('login e cadastro usam linguagem da Softload V4 em vez da interface antiga de fundição', () => {
  const login = source('frontend/pages/auth/Login.tsx');
  const register = source('frontend/pages/auth/Register.tsx');
  const recover = source('frontend/pages/auth/Recover.tsx');
  for (const page of [login, register, recover]) {
    assert.doesNotMatch(page, /Fundição|Forjar Identidade|Operador|Chave de Acesso|Resgate|blindagem/);
    assert.match(page, /<form action="\/(login|register|recover)" method="POST">/);
  }
  assert.match(login, /Acesse sua conta/);
  assert.match(register, /Crie sua conta grátis/);
  assert.match(recover, /Recuperar senha/);
  assert.match(register, /Após criar sua conta, entre com seu e-mail e senha/);
  assert.match(register, />Criar conta<\/button>/);
  assert.doesNotMatch(register, /Registrar e Entrar/);
});

test('visibilidade de senha tem rótulo acessível e a recuperação não transforma e-mail em maiúsculas', () => {
  const login = source('frontend/pages/auth/Login.tsx');
  const recover = source('frontend/pages/auth/Recover.tsx');
  assert.match(login, /aria-label={showPwd \? 'Ocultar senha' : 'Mostrar senha'}/);
  assert.match(login, /aria-pressed={showPwd}/);
  assert.match(recover, /autoComplete="email"/);
  assert.doesNotMatch(recover, /className="form-control text-uppercase"/);
  assert.doesNotMatch(recover, /expira em 60 minutos/);
  assert.match(recover, /Se o endereço estiver cadastrado/);
});
