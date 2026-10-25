/**
 * Captura silenciosa de erros do processo. O espelho CommonJS continua
 * exportando a instância singleton para os consumidores Node existentes.
 */
export interface ErrorLogEntry {
    ts: string;
    level: string;
    source: string;
    message: string;
    stack: string | null;
}
export interface ErrorLogStats {
    total: number;
    byLevel: Record<string, number>;
    bySource: Record<string, number>;
    oldest: string | null;
    newest: string | null;
    capturedSince: string | null;
}
interface ErrorLogConsole {
    error(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    log(...args: unknown[]): void;
}
interface ErrorLogProcess {
    on(event: 'uncaughtException', callback: (error: Error) => void): void;
    on(event: 'unhandledRejection', callback: (reason: unknown) => void): void;
}
interface IntervalHandle { unref(): void }
declare const console: ErrorLogConsole;
declare const process: ErrorLogProcess;
declare function setInterval(callback: () => void, delay: number): IntervalHandle;
declare const module: { exports: ErrorLogWorker };

// Captura silenciosa de erros em runtime — console.error, console.warn,
// uncaughtException e unhandledRejection de todos os módulos do processo.
// Mantém janela rolante de 24 horas com no máximo MAX_ENTRIES registros.

const MAX_AGE_MS  = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 5000;

// Padrões para suprimir ruído que não é bug real
const NOISE_PATTERNS: RegExp[] = [
    /^\[SESSION\] Erro ao (ler|salvar) sessão/,
    /^Listening on/i,
    /^Sentinel Check —/,
    /Warning: Setting the NODE_TLS/i,
];

class ErrorLogWorker {
    logs: ErrorLogEntry[];
    started: boolean;
    _origError: ((...args: unknown[]) => void) | null;
    _origWarn: ((...args: unknown[]) => void) | null;

    constructor() {
        this.logs    = [];
        this.started = false;
        this._origError = null;
        this._origWarn  = null;
    }

    start(): void {
        if (this.started) return;
        this.started = true;

        this._origError = console.error.bind(console);
        this._origWarn  = console.warn.bind(console);

        // Intercepta console.error
        console.error = (...args: unknown[]) => {
            this._capture('error', args);
            this._origError!(...args);
        };

        // Intercepta console.warn
        console.warn = (...args: unknown[]) => {
            this._capture('warn', args);
            this._origWarn!(...args);
        };

        // Exceções não capturadas
        process.on('uncaughtException', (err) => {
            this._capture('uncaughtException', [err.message, err.stack || '']);
        });

        // Promises rejeitadas sem handler
        process.on('unhandledRejection', (reason) => {
            if (reason instanceof Error) {
                this._capture('unhandledRejection', [reason.message, reason.stack || '']);
            } else {
                this._capture('unhandledRejection', [String(reason)]);
            }
        });

        // Podas horárias para não vazar memória
        setInterval(() => this._prune(), 60 * 60 * 1000).unref();

        console.log('[ERROR-LOG] Worker de captura de erros iniciado.');
    }

    _serialize(arg: unknown): string {
        if (arg instanceof Error)   return arg.stack || arg.message;
        if (typeof arg === 'object' && arg !== null) {
            try { return JSON.stringify(arg); } catch (_) { return String(arg); }
        }
        return String(arg ?? '');
    }

    _capture(level: string, args: unknown[]): void {
        const message = args.map(a => this._serialize(a)).join(' ').trim();
        if (!message) return;

        // Suprime ruído operacional (logs normais do servidor)
        if (NOISE_PATTERNS.some(re => re.test(message))) return;

        // Extrai tag de origem do padrão [TAG] (ex: [COMPILER], [GEMINI])
        const tagMatch = message.match(/^\[([A-Z0-9_\-]+)\]/);
        const source   = tagMatch ? tagMatch[1] : 'SERVER';

        // Extrai stack trace se houver (separado do message principal)
        const lines = message.split('\n');
        const stack = lines.length > 1 ? lines.slice(1).join('\n').trim() : null;

        this.logs.push({
            ts:      new Date().toISOString(),
            level,
            source,
            message: lines[0].substring(0, 1000),
            stack:   stack ? stack.substring(0, 2000) : null,
        });

        if (this.logs.length > MAX_ENTRIES) this.logs.shift();
    }

    _prune(): void {
        const cutoff = Date.now() - MAX_AGE_MS;
        this.logs = this.logs.filter(e => new Date(e.ts).getTime() >= cutoff);
    }

    // Retorna todos os logs nas últimas 24h (ou desde `since` em ms epoch)
    getLogs(since?: number): ErrorLogEntry[] {
        const cutoff = since !== undefined ? since : (Date.now() - MAX_AGE_MS);
        return this.logs.filter(e => new Date(e.ts).getTime() >= cutoff);
    }

    getStats(): ErrorLogStats {
        const { stats } = this.getLogsAndStats();
        return stats;
    }

    // Retorna stats + logs em uma única iteração — evita iterar o array duas vezes
    getLogsAndStats(since?: number): { stats: ErrorLogStats; logs: ErrorLogEntry[] } {
        const cutoff  = since !== undefined ? since : (Date.now() - MAX_AGE_MS);
        const entries = this.logs.filter(e => new Date(e.ts).getTime() >= cutoff);
        const byLevel: Record<string, number> = {};
        const bySource: Record<string, number> = {};

        for (const e of entries) {
            byLevel[e.level]   = (byLevel[e.level]   || 0) + 1;
            bySource[e.source] = (bySource[e.source] || 0) + 1;
        }

        const stats = {
            total:   entries.length,
            byLevel,
            bySource,
            oldest:  entries.length ? entries[0].ts                  : null,
            newest:  entries.length ? entries[entries.length - 1].ts : null,
            capturedSince: this.started ? new Date(Date.now() - MAX_AGE_MS).toISOString() : null,
        };

        return { stats, logs: entries };
    }
}

module.exports = new ErrorLogWorker();
