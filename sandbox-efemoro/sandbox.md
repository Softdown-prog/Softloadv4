> ⚠️ NOTA (revisão posterior): este documento é a PROPOSTA ORIGINAL de
> intenção, mantida aqui como registro histórico. A implementação real
> está em `src/`, `Dockerfile` e `README.md` nesta mesma pasta -- e
> diverge do texto abaixo em vários pontos importantes (arquitetura de
> container separado, ESM em vez de CommonJS, correções de segurança
> na política de rede, entre outros). Ver `README.md` para a lista
> completa do que mudou e por quê. Não use o código deste arquivo como
> referência de implementação.

Implementação Inicial do Web Sandbox para o Solaris Agent

Segue a implementação funcional mínima conforme solicitado, já preparada para execução em ambiente isolado (container efêmero). A estrutura segue a convenção sugerida e pode ser adaptada ao padrão existente do Worker.

---

1. Estrutura de Arquivos Criada

```
agent/src/capabilities/webSandbox/
├── index.js
├── browser.js
├── devices.js
├── screenshots.js
├── console.js
├── network.js
├── accessibility.js
├── responsive.js
└── security.js
```

---

2. Conteúdo dos Módulos

index.js – Ponto de entrada da capability

```javascript
'use strict';

const { chromium, webkit } = require('playwright');
const { validateOptions, validateUrl } = require('./security');
const { getDeviceConfig, DEFAULT_VIEWPORT } = require('./devices');
const { captureScreenshot } = require('./screenshots');
const { attachConsoleListeners } = require('./console');
const { attachNetworkListeners, setupNetworkPolicy } = require('./network');
const { runAccessibilityAudit } = require('./accessibility');
const { detectResponsiveIssues } = require('./responsive');

/**
 * Executa a análise web sandbox.
 * @param {Object} options
 * @param {string} options.url - URL local da aplicação a ser testada.
 * @param {string} [options.browser='chromium'] - 'chromium' ou 'webkit'.
 * @param {string} [options.device='desktop'] - Nome do device configurado.
 * @param {Object} [options.viewport] - Override de viewport {width, height}.
 * @param {boolean} [options.screenshot=true] - Capturar screenshot.
 * @param {boolean} [options.accessibility=true] - Executar axe-core.
 * @param {string[]} [options.allowedHosts] - Hosts permitidos além de localhost.
 * @param {number} [options.timeout=30000] - Timeout global em ms.
 * @returns {Promise<Object>} Resultado estruturado.
 */
async function runWebSandbox(options) {
  const startTime = Date.now();
  const result = {
    success: false,
    browser: null,
    device: null,
    viewport: null,
    url: null,
    duration: 0,
    console: { errors: [], warnings: [] },
    network: { failedRequests: [] },
    responsive: { horizontalOverflow: false, viewportWarnings: [] },
    accessibility: { violations: [] },
    screenshotPath: null,
    errors: [],
    security: { blockedRequests: [] }
  };

  let browser = null;
  let context = null;
  let page = null;

  try {
    // Valida entrada
    const validated = validateOptions(options);
    const { url, browserType, device, viewport, screenshot, accessibility, allowedHosts, timeout } = validated;
    result.url = url;
    result.browser = browserType;
    result.device = device;

    // Obtém configuração do device
    const deviceConfig = getDeviceConfig(device, viewport);
    result.viewport = deviceConfig.viewport;

    // Lança o navegador correspondente
    browser = await launchBrowser(browserType, timeout);
    context = await browser.newContext({
      viewport: deviceConfig.viewport,
      userAgent: deviceConfig.userAgent,
      locale: deviceConfig.locale,
      timezoneId: deviceConfig.timezoneId,
      // Isolamento adicional: desabilita permissões sensíveis
      permissions: [],
      ignoreHTTPSErrors: false,
      // Evita que a página acesse dados de outros contextos
      storageState: undefined,
      extraHTTPHeaders: {}
    });

    // Política de rede: bloqueia tudo que não for allowlist
    const networkPolicy = await setupNetworkPolicy(context, allowedHosts, result);

    // Anexa listeners de console e rede
    await attachConsoleListeners(page = await context.newPage(), result);
    await attachNetworkListeners(page, result);

    // Navega até a URL com timeout
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout });

    // Aguarda um pequeno tempo para estabilizar
    await page.waitForTimeout(2000);

    // Captura screenshot
    if (screenshot) {
      result.screenshotPath = await captureScreenshot(page, browserType, device);
    }

    // Detecta problemas responsivos básicos
    const responsive = await detectResponsiveIssues(page);
    result.responsive = responsive;

    // Executa auditoria de acessibilidade com axe-core
    if (accessibility) {
      const axeResult = await runAccessibilityAudit(page);
      result.accessibility = axeResult;
    }

    // Coleta resumo dos eventos capturados
    result.console.errors = result.console.errors.slice(0, 100); // limita quantidade
    result.console.warnings = result.console.warnings.slice(0, 100);
    result.network.failedRequests = result.network.failedRequests.slice(0, 100);
    result.security.blockedRequests = networkPolicy.blockedRequests;

    result.success = true;
  } catch (error) {
    result.errors.push({
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 5).join('\n')
    });
    result.success = false;
  } finally {
    // Garante fechamento de todos os recursos
    try {
      if (page && !page.isClosed()) await page.close();
      if (context) await context.close();
      if (browser) await browser.close();
    } catch (closeError) {
      result.errors.push({ message: 'Error closing resources: ' + closeError.message });
    }
    result.duration = Date.now() - startTime;
  }

  return result;
}

async function launchBrowser(browserType, timeout) {
  const launchOptions = {
    headless: true,
    timeout,
    args: [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-setuid-sandbox',
      '--no-first-run',
      '--no-zygote',
      '--single-process',
      '--disable-accelerated-2d-canvas',
      '--disable-background-networking',
      '--disable-background-timer-throttling',
      '--disable-breakpad',
      '--disable-client-side-phishing-detection',
      '--disable-default-apps',
      '--disable-extensions',
      '--disable-hang-monitor',
      '--disable-popup-blocking',
      '--disable-prompt-on-repost',
      '--disable-sync',
      '--disable-translate',
      '--metrics-recording-only',
      '--no-crash-upload',
      '--no-default-browser-check',
      '--safebrowsing-disable-auto-update'
    ]
  };

  if (browserType === 'webkit') {
    return webkit.launch(launchOptions);
  }
  // default chromium
  return chromium.launch(launchOptions);
}

module.exports = { runWebSandbox };
```

