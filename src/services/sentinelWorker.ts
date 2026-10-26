export type SentinelTestStatus = 'PASS' | 'WARN' | 'FAIL';
export type SentinelTrend = 'melhorando' | 'degradando' | 'estavel' | 'insuficiente';
export interface SentinelTestResult {
    status: SentinelTestStatus; message?: string; error?: string; details?: unknown;
    responseTime?: number; statusCode?: number; timestamp?: Date; bucket?: string;
    heapUsedMb?: number; heapTotalMb?: number; heapLimitMb?: number; rssMb?: number;
    externalMb?: number; usagePercent?: number; uptimeSecs?: number; uptimeHours?: number;
    cpuDeltaMs?: number; pid?: number; nodeVersion?: string;
}
export interface SentinelAnomaly { test: string; responseTime: number; avgResponseTime: number; spike: number }
export interface SentinelRecommendation { test: string; status: 'FAIL' | 'WARN'; consecutiveFails: number; recommendation: string; urgent: boolean }
export interface SentinelReport {
    timestamp: Date; tests: Record<string, SentinelTestResult>; errors: { test: string; error?: string }[];
    durationMs: number; isHealthy: boolean; healthScore: number; trend: SentinelTrend;
    anomalies: SentinelAnomaly[]; recommendations: SentinelRecommendation[];
}
interface SentinelInitialStatus { timestamp: Date; isHealthy: boolean; tests: Record<string, SentinelTestResult>; errors: { test: string; error?: string }[]; lastCheck: null }
interface SentinelHttpResult { statusCode?: number; headers: import('node:http').IncomingHttpHeaders }
interface SentinelFailure { message?: string; details?: unknown }
interface SentinelServices {
    db: { collection(name: string): { limit(count: number): { get(): Promise<unknown> } } };
    bucket: { exists(): Promise<unknown>; name: string };
    auth: { listUsers(count: number): Promise<unknown> };
}

/**
 * Sentinel Worker — Monitora a saúde da aplicação
 * Executa testes automáticos periódicos e reporta status
 */

const http = require('http') as typeof import('node:http');
const v8   = require('v8') as typeof import('node:v8');

const REMEDIATION: Record<string, string> = {
    'API Health Check':    'Verifique se o Express está rodando e a porta 8080 acessível.',
    'Database Connection': 'Verifique as credenciais do Firebase e a conexão com a internet.',
    'Compiler Endpoint':   'Verifique a rota /dashboard/blogger-ai e o middleware de autenticação.',
    'GCS Storage':         'Verifique as credenciais GCS e as permissões do bucket.',
    'Authentication':      'Verifique as credenciais do Firebase Auth SDK.',
    'Response Time':       'Servidor lento — verifique carga de CPU e memória do processo Node.js.',
    'Memory Usage':        'Heap elevado — considere reiniciar o servidor ou revisar possíveis memory leaks.',
    'Process Health':      'Verifique os logs do processo Node.js em busca de erros críticos.',
};

class SentinelWorker {
    status: SentinelInitialStatus | SentinelReport;
    testResults: SentinelReport[];
    maxResults: number;
    consecutiveFailures: Record<string, number>;
    responseTimeSamples: Record<string, number[]>;
    _cpuUsageBaseline: NodeJS.CpuUsage | null;
    interval?: ReturnType<typeof setInterval>;
    lastCheck?: Date;
    constructor() {
        this.status = {
            timestamp: new Date(),
            isHealthy: true,
            tests: {},
            errors: [],
            lastCheck: null
        };

        this.testResults = [];
        this.maxResults = 50;

        // Inteligência: rastrear falhas consecutivas e amostras de tempo de resposta
        this.consecutiveFailures = {}; // { testName: number }
        this.responseTimeSamples = {}; // { testName: number[] }
        this._cpuUsageBaseline = null;
    }

    /**
     * Inicia o worker sentinela com intervalo específico
     */
    start(intervalMs = 60000) {
        console.log('🛡️ Sentinel Worker iniciado — intervalo de ' + (intervalMs / 1000) + 's');
        this.runAllTests();
        this.interval = setInterval(() => this.runAllTests(), intervalMs);
    }

