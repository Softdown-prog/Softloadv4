'use strict';

// ============================================================
// CHAT STORAGE SERVICE — Sessões de chat e memória no GCS
// ============================================================
// Persiste conversas e contexto do usuário no Google Cloud Storage.
//
// Estrutura de paths:
//   users/{uid}/sessions/{type}/{sessionId}.json  ← conversa completa
//   users/{uid}/sessions/{type}/latest.json       ← referência à sessão atual
//   users/{uid}/memory/context.json               ← memória persistente
//
// Tipos de sessão:
//   'chat-suporte'    → Especialista Blogger (/dashboard/chat)
//   'workspace-chat'  → Chat do Workspace (/dashboard/workspace/chat)
//   'sol'             → Sol, assistente interno (/eu/sol)
//   'solaris-chat'    → Solaris Code (/dashboard/solaris)
//
// Estratégia de escrita:
//   Todas as operações são fire-and-forget nos routes.
//   Erros são logados mas não interrompem o fluxo do usuário.
//
// Cota de armazenamento (parâmetro `cota` opcional em saveSession/
// saveMemory/updateMemoryFromSession, `{ email, plano }`): estas gravações
// no GCS ficavam fora da cota do plano até aqui — gap real, já em produção,
// não hipotético (achado numa auditoria de storage desta sessão). Reusa o
// mesmo `reservarCota`/`storage_usado_mb` que `compilerPipeline.js` já usa
// pra compilações — regra do projeto é UM pool de cota por usuário, nunca
// um contador paralelo por feature. `cota` é opcional (backward compatible
// pros chamadores que ainda não foram atualizados) — sem ele, a gravação
// segue exatamente como antes, sem contar pra cota nenhuma; TODOS os
// chamadores atuais (chat.js/workspaceChat.js/solaris.js/adminRoutes.js)
// já passam `cota` desde que este comentário foi escrito.
// ============================================================

const { bucket } = require('./firebase');
const { reservarCota } = require('./storageService');