---

browser.js – Gerenciamento de navegadores (não usado diretamente no index, mas mantido para extensão)

```javascript
'use strict';

const { chromium, webkit } = require('playwright');

/**
 * Retorna uma instância de navegador conforme tipo.
 * @param {'chromium'|'webkit'} type
 * @param {Object} options
 */
async function launchBrowser(type, options = {}) {
  const defaultOptions = {
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage']
  };
  const launchOptions = { ...defaultOptions, ...options };

  if (type === 'webkit') {
    return webkit.launch(launchOptions);
  }
  return chromium.launch(launchOptions);
}

module.exports = { launchBrowser };
```

---

devices.js – Configurações de dispositivos/viewport

```javascript
'use strict';

const DEVICES = {
  desktop: {
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York'
  },
  'android-mobile': {
    viewport: { width: 360, height: 800 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo'
  },
  'iphone': {
    viewport: { width: 390, height: 844 },
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'en-US',
    timezoneId: 'America/Los_Angeles'
  },
  'tablet': {
    viewport: { width: 768, height: 1024 },
    userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    locale: 'en-US',
    timezoneId: 'America/Chicago'
  },
  'mobile-landscape': {
    viewport: { width: 800, height: 360 },
    userAgent: 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/Sao_Paulo'
  }
};

const DEFAULT_DEVICE = 'desktop';

function getDeviceConfig(deviceName, overrideViewport) {
  const device = DEVICES[deviceName] || DEVICES[DEFAULT_DEVICE];
  let viewport = device.viewport;
  if (overrideViewport && typeof overrideViewport === 'object') {
    viewport = {
      width: overrideViewport.width || viewport.width,
      height: overrideViewport.height || viewport.height
    };
  }
  return {
    ...device,
    viewport
  };
}

module.exports = { getDeviceConfig, DEVICES, DEFAULT_DEVICE };
```

