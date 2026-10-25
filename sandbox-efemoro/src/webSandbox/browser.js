import { chromium, webkit } from "playwright";
import { fileURLToPath } from "node:url";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute } from "node:path";
import { positiveIntEnvOverride } from "../utils/envInt.js";
import { DEFAULT_TIMEOUT } from "./security.js";

// Flags de lançamento consolidadas -- ÚNICA lista no projeto. O
// documento original tinha duas versões divergentes (uma em
// browser.js, não usada; outra, mais completa, direto em index.js) --
// duplicação real que teria divergido silenciosamente com o tempo.
//
// `--single-process` foi removida deliberadamente: é uma flag que o
// próprio time do Chromium desaconselha para produção (instabilidade
// conhecida, especialmente em containers) -- presente no documento
// original sem essa ressalva.
const SANDBOX_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-dev-shm-usage",
  "--disable-gpu",
  "--disable-setuid-sandbox",
  "--no-first-run",
  "--no-zygote",
  "--disable-accelerated-2d-canvas",
  "--disable-background-networking",
  "--disable-background-timer-throttling",
  "--disable-breakpad",
  "--disable-client-side-phishing-detection",
  "--disable-default-apps",
  "--disable-extensions",
  "--disable-hang-monitor",
  "--disable-popup-blocking",
  "--disable-prompt-on-repost",
  "--disable-sync",
  "--disable-translate",
  "--metrics-recording-only",
  "--no-crash-upload",
  "--no-default-browser-check",
  "--safebrowsing-disable-auto-update",
];

// Override do binário do navegador, LIDO SÓ DE VARIÁVEL DE AMBIENTE --
// nunca de `options` vindo de uma chamada (HTTP ou direta). Isto é
// deliberado e crítico: `options` neste módulo é preenchido a partir
// do corpo de uma requisição HTTP em produção (ver server.js). Se um
// `executablePath` viesse de lá, qualquer chamador da API poderia
// mandar `{"browserExecutablePath": "/bin/sh", ...}` e o Playwright
// executaria esse caminho como subprocesso -- execução de código
// arbitrário no container. Por isso o único jeito de sobrescrever o
// binário é uma variável de ambiente que só quem opera o container
// controla (ex: para reaproveitar um Chromium pré-instalado na
// imagem/ambiente de teste, sem duplicar o download).
const CHROMIUM_EXECUTABLE_PATH = process.env.SANDBOX_CHROMIUM_EXECUTABLE_PATH || undefined;
const WEBKIT_EXECUTABLE_PATH = process.env.SANDBOX_WEBKIT_EXECUTABLE_PATH || undefined;

// ── Contenção de memória/CPU do processo do navegador ───────────────
//
// Achado real, testando contra um Chromium de verdade: RLIMIT_AS
// (`ulimit -v`, usado com sucesso pro bsdtar em extractArchive.js)
// NÃO é viável aqui -- um único processo renderer do Chromium reserva
// ~1.4TB de ESPAÇO DE ENDEREÇAMENTO VIRTUAL de saída (ASLR/pointer
// compression/guard pages -- não é memória FÍSICA de verdade, mas
// RLIMIT_AS conta espaço de endereçamento, não RSS), então qualquer
// teto baixo o bastante pra ser útil contra um consumo real de
// memória impede até o navegador de terminar de subir (confirmado
// tentando: 4GB de RLIMIT_AS já mata o lançamento).
//
// O que FUNCIONA, confirmado contra um Chromium real:
//
// 1. RLIMIT_CPU (`ulimit -t`, segundos de CPU realmente consumidos,
//    não wall-clock) via BROWSER_ULIMIT_WRAPPER_PATH (ver
//    browserUlimitWrapper.sh) -- aplicado ao processo raiz do
//    navegador e herdado por TODOS os processos filhos que ele lança
//    (zygote/gpu/utility/renderer, herança padrão de rlimit via
//    fork()), cada um com seu próprio teto independente. Provado
//    matando de propósito uma página com loop infinito sob um teto
//    de 2s: Playwright rejeita a navegação com "Page crashed", limpo,
//    sem travar nem derrubar o processo do sandbox-efemoro (que já
//    roda o navegador como processo do SO separado -- isolamento de
//    falha inerente à arquitetura, não uma garantia nova desta
//    mudança).
//
// 2. `--js-flags=--max-old-space-size=N` -- teto de heap do V8
//    especificamente pro JAVASCRIPT DA PÁGINA sendo testada (não pro
//    processo do Chromium como um todo). Mesma classe de defesa que
//    `resourceLimits.maxOldGenerationSizeMb` deu pra worker_thread do
//    ZIP: não cobre memória nativa do navegador, mas cobre exatamente
//    o vetor mais óbvio de abuso (uma página maliciosa alocando
//    memória sem limite via JS). Provado: um script que aloca 1GB+ em
//    arrays sob um teto de 32MB falha com "Target crashed", limpo.
//
// Como o Playwright monta ELE MESMO o array de argumentos do
// navegador logo depois de `executablePath` (sem espaço pra
// argumentos posicionais nossos antes, ao contrário de
// extractArchive.js/runBsdTar, onde controlamos o argv inteiro), o
// caminho real do binário e o teto de CPU chegam no wrapper via
// VARIÁVEL DE AMBIENTE (`launchOptions.env`), não argv -- ver
// browserUlimitWrapper.sh.
const BROWSER_ULIMIT_WRAPPER_PATH = fileURLToPath(
  new URL("./browserUlimitWrapper.sh", import.meta.url),
);