    /**
     * Para o worker sentinela
     */
    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            console.log('🛑 Sentinel Worker parado');
        }
    }

    /**
     * Executa todos os testes
     */
    async runAllTests(): Promise<SentinelReport> {
        const startTime = Date.now();
        const results: Partial<SentinelReport> & Pick<SentinelReport, 'timestamp' | 'tests' | 'errors'> = {
            timestamp: new Date(),
            tests: {},
            errors: []
        };

        const tests: { name: string; fn: () => Promise<SentinelTestResult> }[] = [
            { name: 'API Health Check',    fn: () => this.testApiHealth() },
            { name: 'Database Connection', fn: () => this.testDatabase() },
            { name: 'Compiler Endpoint',   fn: () => this.testCompilerEndpoint() },
            { name: 'GCS Storage',         fn: () => this.testGCSStorage() },
            { name: 'Authentication',      fn: () => this.testAuthentication() },
            { name: 'Response Time',       fn: () => this.testResponseTime() },
            { name: 'Memory Usage',        fn: () => this.testMemoryUsage() },
            { name: 'Process Health',      fn: () => this.testProcessHealth() },
        ];

        await Promise.all(tests.map(async (test) => {
            try {
                const result = await test.fn();
                results.tests[test.name] = result;
            } catch (error) {
                results.tests[test.name] = {
                    status: 'FAIL',
                    error: (error as SentinelFailure).message,
                    details: (error as SentinelFailure).details || null
                };
                results.errors.push({ test: test.name, error: (error as SentinelFailure).message });
            }
        }));

        // Atualizar falhas consecutivas e amostras de tempo de resposta
        for (const [name, result] of Object.entries(results.tests)) {
            if (result.status === 'FAIL') {
                this.consecutiveFailures[name] = (this.consecutiveFailures[name] || 0) + 1;
            } else {
                this.consecutiveFailures[name] = 0;
            }

            if (result.responseTime != null) {
                const samples = this.responseTimeSamples[name] || [];
                this.responseTimeSamples[name] = [...samples.slice(-9), result.responseTime];
            }
        }

        results.durationMs      = Date.now() - startTime;
        results.isHealthy       = results.errors.length === 0;
        results.healthScore     = this.calculateHealthScore(results.tests);
        results.trend           = this.analyzeTrend();
        results.anomalies       = this.detectAnomalies(results.tests);
        results.recommendations = this.getRecommendations(results.tests);

        this.status    = results as SentinelReport;
        this.lastCheck = new Date();

        this.testResults.push(results as SentinelReport);
        if (this.testResults.length > this.maxResults) this.testResults.shift();

        const healthEmoji = results.isHealthy ? '✅' : '❌';
        const trendArrow  = results.trend === 'melhorando' ? '↑' : results.trend === 'degradando' ? '↓' : '→';
        console.log(`${healthEmoji} Sentinel Check — Score: ${results.healthScore}% ${trendArrow} — ${results.durationMs}ms`);

        return results as SentinelReport;
    }

    // ==========================================
    // TESTES INDIVIDUAIS
    // ==========================================

    async testApiHealth(): Promise<SentinelTestResult> {
        const start = Date.now();
        try {
            const result = await this.makeRequest('/health');
            const responseTime = Date.now() - start;
            if (result.statusCode === 200) {
                return { status: 'PASS', message: 'API respondendo normalmente', responseTime, statusCode: result.statusCode };
            }
            throw new Error(`Status inesperado: ${result.statusCode}`);
        } catch (error) {
            throw { message: 'API não está respondendo', details: (error as SentinelFailure).message || error };
        }
    }

    async testDatabase(): Promise<SentinelTestResult> {
        try {
            const { db } = require('./firebase') as SentinelServices;
            if (!db) throw new Error('Firestore não inicializado');
            await db.collection('_sentinel_ping').limit(1).get();
            return { status: 'PASS', message: 'Firestore conectado e respondendo', timestamp: new Date() };
        } catch (error) {
            throw { message: 'Erro na conexão com Firestore', details: (error as SentinelFailure).message };
        }
    }

    async testCompilerEndpoint(): Promise<SentinelTestResult> {
        try {
            const result = await this.makeRequest('/dashboard/chat');
            if (result.statusCode === 200 || result.statusCode === 302) {
                return { status: 'PASS', message: 'Gerador IA endpoint acessível', statusCode: result.statusCode };
            }
            throw new Error(`Status code inesperado: ${result.statusCode}`);
        } catch (error) {
            throw { message: 'Gerador IA endpoint indisponível', details: (error as SentinelFailure).message };
        }
    }

    async testGCSStorage(): Promise<SentinelTestResult> {
        try {
            const { bucket } = require('./firebase') as SentinelServices;
            if (!bucket) throw new Error('GCS bucket não inicializado');
            await bucket.exists();
            return { status: 'PASS', message: 'Google Cloud Storage acessível', bucket: bucket.name, timestamp: new Date() };
        } catch (error) {
            throw { message: 'GCS Storage indisponível', details: (error as SentinelFailure).message };
        }
    }

    async testAuthentication(): Promise<SentinelTestResult> {
        try {
            const { auth } = require('./firebase') as SentinelServices;
            if (!auth) throw new Error('Firebase Auth não inicializado');
            await auth.listUsers(1);
            return { status: 'PASS', message: 'Firebase Auth operacional', timestamp: new Date() };
        } catch (error) {
            throw { message: 'Autenticação indisponível', details: (error as SentinelFailure).message };
        }
    }

    async testResponseTime(): Promise<SentinelTestResult> {
        try {
            const start = Date.now();
            await this.makeRequest('/');
            const duration = Date.now() - start;
            const status  = duration < 500 ? 'PASS' : 'WARN';
            const message = duration < 500 ? 'Tempo de resposta excelente' : `Tempo de resposta lento (${duration}ms)`;
            return { status, message, responseTime: duration };
        } catch (error) {
            throw { message: 'Erro ao testar tempo de resposta', details: (error as SentinelFailure).message };
        }
    }

    /**
     * Teste: Uso de memória do processo Node.js
     */
    async testMemoryUsage(): Promise<SentinelTestResult> {
        const mem           = process.memoryUsage();
        const heapUsedMb    = parseFloat((mem.heapUsed   / 1024 / 1024).toFixed(1));
        const heapTotalMb   = parseFloat((mem.heapTotal  / 1024 / 1024).toFixed(1));
        const rssMb         = parseFloat((mem.rss        / 1024 / 1024).toFixed(1));
        const externalMb    = parseFloat((mem.external   / 1024 / 1024).toFixed(1));

        // heapTotal é apenas o segmento alocado *agora* pelo V8, não o limite real.
        // heap_size_limit é o teto verdadeiro (--max-old-space-size ou padrão ~1.5GB),
        // evitando falsos WARN/FAIL quando o V8 expande o heap sob demanda.
        const heapLimit     = v8.getHeapStatistics().heap_size_limit;
        const heapLimitMb   = parseFloat((heapLimit / 1024 / 1024).toFixed(1));
        const usagePercent  = Math.round((mem.heapUsed / heapLimit) * 100);

        let status: SentinelTestStatus = 'PASS';
        let message = `Heap: ${heapUsedMb}MB / ${heapLimitMb}MB limite (${usagePercent}%) — RSS: ${rssMb}MB`;

        if (usagePercent >= 90) {
            status  = 'FAIL';
            message = `Heap crítico: ${usagePercent}% do limite — risco de OOM (${heapUsedMb}MB / ${heapLimitMb}MB)`;
        } else if (usagePercent >= 75) {
            status  = 'WARN';
            message = `Heap elevado: ${usagePercent}% do limite — ${heapUsedMb}MB / ${heapLimitMb}MB`;
        }

        return { status, message, heapUsedMb, heapTotalMb, heapLimitMb, rssMb, externalMb, usagePercent };
    }

    /**
     * Teste: Saúde geral do processo (uptime, CPU delta, versão Node)
     */
    async testProcessHealth(): Promise<SentinelTestResult> {
        const uptimeSecs  = process.uptime();
        const uptimeHours = parseFloat((uptimeSecs / 3600).toFixed(2));

        // CPU delta desde a última medição
        const cpuNow           = process.cpuUsage(this._cpuUsageBaseline || undefined);
        this._cpuUsageBaseline = process.cpuUsage();
        const cpuMs            = parseFloat(((cpuNow.user + cpuNow.system) / 1000).toFixed(1));

        let status: SentinelTestStatus = 'PASS';
        let message = `Uptime: ${uptimeHours}h — CPU delta: ${cpuMs}ms — Node ${process.version}`;

        // CPU delta >5s em 1min de intervalo = >8% — sinalizar WARN
        if (cpuMs > 5000) {
            status  = 'WARN';
            message = `CPU delta elevado: ${cpuMs}ms — pode haver pico de carga`;
        }

        return {
            status,
            message,
            uptimeSecs: Math.round(uptimeSecs),
            uptimeHours,
            cpuDeltaMs: cpuMs,
            pid: process.pid,
            nodeVersion: process.version,
        };
    }

    // ==========================================
    // INTELIGÊNCIA ANALÍTICA
    // ==========================================

    /**
     * Analisa a tendência do health score nas últimas execuções
     * @returns {'melhorando'|'degradando'|'estavel'|'insuficiente'}
     */
    analyzeTrend(): SentinelTrend {
        if (this.testResults.length < 3) return 'insuficiente';

        const scores  = this.testResults.slice(-6).map(r => r.healthScore);
        const half    = Math.floor(scores.length / 2);
        const older   = scores.slice(0, half).reduce((a, b) => a + b, 0) / half;
        const recent  = scores.slice(half).reduce((a, b)  => a + b, 0) / (scores.length - half);

        if (recent > older + 5)  return 'melhorando';
        if (recent < older - 5)  return 'degradando';
        return 'estavel';
    }

    /**
     * Detecta anomalias de tempo de resposta comparando com média histórica
     */
    detectAnomalies(tests: Record<string, SentinelTestResult>): SentinelAnomaly[] {
        const anomalies: SentinelAnomaly[] = [];
        for (const [name, result] of Object.entries(tests)) {
            if (result.responseTime == null) continue;
            const samples = this.responseTimeSamples[name];
            if (!samples || samples.length < 3) continue;
            const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
            if (result.responseTime > avg * 2 && result.responseTime > 200) {
                anomalies.push({
                    test: name,
                    responseTime: result.responseTime,
                    avgResponseTime: Math.round(avg),
                    spike: Math.round(result.responseTime / avg * 10) / 10
                });
            }
        }
        return anomalies;
    }

    /**
     * Gera recomendações de remediação baseadas nos testes com problemas
     */
    getRecommendations(tests: Record<string, SentinelTestResult>): SentinelRecommendation[] {
        const recs: SentinelRecommendation[] = [];
        for (const [name, result] of Object.entries(tests)) {
            if (result.status !== 'FAIL' && result.status !== 'WARN') continue;
            const consec = this.consecutiveFailures[name] || 0;
            recs.push({
                test: name,
                status: result.status,
                consecutiveFails: consec,
                recommendation: REMEDIATION[name] || 'Verifique os logs do servidor para mais detalhes.',
                urgent: result.status === 'FAIL' && consec >= 3,
            });
        }
        // Ordenar: FAIL urgente primeiro, depois FAIL, depois WARN
        return recs.sort((a, b) => {
            if (a.urgent && !b.urgent) return -1;
            if (!a.urgent && b.urgent) return 1;
            if (a.status === 'FAIL' && b.status !== 'FAIL') return -1;
            if (a.status !== 'FAIL' && b.status === 'FAIL') return 1;
            return 0;
        });
    }

    // ==========================================
    // HELPERS E GETTERS
    // ==========================================

    makeRequest(path: string, timeout = 5000): Promise<SentinelHttpResult> {
        return new Promise<SentinelHttpResult>((resolve, reject) => {
            // Usa 127.0.0.1 explícito — em alguns ambientes (Cloud Run, systemd-resolved)
            // 'localhost' resolve para ::1 (IPv6) mas o Express escuta em 0.0.0.0 (IPv4).
            const port = parseInt(process.env.PORT || '', 10) || 8080;
            const options = { hostname: '127.0.0.1', port, path, method: 'GET', timeout };

            let settled = false;
            const settle = <T>(fn: (value: T) => void, val: T) => {
                if (settled) return;
                settled = true;
                fn(val);
            };

            const req = http.request(options, (res) => {
                // Consome o corpo sem acumular — sentinel só precisa do statusCode
                res.on('data', () => {});
                res.on('end', () => settle(resolve, { statusCode: res.statusCode, headers: res.headers }));
                res.on('error', err => settle(reject, err));
            });
            req.on('error', err => settle(reject, err));
            req.on('timeout', () => {
                // Rejeita primeiro, depois destrói — destroy dispara 'error' (ECONNRESET)
                // que o flag `settled` ignora silenciosamente.
                settle(reject, new Error('Request timeout'));
                req.destroy();
            });
            req.end();
        });
    }

    calculateHealthScore(tests: Record<string, SentinelTestResult>): number {
        const total  = Object.keys(tests).length;
        if (total === 0) return 0;
        const passed = Object.values(tests).filter(t => t.status === 'PASS').length;
        return Math.round((passed / total) * 100);
    }

    getStatus() {
        const allSamples = Object.values(this.responseTimeSamples).flat();
        const avgResponseTime = allSamples.length
            ? Math.round(allSamples.reduce((a, b) => a + b, 0) / allSamples.length)
            : null;
        return {
            ...this.status,
            lastCheck:           this.lastCheck,
            uptime:              this.getUptime(),
            consecutiveFailures: { ...this.consecutiveFailures },
            avgResponseTime,
        };
    }

    getHistory(limit = 10) {
        return this.testResults.slice(-limit).reverse();
    }

    /**
     * Retorna série temporal de scores para sparkline (ordem cronológica)
     */
    getHistoryScores(limit = 20) {
        return this.testResults.slice(-limit).map(r => ({
            ts: r.timestamp,
            score: r.healthScore,
            isHealthy: r.isHealthy
        }));
    }

    getUptime() {
        if (this.testResults.length === 0) return 100;
        const healthy = this.testResults.filter(r => r.isHealthy).length;
        return Math.round((healthy / this.testResults.length) * 100);
    }
}

module.exports = new SentinelWorker();
export type { SentinelWorker };