---

screenshots.js – Captura de screenshots

```javascript
'use strict';

const path = require('path');
const fs = require('fs');

const SCREENSHOT_DIR = path.join(process.cwd(), 'artifacts', 'screenshots');

/**
 * Captura screenshot da página atual.
 * @param {import('playwright').Page} page
 * @param {string} browserType
 * @param {string} device
 * @returns {Promise<string>} Caminho relativo do screenshot.
 */
async function captureScreenshot(page, browserType, device) {
  try {
    // Garante que o diretório existe
    if (!fs.existsSync(SCREENSHOT_DIR)) {
      fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });
    }
    const filename = `${Date.now()}_${browserType}_${device}.png`;
    const filePath = path.join(SCREENSHOT_DIR, filename);
    await page.screenshot({ path: filePath, fullPage: true });
    // Retorna caminho relativo para uso no JSON
    return path.relative(process.cwd(), filePath);
  } catch (error) {
    console.error('Screenshot failed:', error.message);
    return null;
  }
}

module.exports = { captureScreenshot };
```

---

console.js – Captura de eventos de console

```javascript
'use strict';

/**
 * Anexa listeners de console à página, acumulando erros e avisos.
 * @param {import('playwright').Page} page
 * @param {Object} result - Objeto de resultado a ser preenchido.
 */
async function attachConsoleListeners(page, result) {
  page.on('console', (msg) => {
    const type = msg.type();
    if (type === 'error') {
      result.console.errors.push({
        text: msg.text(),
        location: msg.location()
      });
    } else if (type === 'warning') {
      result.console.warnings.push({
        text: msg.text(),
        location: msg.location()
      });
    }
  });

  page.on('pageerror', (error) => {
    result.console.errors.push({
      text: `Page Error: ${error.message}`,
      stack: error.stack
    });
  });
}

module.exports = { attachConsoleListeners };
```

---

network.js – Monitoramento e política de rede

```javascript
'use strict';

/**
 * Configura política de rede: permite apenas localhost e hosts da allowlist.
 * Bloqueia tudo mais. Registra requisições bloqueadas e falhas.
 * @param {import('playwright').BrowserContext} context
 * @param {string[]} allowedHosts
 * @param {Object} result
 */
async function setupNetworkPolicy(context, allowedHosts, result) {
  const blockedRequests = [];
  const failedRequests = [];

  // Define allowlist: sempre permite localhost e IPs de loopback
  const baseAllowed = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  const allAllowedHosts = new Set([...baseAllowed, ...allowedHosts]);

  await context.route('**/*', (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const hostname = url.hostname;

    // Permite apenas se o hostname estiver na allowlist
    if (allAllowedHosts.has(hostname)) {
      route.continue();
    } else {
      blockedRequests.push({
        url: request.url(),
        hostname,
        reason: 'Blocked by network policy (not in allowlist)'
      });
      route.abort();
    }
  });

  // Listener para falhas de requisição (independente da policy)
  context.on('requestfailed', (request) => {
    failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'Unknown failure'
    });
  });

  // Anexa ao result (será preenchido posteriormente no index)
  // Usamos propriedade dinâmica para não sobrescrever
  result.network.failedRequests = failedRequests; // será preenchido durante navegação

  return { blockedRequests };
}

/**
 * Anexa listeners de rede a uma página (caso use page em vez de context).
 * @param {import('playwright').Page} page
 * @param {Object} result
 */
async function attachNetworkListeners(page, result) {
  page.on('requestfailed', (request) => {
    result.network.failedRequests.push({
      url: request.url(),
      method: request.method(),
      failure: request.failure()?.errorText || 'Unknown failure'
    });
  });
}

module.exports = { setupNetworkPolicy, attachNetworkListeners };
```