const DEFAULT_BROWSER_CPU_LIMIT_GRACE_SECONDS = 60;
const DEFAULT_PAGE_JS_HEAP_LIMIT_MB = 512;

function browserCpuLimitSeconds(timeoutMs) {
  // Escape hatch: um teto ABSOLUTO de CPU, ignorando completamente o
  // cálculo baseado em `timeout` abaixo -- pensado tanto pra
  // operação (defesa em profundidade contra um `timeout` configurado
  // grande demais) quanto pra teste (permite configurar um teto bem
  // menor que `timeout`, o único jeito de provar que RLIMIT_CPU é
  // quem derruba o processo, e não o timeout de navegação -- por
  // construção, `timeout + grace` abaixo NUNCA fica menor que
  // `timeout`, então um cenário síncrono normal nunca isola as duas
  // causas sozinho).
  const directOverrideSeconds = positiveIntEnvOverride(
    "SANDBOX_BROWSER_CPU_LIMIT_SECONDS_OVERRIDE",
    0,
  );
  if (directOverrideSeconds > 0) return directOverrideSeconds;

  // RLIMIT_CPU cobre a vida INTEIRA do processo do navegador, não só
  // o lançamento -- `timeout` (options.timeout) também é usado pro
  // page.goto() em runner.js, mas as etapas seguintes (espera de rede
  // ociosa, screenshot, auditoria de acessibilidade) não têm um prazo
  // próprio hoje. A margem cobre esse tempo adicional sem apertar o
  // caso legítimo -- é um teto de segurança contra processo
  // descontrolado, não uma otimização fina.
  const graceSeconds = positiveIntEnvOverride(
    "SANDBOX_BROWSER_CPU_LIMIT_GRACE_SECONDS",
    DEFAULT_BROWSER_CPU_LIMIT_GRACE_SECONDS,
  );
  return Math.ceil(timeoutMs / 1000) + graceSeconds;
}

function pageJsHeapLimitMb() {
  return positiveIntEnvOverride("SANDBOX_PAGE_JS_HEAP_LIMIT_MB", DEFAULT_PAGE_JS_HEAP_LIMIT_MB);
}

// Gerado pelo Dockerfile apenas no perfil browser. O caminho aponta ao
// chromium-headless-shell real, pois chromium.executablePath() aponta ao
// Chromium COMPLETO (ausente na imagem otimizada). Não é fornecido
// por requisições HTTP; a variável de operador mantém precedência.
const HEADLESS_SHELL_PATH_MANIFEST = "/app/.chromium-headless-shell-path";

function resolveRealExecutablePath(browserType) {
  if (browserType === "webkit") {
    return WEBKIT_EXECUTABLE_PATH || webkit.executablePath();
  }
  if (CHROMIUM_EXECUTABLE_PATH) return CHROMIUM_EXECUTABLE_PATH;
  if (existsSync(HEADLESS_SHELL_PATH_MANIFEST)) {
    const browserExecutable = readFileSync(HEADLESS_SHELL_PATH_MANIFEST, "utf8").trim();
    if (!isAbsolute(browserExecutable)) {
      throw new Error("Manifesto do Chromium Headless Shell inválido");
    }
    return browserExecutable;
  }
  // Execuções de desenvolvimento fora do container continuam compatíveis.
  return chromium.executablePath();
}

/**
 * Lança o navegador correspondente ao tipo pedido.
 * @param {'chromium'|'webkit'} browserType
 * @param {object} options
 * @param {number} options.timeout - Timeout de lançamento em ms.
 */
async function launchBrowser(browserType, { timeout = DEFAULT_TIMEOUT } = {}) {
  const engine = browserType === "webkit" ? webkit : chromium;

  const launchOptions = {
    headless: true,
    timeout,
    args: [...SANDBOX_LAUNCH_ARGS, `--js-flags=--max-old-space-size=${pageJsHeapLimitMb()}`],
    // Sempre lançado através do wrapper de ulimit -- nunca o binário
    // real diretamente, independente de CHROMIUM_EXECUTABLE_PATH/
    // WEBKIT_EXECUTABLE_PATH estarem definidos ou não (o wrapper
    // decide qual binário rodar via env, abaixo).
    executablePath: BROWSER_ULIMIT_WRAPPER_PATH,
    env: {
      ...process.env,
      SANDBOX_BROWSER_REAL_EXECUTABLE: resolveRealExecutablePath(browserType),
      SANDBOX_BROWSER_CPU_LIMIT_SECONDS: String(browserCpuLimitSeconds(timeout)),
    },
  };

  return engine.launch(launchOptions);
}

export { launchBrowser, SANDBOX_LAUNCH_ARGS, BROWSER_ULIMIT_WRAPPER_PATH, resolveRealExecutablePath };
