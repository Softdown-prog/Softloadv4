"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarMensagemSolaris = validarMensagemSolaris;
exports.validarSessaoSolaris = validarSessaoSolaris;
exports.sanitizarHistoricoSolaris = sanitizarHistoricoSolaris;
exports.historicoParaMotorSolaris = historicoParaMotorSolaris;
exports.serializarEventoSseSolaris = serializarEventoSseSolaris;
const LIMITE_MENSAGEM = 2000;
const LIMITE_HISTORICO = 10;
// Compatível com os IDs gerados pelo chatStorage (timestamp + _ + sufixo)
// e IDs UUID/base64url já usados em outros clientes. Nunca permite path separators.
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,128}$/;
function validarMensagemSolaris(value) {
    if (typeof value !== 'string' || !value.trim()) {
        return { ok: false, erro: 'Mensagem não pode estar vazia.' };
    }
    const mensagem = value.trim();
    if (mensagem.length > LIMITE_MENSAGEM) {
        return { ok: false, erro: 'Mensagem muito longa. Máximo 2000 caracteres.' };
    }
    return { ok: true, mensagem };
}
function validarSessaoSolaris(value) {
    if (value === null || value === undefined || value === '') {
        return { ok: true, sessionId: null };
    }
    if (typeof value !== 'string' || !SESSION_ID_PATTERN.test(value)) {
        return { ok: false, erro: 'Identificador de sessão inválido.' };
    }
    return { ok: true, sessionId: value };
}
function sanitizarHistoricoSolaris(value) {
    if (!Array.isArray(value))
        return [];
    return value.filter((item) => (item !== null
        && typeof item === 'object'
        && typeof item.content === 'string'
        && (item.role === 'user' || item.role === 'assistant'))).slice(-LIMITE_HISTORICO);
}
function historicoParaMotorSolaris(historico) {
    return historico.map(h => ({
        autor: h.role === 'user' ? 'usuario' : 'solaris',
        texto: h.content,
    }));
}
function serializarEventoSseSolaris(event) {
    // O protocolo usa apenas linhas "data:"; JSON.stringify escapa novas linhas
    // dentro do conteúdo, impedindo que texto do modelo injete eventos SSE.
    return `data: ${JSON.stringify(event)}\n\n`;
}