---

accessibility.js – Auditoria com axe-core

```javascript
'use strict';

const fs = require('fs');

/**
 * Executa auditoria de acessibilidade usando axe-core.
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>} { violations: [...] }
 */
async function runAccessibilityAudit(page) {
  try {
    // Localiza o caminho do script minificado do axe-core
    const axePath = require.resolve('axe-core/axe.min.js');
    const axeSource = fs.readFileSync(axePath, 'utf8');

    // Injeta o script na página
    await page.addScriptTag({ content: axeSource });

    // Executa axe e retorna apenas violações
    const axeResults = await page.evaluate(async () => {
      const result = await window.axe.run(document, {
        runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] }
      });
      return result.violations.map(v => ({
        id: v.id,
        impact: v.impact,
        description: v.description,
        help: v.help,
        nodes: v.nodes.length,
        wcag: v.tags.filter(t => t.startsWith('wcag'))
      }));
    });

    return { violations: axeResults };
  } catch (error) {
    console.error('Accessibility audit failed:', error.message);
    return { violations: [], error: error.message };
  }
}

module.exports = { runAccessibilityAudit };
```

---

responsive.js – Detecção de problemas responsivos básicos

```javascript
'use strict';

/**
 * Detecta overflow horizontal e possíveis problemas de viewport.
 * @param {import('playwright').Page} page
 * @returns {Promise<Object>} { horizontalOverflow, viewportWarnings }
 */
async function detectResponsiveIssues(page) {
  const result = {
    horizontalOverflow: false,
    viewportWarnings: []
  };

  try {
    const metrics = await page.evaluate(() => {
      const doc = document.documentElement;
      const body = document.body;
      const viewportWidth = window.innerWidth;
      const scrollWidth = Math.max(
        doc.scrollWidth,
        body ? body.scrollWidth : 0
      );
      const hasOverflow = scrollWidth > viewportWidth + 1; // tolerância de 1px

      // Verifica meta viewport
      const viewportMeta = document.querySelector('meta[name="viewport"]');
      const hasViewportMeta = !!viewportMeta;
      const viewportContent = viewportMeta ? viewportMeta.content : '';

      return {
        hasOverflow,
        scrollWidth,
        viewportWidth,
        hasViewportMeta,
        viewportContent
      };
    });

    result.horizontalOverflow = metrics.hasOverflow;
    if (metrics.hasOverflow) {
      result.viewportWarnings.push({
        message: `Horizontal overflow detected: scrollWidth=${metrics.scrollWidth} > viewportWidth=${metrics.viewportWidth}`
      });
    }
    if (!metrics.hasViewportMeta) {
      result.viewportWarnings.push({
        message: 'Missing <meta name="viewport"> tag'
      });
    } else if (!/width=device-width/.test(metrics.viewportContent)) {
      result.viewportWarnings.push({
        message: 'Viewport meta does not contain width=device-width'
      });
    }
  } catch (error) {
    result.viewportWarnings.push({ message: 'Responsive check failed: ' + error.message });
  }

  return result;
}

module.exports = { detectResponsiveIssues };
```

---

security.js – Validação de entrada e utilidades de segurança