function _tamanhoJson(obj) {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

// ── Paths ─────────────────────────────────────────────────────────────────

function sessionPath(uid, type, sessionId) {
    return `users/${uid}/sessions/${type}/${sessionId}.json`;
}

function latestRefPath(uid, type) {
    return `users/${uid}/sessions/${type}/latest.json`;
}

function memoryPath(uid) {
    return `users/${uid}/memory/context.json`;
}

function indexPath(uid, type) {
    return `users/${uid}/sessions/${type}/_index.json`;
}

// ── Helpers ───────────────────────────────────────────────────────────────

function newSessionId() {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function readGcs(filePath) {
    try {
        const [content] = await bucket.file(filePath).download();
        return JSON.parse(content.toString('utf8'));
    } catch (err) {
        // 404 = arquivo ainda não existe (comportamento normal na 1ª vez)
        const is404 = err.code === 404 || err.message?.includes('No such object');
        if (is404) return null;
        throw err;
    }
}

async function writeGcs(filePath, data) {
    await bucket.file(filePath).save(
        JSON.stringify(data),
        { metadata: { contentType: 'application/json; charset=utf-8' } }
    );
}

// ── Sessões ───────────────────────────────────────────────────────────────

/**
 * Salva uma sessão de chat e atualiza o ponteiro latest.
 *
 * @param {string}   uid
 * @param {string}   type        string livre (ex: 'chat-suporte', 'workspace-chat', 'sol')
 * @param {string}   sessionId
 * @param {object}   payload
 * @param {Array}    payload.messages  [{role, content, ts}]
 * @param {object}   payload.tokens    {total, input, output}
 * @param {object}   payload.meta      {commandJson?, templateGenerated?}
 * @param {object}   [cota]      {email, plano} — opcional, ver comentário de topo.
 */
async function saveSession(uid, type, sessionId, { messages, tokens, meta = {} }, cota = null) {
    const now = new Date().toISOString();
    const session = { sessionId, uid, type, updatedAt: now, messages, tokens, meta };

    // Atualiza o índice de sessões
    const idxFile = indexPath(uid, type);
    const existing = await readGcs(idxFile) || [];
    const entry = {
        sessionId,
        firstMessage: messages[0]?.content?.slice(0, 80) || '',
        updatedAt: now,
        messageCount: messages.length,
    };
    const filtered = existing.filter(e => e.sessionId !== sessionId);
    const newIndex = [entry, ...filtered];
    const latestRefPayload = { sessionId, updatedAt: now };

    // Reserva cota ANTES de gravar (mesmo tamanho serve de estimativa E de
    // real — ao contrário do ZIP de compilação, JSON não é comprimido, o
    // byte count é exato de antemão) — lança e NÃO grava nada se estourar.
    let confirmarUsoDaSessao = async () => {};
    if (cota) {
        const tamanhoBytes = _tamanhoJson(session) + _tamanhoJson(latestRefPayload) + _tamanhoJson(newIndex);
        const { confirmarUso } = await reservarCota(cota.email, cota.plano, tamanhoBytes);
        confirmarUsoDaSessao = () => confirmarUso(tamanhoBytes);
    }

    // Sessão + ponteiro latest + índice em paralelo
    await Promise.all([
        writeGcs(sessionPath(uid, type, sessionId), session),
        writeGcs(latestRefPath(uid, type), latestRefPayload),
        writeGcs(idxFile, newIndex),
    ]);

    await confirmarUsoDaSessao();

    return session;
}

/**
 * Carrega uma sessão específica.
 */
async function loadSession(uid, type, sessionId) {
    return readGcs(sessionPath(uid, type, sessionId));
}

/**
 * Lista todas as sessões do usuário para um dado tipo.
 * Lê o índice em _index.json e retorna array ordenado por updatedAt desc.
 * Retorna [] se não há índice ainda.
 *
 * @param {string} uid
 * @param {string} type  string livre (ex: 'chat-suporte', 'workspace-chat', 'sol')
 * @returns {Promise<Array<{sessionId, firstMessage, updatedAt, messageCount}>>}
 */
async function listSessions(uid, type) {
    const index = await readGcs(indexPath(uid, type));
    if (!Array.isArray(index)) return [];
    return index.slice().sort((a, b) => {
        if (a.updatedAt > b.updatedAt) return -1;
        if (a.updatedAt < b.updatedAt) return 1;
        return 0;
    });
}

/**
 * Remove uma sessão do GCS e actualiza o índice.
 * Se a sessão removida era a latest, apaga também o latest.json.
 *
 * @param {string} uid
 * @param {string} type
 * @param {string} sessionId
 */
async function deleteSession(uid, type, sessionId) {
    const [index, latestRef] = await Promise.all([
        readGcs(indexPath(uid, type)),
        readGcs(latestRefPath(uid, type)),
    ]);

    const ops = [
        bucket.file(sessionPath(uid, type, sessionId)).delete({ ignoreNotFound: true }),
    ];

    // Actualiza o índice removendo a entrada
    const newIndex = Array.isArray(index)
        ? index.filter(e => e.sessionId !== sessionId)
        : [];
    ops.push(writeGcs(indexPath(uid, type), newIndex));

    // Remove latest.json se apontava para a sessão deletada
    if (latestRef?.sessionId === sessionId) {
        ops.push(bucket.file(latestRefPath(uid, type)).delete({ ignoreNotFound: true }));
    }

    await Promise.all(ops);
}

// ── Memória persistente ───────────────────────────────────────────────────

/**
 * Carrega a memória de contexto do usuário.
 * Retorna null se ainda não existe.
 */
async function loadMemory(uid) {
    return readGcs(memoryPath(uid));
}

/**
 * Salva (merge) dados na memória do usuário.
 * Faz merge com o estado existente — não substitui campos não enviados.
 *
 * @param {string} uid
 * @param {object} patch
 * @param {object} [cota]  {email, plano} — opcional, ver comentário de topo do arquivo.
 */
async function saveMemory(uid, patch, cota = null) {
    const existing = await readGcs(memoryPath(uid)) || {};
    const updated  = { ...existing, ...patch, uid, updatedAt: new Date().toISOString() };

    if (cota) {
        const tamanhoBytes = _tamanhoJson(updated);
        const { confirmarUso } = await reservarCota(cota.email, cota.plano, tamanhoBytes);
        await writeGcs(memoryPath(uid), updated);
        await confirmarUso(tamanhoBytes);
    } else {
        await writeGcs(memoryPath(uid), updated);
    }

    return updated;
}

/**
 * Atualiza a memória a partir de uma sessão finalizada.
 * Chamado depois de saveSession — acumula totais e captura preferências.
 *
 * @param {string} uid
 * @param {object} session  Objeto retornado por saveSession
 * @param {object} [cota]   {email, plano} — opcional, repassado pra saveMemory.
 */
async function updateMemoryFromSession(uid, session, cota = null) {
    const existing = await readGcs(memoryPath(uid)) || {};

    const patch = {
        // Acumula tokens de todas as sessões (lifetime)
        totalTokensUsed: (existing.totalTokensUsed || 0) + (session.tokens?.total || 0),
        sessionCount:    (existing.sessionCount    || 0) + 1,
        lastSessionAt:   session.updatedAt,
        lastSessionType: session.type,
    };

    // Se a sessão gerou um template, salva as preferências para reusar em futuras sessões
    if (session.meta?.commandJson) {
        const cmd = session.meta.commandJson;
        patch.lastTemplate = {
            siteName:    cmd.siteName    || null,
            colorPreset: cmd.colorPreset || null,
            gridLayout:  cmd.gridLayout  || null,
            heroSection: cmd.heroSection || null,
            ts:          session.updatedAt,
        };
    }

    return saveMemory(uid, patch, cota);
}

/**
 * Formata a memória do usuário como texto injetável no system prompt.
 * Retorna string vazia se não há memória relevante.
 *
 * @param {object|null} memory
 * @returns {string}
 */
function formatMemoryForPrompt(memory) {
    if (!memory) return '';

    const lines = [];

    if (memory.lastTemplate) {
        const t = memory.lastTemplate;
        lines.push(`- Último template gerado: "${t.siteName || 'sem nome'}" | cor: ${t.colorPreset || '?'} | grid: ${t.gridLayout || '?'}`);
    }
    if (memory.sessionCount > 1) {
        lines.push(`- Sessões anteriores: ${memory.sessionCount - 1}`);
    }
    if (memory.totalTokensUsed > 0) {
        const k = (memory.totalTokensUsed / 1000).toFixed(1);
        lines.push(`- Total de tokens utilizados (lifetime): ${k}K`);
    }

    if (lines.length === 0) return '';

    return '\n\n## CONTEXTO DO USUÁRIO (histórico)\n' + lines.join('\n');
}

module.exports = {
    newSessionId,
    saveSession,
    loadSession,
    listSessions,
    deleteSession,
    loadMemory,
    saveMemory,
    updateMemoryFromSession,
    formatMemoryForPrompt,
};
