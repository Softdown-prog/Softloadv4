"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extrairZipViaSandbox = extrairZipViaSandbox;
// ============================================================
// ARCHIVE EXTRACT CLIENT — cliente HTTP fino pro serviço isolado
// sandbox-efemoro/ (POST /extract-zip). Mesmo papel que
// agent/src/capabilities/archive.js já cumpre pro agent — este módulo é
// o EQUIVALENTE pro app principal, usado por
// routes/dashboard_routes/solaris.js (rota /dashboard/solaris/upload)
// em vez de extrairZip() (fileTools.js), que fazia a extração do ZIP
// não-confiável enviado pelo usuário DENTRO do processo do app
// principal. Mesmas env vars do agent (SANDBOX_SERVICE_URL,
// SANDBOX_SHARED_SECRET) — uma única configuração no Cloud Run serve
// os dois chamadores.
//
// Mesmo contrato de falha do agent: uma resposta HTTP não-ok é falha de
// INFRAESTRUTURA (vira exceção); uma extração RECUSADA
// (`success:false` dentro de um 200 normal — zip malicioso, corrompido,
// acima dos limites) também vira exceção — não existe resultado parcial
// útil (nada foi extraído), então não há motivo pra exigir do chamador
// um `if (!result.success)` extra.
// ============================================================
/** Extrai `zipBuffer` via sandbox-efemoro/, devolve { arquivos, totalArquivos }
 *  — `arquivos` é o array bruto do serviço: [{ caminho, conteudo, binario }].
 *  Lança em qualquer falha (config ausente, infra, extração recusada). */
async function extrairZipViaSandbox(zipBuffer, opts = {}) {
    if (!Buffer.isBuffer(zipBuffer) || zipBuffer.length === 0) {
        throw new Error('[ARCHIVE-EXTRACT-CLIENT] extrairZipViaSandbox: zipBuffer vazio ou inválido.');
    }
    const serviceUrl = process.env.SANDBOX_SERVICE_URL;
    if (!serviceUrl) {
        throw new Error('[ARCHIVE-EXTRACT-CLIENT] SANDBOX_SERVICE_URL não configurada no ambiente — defina a URL do serviço Cloud Run sandbox-efemoro/.');
    }
    const headers = { 'Content-Type': 'application/octet-stream' };
    const secret = process.env.SANDBOX_SHARED_SECRET;
    if (secret) {
        headers['x-sandbox-secret'] = secret;
    }
    // Só repassa os limites que vieram definidos, deixando o serviço
    // aplicar seus próprios defaults pro resto (mesmo padrão de
    // ArchiveCapability.extractZip no agent).
    const params = new URLSearchParams();
    const limitFields = ['maxFiles', 'maxFileBytes', 'maxTotalBytes', 'maxCompressedBytes', 'maxDepth', 'timeoutMs'];
    for (const field of limitFields) {
        if (opts[field] !== undefined) {
            params.set(field, String(opts[field]));
        }
    }
    const query = params.toString();
    const url = `${serviceUrl.replace(/\/+$/, '')}/extract-zip${query ? `?${query}` : ''}`;
    const response = await fetch(url, { method: 'POST', headers, body: zipBuffer });
    if (!response.ok) {
        const errorBody = (await response.json().catch(() => ({})));
        throw new Error(`[ARCHIVE-EXTRACT-CLIENT] sandbox-efemoro respondeu ${response.status}: ${errorBody.error || errorBody.message || 'erro desconhecido'}`);
    }
    const result = (await response.json());
    if (!result.success) {
        throw new Error(`[ARCHIVE-EXTRACT-CLIENT] extração recusada — ${result.errors?.[0]?.message || 'motivo desconhecido'}`);
    }
    return { arquivos: result.arquivos || [], totalArquivos: result.totalArquivos || 0 };
}