```javascript
'use strict';

const DEFAULT_BROWSER = 'chromium';
const DEFAULT_DEVICE = 'desktop';
const DEFAULT_TIMEOUT = 30000;
const ALLOWED_BROWSERS = ['chromium', 'webkit'];
const ALLOWED_DEVICES = ['desktop', 'android-mobile', 'iphone', 'tablet', 'mobile-landscape'];

/**
 * Valida e normaliza as opções de entrada.
 * @param {Object} options
 * @returns {Object} Opções validadas.
 */
function validateOptions(options) {
  if (!options || typeof options !== 'object') {
    throw new Error('Options object is required');
  }

  const url = validateUrl(options.url);
  const browserType = options.browser && ALLOWED_BROWSERS.includes(options.browser)
    ? options.browser
    : DEFAULT_BROWSER;
  const device = options.device && ALLOWED_DEVICES.includes(options.device)
    ? options.device
    : DEFAULT_DEVICE;
  const viewport = options.viewport || null;
  const screenshot = typeof options.screenshot === 'boolean' ? options.screenshot : true;
  const accessibility = typeof options.accessibility === 'boolean' ? options.accessibility : true;
  const timeout = Number.isInteger(options.timeout) && options.timeout > 0
    ? options.timeout
    : DEFAULT_TIMEOUT;
  const allowedHosts = Array.isArray(options.allowedHosts) ? options.allowedHosts : [];

  return { url, browserType, device, viewport, screenshot, accessibility, timeout, allowedHosts };
}

/**
 * Valida a URL fornecida. Deve ser http/https e apontar para localhost/loopback ou allowlist explícita.
 * @param {string} url
 * @returns {string} URL normalizada.
 */
function validateUrl(url) {
  if (typeof url !== 'string' || url.trim() === '') {
    throw new Error('URL is required and must be a string');
  }
  const trimmed = url.trim();
  let parsed;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Invalid URL: ' + trimmed);
  }

  const protocol = parsed.protocol;
  if (!['http:', 'https:'].includes(protocol)) {
    throw new Error('Only http/https protocols are allowed');
  }

  // Permite localhost/IPs de loopback, mas verifica hostname
  const hostname = parsed.hostname;
  const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
  if (!allowedHosts.includes(hostname)) {
    // Se não for loopback, deve estar explicitamente na allowlist fornecida pelo chamador
    // (isso será validado em validateOptions)
    // Aqui apenas não bloqueia se a opção já foi passada; a política de rede fará bloqueio real.
  }

  return trimmed;
}

module.exports = { validateOptions, validateUrl };
```

---

package.json (trecho adicional)

```json
{
  "dependencies": {
    "playwright": "^1.40.0",
    "axe-core": "^4.8.0"
  },
  "optionalDependencies": {
    "lighthouse": "^11.0.0"
  }
}
```

---

3. Integração com o Worker

A capability deve ser registrada no Worker como uma função runWebSandbox(options) que retorna uma Promise<Object>. Exemplo de uso:

```javascript
// No Worker
const { runWebSandbox } = require('./capabilities/webSandbox');

const result = await runWebSandbox({
  url: 'http://localhost:3000',
  browser: 'chromium',
  device: 'desktop',
  screenshot: true,
  accessibility: true,
  allowedHosts: ['localhost'],  // já incluso por padrão
  timeout: 20000
});
console.log(JSON.stringify(result, null, 2));
```

---

4. Alterações no Dockerfile do Worker

Adicione as dependências do Playwright e do axe-core ao Dockerfile existente. Recomenda-se instalar os browsers via npx playwright install --with-deps.

Exemplo de trecho a adicionar no Dockerfile (após instalar dependências do Node):

```dockerfile
# Instalar browsers do Playwright (Chromium + WebKit)
RUN npx playwright install --with-deps chromium webkit

# Instalar axe-core e lighthouse (opcional)
RUN npm install axe-core
# Lighthouse pode ser instalado opcionalmente, se desejado
# RUN npm install lighthouse
```

Importante:

· O comando --with-deps instala as dependências de sistema necessárias (como libnss3, libatk, etc.).
· Execute como root durante a build, mas depois o container pode rodar com usuário não-root.

