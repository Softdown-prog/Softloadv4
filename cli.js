#!/usr/bin/env node
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Softload Engine CLI — Agente Autônomo de Manutenção
 *
 * Uso: node cli.js <entidade:acao> [alvo] [--parametro=valor]
 */
'use strict';
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');
// ==========================================
// CONSTANTES DE COR (ANSI — sem dependência)
// ==========================================
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    bgRed: '\x1b[41m',
};
const ts = () => C.gray + new Date().toLocaleTimeString('pt-BR') + C.reset;
const log = (msg) => console.log(`${ts()} ${C.green}✓${C.reset} ${msg}`);
const warn = (msg) => console.log(`${ts()} ${C.yellow}⚠${C.reset} ${msg}`);
const fail = (msg) => console.error(`${ts()} ${C.red}✗${C.reset} ${msg}`);
const info = (msg) => console.log(`${ts()} ${C.cyan}→${C.reset} ${msg}`);
// ==========================================
// HELP
// ==========================================
const HELP = `
${C.bold}${C.cyan}Softload Engine CLI${C.reset} ${C.gray}— Agente Autônomo de Manutenção${C.reset}

${C.bold}Uso:${C.reset}
  node cli.js <entidade:acao> [alvo] [--parametro=valor]

${C.bold}${C.yellow}── Saúde & Diagnóstico ──${C.reset}
  worker:ping                               Teste de vida do worker
  sentinel:check                            Diagnóstico completo (JSON puro, exit 0/1)
  memoria:status                            Analisa heap, RSS, tendência de vazamento e sugere ações
  sistema:env                               Verifica variáveis de ambiente
  sistema:rotas                             Lista todas as rotas registradas no Express
  sistema:deps                              Verifica integridade de arquivos críticos
  diagnose:ejs [pasta]                      Escaneia arquivos EJS por erros de sintaxe
  diagnose:rotas                            Tenta carregar todos os route files (detects require errors)
${C.bold}${C.yellow}── Clientes ──${C.reset}
  cliente:info <email>                      Perfil completo do cliente no Firestore
  cliente:listar [--plano=premium|free]     Lista clientes (default: últimos 20)
  cliente:promover <email> --dias=<n>       Ativa plano premium
  cliente:suspender <email>                 Suspende acesso premium
  cliente:deletar <email> --force           Remove permanentemente (destructiva)

${C.bold}${C.yellow}── Auditoria ──${C.reset}
  auditoria:historico <email>               Últimas 20 compilações do cliente (JSON)
  auditoria:storage <email>                 Uso de storage e arquivos no GCS
  auditoria:erros [--n=50]                  Últimas compilações com erro do sistema

${C.bold}${C.yellow}── Compilador ──${C.reset}
  compilacao:testar                         Compila o template_base.xml com opções padrão

${C.bold}Flags globais:${C.reset}
  --json                                    Força output JSON em qualquer comando
  --silencioso                              Suprime mensagens de progresso

${C.bold}Exemplos:${C.reset}
  node cli.js sentinel:check
  node cli.js cliente:info admin@softload.com
  node cli.js cliente:promover user@test.com --dias=30
  node cli.js cliente:listar --plano=premium
  node cli.js diagnose:ejs views/pages
  node cli.js auditoria:historico user@test.com --json
`;
// ==========================================
// PARSER DE ARGUMENTOS
// ==========================================
function main() {
    const args = process.argv.slice(2);
    if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
        console.log(HELP);
        process.exit(args.length === 0 ? 1 : 0);
    }
    const comando = args[0];
    const alvo = args[1] && !args[1].startsWith('--') ? args[1] : null;
    const flags = {};
    args.slice(alvo ? 2 : 1).forEach(arg => {
        if (!arg.startsWith('--'))
            return;
        const eqIdx = arg.indexOf('=');
        if (eqIdx === -1) {
            flags[arg.slice(2)] = true;
        }
        else {
            flags[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
        }
    });
    const modoJson = !!flags.json;
    const modoSilencioso = !!flags.silencioso;
    // ==========================================
    // SENTINEL:CHECK — roda inline (sem worker_threads)
    // Devolve JSON puro para autocorreção cognitiva
    // ==========================================
    if (comando === 'sentinel:check') {
        try {
            require('dotenv').config({ path: path.join(__dirname, '.env') });
        }
        catch (_) { }
        const REMEDIATION_MAP = {
            'API Health Check': 'Verifique se o Express está rodando e a porta 8080 acessível. Tente: npm run dev',
            'Database Connection': 'Verifique FIREBASE_API_KEY, FIREBASE_APP_ID e GOOGLE_APPLICATION_CREDENTIALS no .env',
            'Compiler Endpoint': 'Rota /dashboard/compiler falhou. Verifique compilerRoutes.js e o middleware exigirPlanoAtivo.',
            'GCS Storage': 'GCS_BUCKET_NAME inválido ou credenciais do service account ausentes.',
            'Authentication': 'Firebase Auth não inicializado. Verifique src/services/firebase.js.',
            'Response Time': 'Servidor lento — verifique CPU/memória. Execute: node cli.js sistema:env',
            'Memory Usage': 'Heap elevado. Considere reiniciar o processo: pm2 restart softload',
            'Process Health': 'Verifique logs do processo. Execute: node cli.js diagnose:rotas',
        };
        const SentinelWorker = require('./src/services/sentinelWorker');
        (async () => {
            let result;
            try {
                result = await SentinelWorker.runAllTests();
            }
            catch (err) {
                const payload = {
                    isHealthy: false,
                    healthScore: 0,
                    error: err.message,
                    REMEDIATION: 'Falha crítica no SentinelWorker. Verifique src/services/sentinelWorker.js e as variáveis de ambiente.'
                };
                process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
                process.exit(1);
            }
            const failedTests = Object.entries(result.tests || {})
                .filter(([, v]) => v.status !== 'PASS')
                .map(([name, v]) => ({
                test: name,
                status: v.status,
                message: v.message || v.error || '—',
                REMEDIATION: REMEDIATION_MAP[name] || 'Consulte os logs do servidor.',
            }));
            const output = {
                isHealthy: result.isHealthy,
                healthScore: result.healthScore,
                trend: result.trend,
                durationMs: result.durationMs,
                timestamp: result.timestamp,
                uptime: SentinelWorker.getUptime(),
                tests: result.tests,
                failedTests,
                anomalies: result.anomalies || [],
                recommendations: result.recommendations || [],
                REMEDIATION: failedTests.length > 0 ? failedTests[0].REMEDIATION : null,
                consecutiveFailures: result.consecutiveFailures || {},
            };
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            process.exit(result.isHealthy ? 0 : 1);
        })();
        return;
    }
    // ==========================================
    // MEMORIA:STATUS — roda inline (sem Firebase)
    // Analisa heap, RSS, tendência de crescimento e sugere ações
    // ==========================================
    if (comando === 'memoria:status') {
        const sentinel = (() => { try {
            return require('./src/services/sentinelWorker');
        }
        catch (_) {
            return null;
        } })();
        const v8 = require('v8');
        const mem = process.memoryUsage();
        const heapUsedMb = parseFloat((mem.heapUsed / 1024 / 1024).toFixed(2));
        const heapTotalMb = parseFloat((mem.heapTotal / 1024 / 1024).toFixed(2));
        const rssMb = parseFloat((mem.rss / 1024 / 1024).toFixed(2));
        const externalMb = parseFloat((mem.external / 1024 / 1024).toFixed(2));
        const arrayBufMb = parseFloat(((mem.arrayBuffers || 0) / 1024 / 1024).toFixed(2));
        // Usar heap_size_limit (teto real do processo) como denominador, não heapTotal
        // (heapTotal é apenas o segmento V8 alocado agora — cresce/encolhe via GC)
        const heapLimit = v8.getHeapStatistics().heap_size_limit;
        const heapLimitMb = parseFloat((heapLimit / 1024 / 1024).toFixed(2));
        const usagePercent = Math.round((mem.heapUsed / heapLimit) * 100);
        // Detecta tendência de crescimento via histórico do Sentinel
        let tendencia = 'desconhecida';
        let crescimentoMb = null;
        let amostras = [];
        if (sentinel && sentinel.testResults && sentinel.testResults.length >= 3) {
            amostras = sentinel.testResults.slice(-10)
                .map(r => r.tests && r.tests['Memory Usage'] ? r.tests['Memory Usage'].heapUsedMb : null)
                .filter((v) => v !== null);
            if (amostras.length >= 3) {
                const old = amostras.slice(0, Math.floor(amostras.length / 2)).reduce((a, b) => a + b, 0) / Math.floor(amostras.length / 2);
                const recente = amostras.slice(Math.floor(amostras.length / 2)).reduce((a, b) => a + b, 0) / (amostras.length - Math.floor(amostras.length / 2));
                crescimentoMb = parseFloat((recente - old).toFixed(2));
                if (crescimentoMb > 5)
                    tendencia = 'crescendo';
                else if (crescimentoMb < -2)
                    tendencia = 'diminuindo';
                else
                    tendencia = 'estavel';
            }
        }
        // Tenta forçar GC se exposto (node --expose-gc)
        let gcForcado = false;
        let heapAposGc = null;
        if (typeof global.gc === 'function') {
            global.gc();
            gcForcado = true;
            const memApos = process.memoryUsage();
            heapAposGc = parseFloat((memApos.heapUsed / 1024 / 1024).toFixed(2));
        }
        // Alertas — thresholds sobre o limite real (heap_size_limit)
        const alertas = [];
        if (usagePercent >= 90)
            alertas.push({ nivel: 'CRITICO', msg: 'Heap crítico (' + usagePercent + '% do limite) — risco de OOM. Reinicie o processo.' });
        else if (usagePercent >= 75)
            alertas.push({ nivel: 'WARN', msg: 'Heap elevado (' + usagePercent + '% do limite). Monitore de perto.' });
        if (tendencia === 'crescendo' && crescimentoMb > 10)
            alertas.push({ nivel: 'WARN', msg: 'Heap cresceu +' + crescimentoMb + 'MB nas últimas amostras — possível vazamento.' });
        if (rssMb > 512)
            alertas.push({ nivel: 'WARN', msg: 'RSS alto (' + rssMb + 'MB). Verifique buffers e streams não liberados.' });
        if (externalMb > 50)
            alertas.push({ nivel: 'WARN', msg: 'Memória externa elevada (' + externalMb + 'MB). Verifique Buffers e bindings nativos.' });
        const sugestoes = [];
        if (usagePercent >= 80)
            sugestoes.push('Reiniciar o processo Node.js libera o heap imediatamente (pm2 restart softload).');
        if (tendencia === 'crescendo')
            sugestoes.push('Revise closures em setInterval/setTimeout e event listeners não removidos.');
        if (externalMb > 30)
            sugestoes.push('Verifique streams/Buffers que não são descartados após uso em storageService.');
        if (sugestoes.length === 0)
            sugestoes.push('Memória dentro dos parâmetros normais. Nenhuma ação necessária.');
        const output = {
            ok: usagePercent < 75 && alertas.filter(a => a.nivel === 'CRITICO').length === 0,
            timestamp: new Date().toISOString(),
            heap: {
                usadoMb: heapUsedMb,
                totalMb: heapTotalMb, // V8 alocado agora (pequeno, varia com GC)
                limiteMb: heapLimitMb, // Teto real do processo (~1500MB)
                percentual: usagePercent, // heapUsed / heap_size_limit
            },
            rssMb,
            externalMb,
            arrayBuffersMb: arrayBufMb,
            tendencia,
            crescimentoMb,
            amostrasHistorico: amostras.length,
            gcForcado,
            heapAposGcMb: heapAposGc,
            alertas,
            sugestoes,
            pid: process.pid,
            uptime: Math.round(process.uptime()),
            nodeVersion: process.version,
        };
        if (modoJson) {
            process.stdout.write(JSON.stringify(output, null, 2) + '\n');
            process.exit(output.ok ? 0 : 1);
        }
        // Output legível
        const statusIcon = output.ok ? C.green + '✓' : C.yellow + '⚠';
        console.log(`\n${C.bold}${C.cyan}Análise de Memória${C.reset} ${C.gray}— PID ${output.pid} — Node ${output.nodeVersion}${C.reset}\n`);
        console.log(`${C.bold}Heap:${C.reset}     ${heapUsedMb}MB / ${heapTotalMb}MB ${C.bold}(${usagePercent}%)${C.reset}`);
        console.log(`${C.bold}RSS:${C.reset}      ${rssMb}MB`);
        console.log(`${C.bold}External:${C.reset} ${externalMb}MB  ArrayBuffers: ${arrayBufMb}MB`);
        console.log(`${C.bold}Tendência:${C.reset} ${tendencia}${crescimentoMb !== null ? ' (' + (crescimentoMb > 0 ? '+' : '') + crescimentoMb + 'MB)' : ''} — ${amostras.length} amostras`);
        if (gcForcado)
            console.log(`${C.bold}GC forçado:${C.reset} heap caiu para ${heapAposGc}MB`);
        console.log('');
        if (alertas.length) {
            alertas.forEach(a => {
                const icon = a.nivel === 'CRITICO' ? C.red + '✗' : C.yellow + '⚠';
                console.log(`${icon}${C.reset} ${a.msg}`);
            });
            console.log('');
        }
        sugestoes.forEach(s => console.log(`${C.cyan}→${C.reset} ${s}`));
        console.log('');
        process.exit(output.ok ? 0 : 1);
        return;
    }
    // ==========================================
    // DIAGNOSE:EJS — roda inline (não precisa de Firebase)
    // Escaneia templates EJS por erros de sintaxe
    // ==========================================
    if (comando === 'diagnose:ejs') {
        const ejs = (() => { try {
            return require('ejs');
        }
        catch (_) {
            return null;
        } })();
        if (!ejs) {
            fail('Módulo EJS não encontrado. Execute: npm install');
            process.exit(1);
        }
        const basePath = alvo
            ? path.resolve(__dirname, alvo)
            : path.join(__dirname, 'views');
        if (!fs.existsSync(basePath)) {
            fail(`Pasta não encontrada: ${basePath}`);
            process.exit(1);
        }
        info(`Escaneando EJS em: ${basePath}`);
        function scanDir(dir, results = []) {
            const entries = fs.readdirSync(dir, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    scanDir(fullPath, results);
                }
                else if (entry.name.endsWith('.ejs')) {
                    results.push(fullPath);
                }
            }
            return results;
        }
        const ejsFiles = scanDir(basePath);
        const erros = [];
        const relBase = path.resolve(__dirname);
        for (const file of ejsFiles) {
            const relPath = file.replace(relBase + '/', '');
            try {
                const content = fs.readFileSync(file, 'utf-8');
                ejs.compile(content, { filename: file });
                if (!modoSilencioso)
                    log(`${relPath}`);
            }
            catch (err) {
                const msg = err.message.replace(/\n/g, ' ').substring(0, 120);
                fail(`${C.bold}${relPath}${C.reset}${C.red} — ${msg}${C.reset}`);
                erros.push({ file: relPath, error: msg });
            }
        }
        console.log('');
        if (erros.length === 0) {
            log(`${C.bold}${ejsFiles.length} arquivos EJS OK — zero erros${C.reset}`);
            if (modoJson)
                process.stdout.write(JSON.stringify({ ok: true, total: ejsFiles.length, erros: [] }, null, 2) + '\n');
            process.exit(0);
        }
        else {
            fail(`${erros.length} arquivo(s) com erro de ${ejsFiles.length} escaneados`);
            if (modoJson)
                process.stdout.write(JSON.stringify({ ok: false, total: ejsFiles.length, erros }, null, 2) + '\n');
            process.exit(1);
        }
        return;
    }
    // ==========================================
    // DIAGNOSE:ROTAS — roda inline
    // Tenta dar require() em todos os route files
    // ==========================================
    if (comando === 'diagnose:rotas') {
        const routesDir = path.join(__dirname, 'src', 'routes');
        const files = fs.readdirSync(routesDir).filter(f => f.endsWith('.js'));
        const erros = [];
        info(`Verificando ${files.length} route files em src/routes/`);
        for (const file of files) {
            const fullPath = path.join(routesDir, file);
            try {
                // Limpa cache para forçar reload
                delete require.cache[require.resolve(fullPath)];
                require(fullPath);
                if (!modoSilencioso)
                    log(file);
            }
            catch (err) {
                fail(`${C.bold}${file}${C.reset}${C.red} — ${err.message}${C.reset}`);
                erros.push({ file, error: err.message });
            }
        }
        console.log('');
        if (erros.length === 0) {
            log(`${C.bold}Todos os ${files.length} route files carregam sem erro${C.reset}`);
            if (modoJson)
                process.stdout.write(JSON.stringify({ ok: true, files: files.length, erros: [] }, null, 2) + '\n');
            process.exit(0);
        }
        else {
            fail(`${erros.length} route(s) com erro`);
            if (modoJson)
                process.stdout.write(JSON.stringify({ ok: false, files: files.length, erros }, null, 2) + '\n');
            process.exit(1);
        }
        return;
    }
    // ==========================================
    // COMPILACAO:TESTAR — roda inline (sem Firebase)
    // ==========================================
    if (comando === 'compilacao:testar') {
        const { compilarTemplate } = require('./src/core/compilerEngine');
        const templatePath = path.join(__dirname, 'src', 'rag', 'templates', 'template_base.xml');
        let templateBase;
        try {
            templateBase = fs.readFileSync(templatePath, 'utf-8');
        }
        catch (err) {
            fail(`template_base.xml não encontrado: ${err.message}`);
            process.exit(1);
        }
        const startMs = Date.now();
        try {
            const { xml } = compilarTemplate(templateBase, {
                siteName: 'Teste CLI Softload',
                enableSeo: true,
                gridLayout: 'revista',
                colorPreset: 'tech-blue',
                buttonStyle: 'default',
                typography: 'inter',
                modules: { darkMode: true, backToTop: true, cookieBanner: true },
                categoryBadges: [],
                lazyLoad: true,
            });
            const linhas = xml.split('\n').length;
            const kb = (Buffer.byteLength(xml, 'utf8') / 1024).toFixed(1);
            const ms = Date.now() - startMs;
            log(`Compilação OK — ${linhas} linhas — ${kb}KB — ${ms}ms`);
            if (modoJson) {
                process.stdout.write(JSON.stringify({ ok: true, linhas, kb, ms }, null, 2) + '\n');
            }
            process.exit(0);
        }
        catch (err) {
            fail(`Compilação falhou: ${err.message}`);
            if (modoJson)
                process.stdout.write(JSON.stringify({ ok: false, error: err.message }, null, 2) + '\n');
            process.exit(1);
        }
        return;
    }
    // ==========================================
    // SISTEMA:DEPS — verifica integridade de arquivos críticos
    // ==========================================
    if (comando === 'sistema:deps') {
        const ARQUIVOS_CRITICOS = [
            'server.js',
            'cli.js',
            'src/services/firebase.js',
            'src/services/sentinelWorker.js',
            'src/services/storageService.js',
            'src/core/compilerEngine/index.js',
            'src/core/modules.js',
            'src/core/presets.js',
            'src/routes/authRoutes.js',
            'src/routes/adminRoutes.js',
            'src/routes/dashboardRoutes.js',
            'src/routes/workersRoutes.js',
            'src/routes/contatoRoutes.js',
            'src/routes/apiRoutes.js',
            'src/middlewares/authGuard.js',
            'src/middlewares/adminGuard.js',
            'src/middlewares/workerGuard.js',
            'src/middlewares/security.js',
            'src/workers/taskWorker.js',
            'src/rag/templates/template_base.xml',
            'public/css/softload.css',
            'views/pages/react-landing.ejs',
            'views/pages/react-test.ejs',
            'views/pages/react-admin.ejs',
            'views/pages/react-public.ejs',
            'views/pages/workers/worker_health.ejs',
            'views/partials/header.ejs',
            'views/partials/footer.ejs',
            'frontend/App.tsx',
            '.env',
            'package.json',
        ];
        const ausentes = [];
        const presentes = [];
        for (const f of ARQUIVOS_CRITICOS) {
            const full = path.join(__dirname, f);
            if (fs.existsSync(full)) {
                presentes.push(f);
                if (!modoSilencioso)
                    log(f);
            }
            else {
                fail(`${C.bold}AUSENTE${C.reset}: ${f}`);
                ausentes.push(f);
            }
        }
        console.log('');
        log(`${presentes.length}/${ARQUIVOS_CRITICOS.length} arquivos críticos presentes`);
        if (ausentes.length > 0) {
            fail(`${ausentes.length} arquivo(s) AUSENTE(S):`);
            ausentes.forEach(f => console.log(`  ${C.red}→${C.reset} ${f}`));
        }
        if (modoJson) {
            process.stdout.write(JSON.stringify({ ok: ausentes.length === 0, presentes, ausentes }, null, 2) + '\n');
        }
        process.exit(ausentes.length === 0 ? 0 : 1);
        return;
    }
    // ==========================================
    // SISTEMA:ENV — verifica variáveis de ambiente
    // ==========================================
    if (comando === 'sistema:env') {
        try {
            require('dotenv').config({ path: path.join(__dirname, '.env') });
        }
        catch (_) { }
        const ENV_OBRIGATORIAS = [
            'FIREBASE_API_KEY',
            'FIREBASE_APP_ID',
            'SESSION_SECRET',
            'RESEND_API_KEY',
            'PIXABAY_API_KEY',
            'MP_ACCESS_TOKEN',
            'MP_CHECKOUT_URL',
            'GCS_BUCKET_NAME',
        ];
        const ENV_OPCIONAIS = ['NODE_ENV', 'PORT', 'GOOGLE_APPLICATION_CREDENTIALS'];
        const ausentes = [];
        const presentes = [];
        for (const key of ENV_OBRIGATORIAS) {
            if (process.env[key]) {
                const val = process.env[key];
                const preview = val.length > 8 ? val.substring(0, 4) + '****' + val.slice(-2) : '****';
                if (!modoSilencioso)
                    log(`${key}=${preview}`);
                presentes.push(key);
            }
            else {
                fail(`${C.bold}AUSENTE${C.reset}: ${key}`);
                ausentes.push(key);
            }
        }
        console.log('');
        for (const key of ENV_OPCIONAIS) {
            const val = process.env[key] || '(não definida)';
            info(`${key}=${val} ${C.gray}(opcional)${C.reset}`);
        }
        console.log('');
        if (ausentes.length === 0) {
            log(`${C.bold}Todas as ${ENV_OBRIGATORIAS.length} variáveis obrigatórias estão presentes${C.reset}`);
        }
        else {
            fail(`${ausentes.length} variável(is) AUSENTE(S). Adicione ao arquivo .env`);
        }
        if (modoJson) {
            process.stdout.write(JSON.stringify({ ok: ausentes.length === 0, presentes, ausentes }, null, 2) + '\n');
        }
        process.exit(ausentes.length === 0 ? 0 : 1);
        return;
    }
    // ==========================================
    // SISTEMA:ROTAS — lista rotas via require inline
    // ==========================================
    if (comando === 'sistema:rotas') {
        try {
            require('dotenv').config({ path: path.join(__dirname, '.env') });
        }
        catch (_) { }
        const ROUTE_FILES = [
            { file: './src/routes/authRoutes.js', prefixo: '/' },
            { file: './src/routes/dashboardRoutes.js', prefixo: '/' },
            { file: './src/routes/adminRoutes.js', prefixo: '/' },
            { file: './src/routes/workersRoutes.js', prefixo: '/' },
            { file: './src/routes/contatoRoutes.js', prefixo: '/' },
            { file: './src/routes/apiRoutes.js', prefixo: '/' },
        ];
        info(`Mapeando rotas de ${ROUTE_FILES.length} route files...\n`);
        const todasRotas = [];
        for (const { file } of ROUTE_FILES) {
            try {
                const router = require(path.join(__dirname, file.replace('./', '')));
                const fileName = path.basename(file);
                if (router && router.stack) {
                    const rotas = router.stack
                        .filter(layer => layer.route)
                        .map(layer => ({
                        metodo: Object.keys(layer.route.methods).join('|').toUpperCase(),
                        path: layer.route.path,
                        file: fileName,
                    }));
                    for (const r of rotas) {
                        todasRotas.push(r);
                        const metodoCor = r.metodo === 'GET' ? C.green : r.metodo === 'POST' ? C.yellow : C.cyan;
                        if (!modoSilencioso) {
                            console.log(`  ${metodoCor}${r.metodo.padEnd(5)}${C.reset} ${r.path.padEnd(40)} ${C.gray}${r.file}${C.reset}`);
                        }
                    }
                }
            }
            catch (err) {
                fail(`${path.basename(file)}: ${err.message}`);
            }
        }
        console.log('');
        log(`${todasRotas.length} rota(s) mapeada(s)`);
        if (modoJson) {
            process.stdout.write(JSON.stringify(todasRotas, null, 2) + '\n');
        }
        process.exit(0);
        return;
    }
    // ==========================================
    // DESPACHO VIA worker_threads (comandos com Firebase)
    // ==========================================
    try {
        require('dotenv').config({ path: path.join(__dirname, '.env') });
    }
    catch (_) { }
    const WORKER_PATH = path.join(__dirname, 'src', 'workers', 'taskWorker.js');
    if (!fs.existsSync(WORKER_PATH)) {
        fail(`taskWorker.js não encontrado em: ${WORKER_PATH}`);
        process.exit(1);
    }
    const workerData = {
        comando,
        alvo,
        flags,
        modoJson,
        env: {
            FIREBASE_API_KEY: process.env.FIREBASE_API_KEY,
            FIREBASE_APP_ID: process.env.FIREBASE_APP_ID,
            SESSION_SECRET: process.env.SESSION_SECRET,
            GCS_BUCKET_NAME: process.env.GCS_BUCKET_NAME,
            GOOGLE_APPLICATION_CREDENTIALS: process.env.GOOGLE_APPLICATION_CREDENTIALS,
            NODE_ENV: process.env.NODE_ENV || 'development',
        }
    };
    const worker = new Worker(WORKER_PATH, { workerData });
    worker.on('message', (msg) => {
        if (msg.json) {
            // Apenas dados intencionalmente JSON vão para stdout — mensagens de progresso
            // (ok/aviso) não devem contaminar o stdout quando o chatHandler está parseando JSON.
            process.stdout.write(JSON.stringify(msg.dados || msg, null, 2) + '\n');
        }
        else if (msg.tipo === 'erro') {
            fail(msg.texto || JSON.stringify(msg));
            if (msg.sugestao)
                info(`Sugestão: ${msg.sugestao}`);
        }
        else if (msg.tipo === 'aviso') {
            warn(msg.texto || JSON.stringify(msg));
        }
        else {
            log(msg.texto || JSON.stringify(msg));
        }
    });
    worker.on('error', (err) => {
        fail(`Worker crash: ${err.message}`);
        process.exit(1);
    });
    worker.on('exit', (code) => {
        process.exit(code);
    });
}
main();
