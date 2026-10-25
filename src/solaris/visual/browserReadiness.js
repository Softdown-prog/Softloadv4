"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.browserSandboxReady = browserSandboxReady;
/**
 * Verifica se o endpoint HTTP configurado possui um Chromium real, sem
 * navegar num domínio externo, iniciar browser nem consumir Gemini.
 * Falha fechado quando sandbox antigo, offline ou archive-only.
 */
async function browserSandboxReady(serviceUrl, fetcher = fetch) {
    if (!serviceUrl || typeof serviceUrl !== 'string')
        return false;
    let url;
    try {
        url = new URL(serviceUrl.replace(/\/+$/, '') + '/health');
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password)
            return false;
    }
    catch {
        return false;
    }
    try {
        const response = await fetcher(url.toString(), {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(2500),
            redirect: 'error',
        });
        if (!response.ok)
            return false;
        const raw = await response.text();
        if (raw.length > 2048)
            return false;
        const health = JSON.parse(raw);
        return health?.status === 'ok' && health?.capabilities?.browser === true;
    }
    catch {
        return false;
    }
}