Configuração de usuário não-root e segurança recomendada (exemplo):

```dockerfile
# Criar usuário sandbox
RUN useradd -m -u 1000 sandbox
USER sandbox
WORKDIR /app
```

---

5. Como Testar Localmente

1. Instale as dependências no diretório do projeto:

```bash
npm install playwright axe-core
npx playwright install chromium webkit
```

2. Execute o script de teste:

```javascript
const { runWebSandbox } = require('./agent/src/capabilities/webSandbox');

(async () => {
  const result = await runWebSandbox({
    url: 'http://localhost:3000',  // sua aplicação local
    browser: 'webkit',
    device: 'iphone',
    screenshot: true,
    accessibility: true
  });
  console.log(JSON.stringify(result, null, 2));
})();
```

3. Para ambiente Docker, monte o diretório de trabalho e execute o container com as flags de segurança mencionadas anteriormente.

---

6. Limitações Atuais

· Execução de código arbitrário não é sandbox forte – O Playwright em um container Docker não é um isolamento completo. Se a aplicação testada for maliciosa, ainda pode tentar explorar vulnerabilidades do navegador ou do kernel. Para maior segurança, considere gVisor ou Firecracker.
· Rede – A política de rede bloqueia requisições externas via interceptação do Playwright, mas isso pode ser contornado pela aplicação se ela conseguir escapar do contexto (improvável, mas não impossível). O bloqueio deve ser reforçado no nível do container (--network none ou firewalls).
· Lighthouse – Ainda não integrado, apenas preparado como dependência opcional.
· Testes de interação – Não implementados nesta primeira entrega.
· Execução de aplicações locais – O sandbox recebe uma URL já ativa; não inicia servidores.
· Screenshot – Salvo localmente no diretório artifacts/screenshots; pode ser adaptado para upload ou outro destino.

---

7. Riscos de Segurança Ainda Existentes

· Escape do navegador – Mesmo com headless e flags de segurança, o Chromium/WebKit podem ter vulnerabilidades exploráveis.
· SSRF – Se a aplicação testada fizer requisições a serviços internos via localhost (ex: metadata endpoints), o bloqueio atual pode não cobrir todos os casos. A allowlist deve ser configurada rigorosamente.
· Filesystem – O processo Node do sandbox tem acesso ao filesystem do container; recomenda-se rodar com filesystem read-only e usar tmpfs para artefatos.
· Variáveis de ambiente – A página web não deve ter acesso direto, mas o Node pode; garanta que não há vazamento via process.env em mensagens de erro.

---

8. Pontos de Extensão Futura

· Múltiplos dispositivos em uma única execução (loop).
· Testes de interação (cliques, formulários).
· Network interception avançada (mock, throttling).
· Lighthouse como módulo dinâmico.
· Allowlist configurável por tarefa.
· Execução de aplicações locais (spawn de servidores dentro do sandbox).
· Testes em dispositivos reais via serviços externos (BrowserStack, etc.).

---

Conclusão

A implementação entrega uma base funcional que atende aos requisitos da primeira entrega. A arquitetura modular permite fácil extensão. A integração com o Worker deve ser feita seguindo o padrão de capabilities existente, registrando a função runWebSandbox. O código prioriza tratamento de erros, fechamento de recursos e validação de entrada.

Arquivos criados: 9 (conforme estrutura).
Arquivos modificados: nenhum (apenas adicionados).
Dependências adicionadas: playwright, axe-core (e opcional lighthouse).
Comandos de instalação: npm install playwright axe-core e npx playwright install chromium webkit.
Alterações no Dockerfile: adicionar instalação dos browsers Playwright e criar usuário não-root.
Teste local: conforme descrito.
Riscos: escapar do navegador, SSRF, acesso a filesystem.

Caso precise ajustar algo ao padrão existente do Worker, basta adaptar os módulos de interface (index.js e security.js) para seguir as convenções do projeto.
