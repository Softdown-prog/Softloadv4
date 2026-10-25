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

const { bucket, db } = require('./firebase');
const { reservarCota, reconciliarCotaArquivos } = require('./storageService');
const { createHash, randomUUID } = require('node:crypto');

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


async function readGcsSized(filePath) {
    try {
        const [bytes] = await bucket.file(filePath).download();
        return { value: JSON.parse(bytes.toString('utf8')), bytes: bytes.length };
    } catch (err) {
        if (err.code === 404 || err.message?.includes('No such object')) {
            return { value: null, bytes: 0 };
        }
        throw err;
    }
}

async function writeGcsVerified(filePath, data) {
    const content = JSON.stringify(data);
    try {
        await bucket.file(filePath).save(content, {
            metadata: { contentType: 'application/json; charset=utf-8' }
        });
    } catch (error) {
        // A GCS upload can complete and lose its acknowledgement.
        // Verify the exact bytes before declaring an otherwise committed write failed.
        try {
            const [actual] = await bucket.file(filePath).download();
            if (actual.toString('utf8') === content) return;
        } catch (readError) {
            console.error('[CHAT-STORAGE] gravação incerta; exige reconciliação:', filePath, readError);
        }
        throw error;
    }
}

function lockId(uid, scope) {
    if (typeof uid !== 'string' || !uid || typeof scope !== 'string' || !scope) {
        throw new TypeError('Identidade de armazenamento inválida.');
    }
    return createHash('sha256').update(JSON.stringify([uid, scope])).digest('hex');
}

/**
 * Firestore create() serializes writers across VPS replicas. Do not clear a
 * lock by age: a slow worker can still be updating shared index/latest files.
 */
async function withChatLock(uid, scope, callback) {
    const ref = db.collection('chat_storage_bloqueios').doc(lockId(uid, scope));
    const owner = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < 12; attempt++) {
        try {
            await ref.create({ uid, scope, owner, iniciadoEm: new Date().toISOString() });
            acquired = true;
            break;
        } catch (error) {
            if (![6, 409, 'ALREADY_EXISTS'].includes(error.code)) throw error;
            if (attempt === 11) {
                const busy = new Error('O histórico de chat está ocupado. Tente novamente.');
                busy.code = 'CHAT_STORAGE_BUSY';
                busy.status = 409;
                throw busy;
            }
            await new Promise(resolve => setTimeout(resolve, Math.min(50 * (attempt + 1), 400)));
        }
    }
    if (!acquired) throw new Error('Não foi possível adquirir o bloqueio de chat.');
    try {
        return await callback();
    } finally {
        try {
            const snap = await ref.get();
            if (snap.exists && snap.data()?.owner === owner) {
                if (!snap.updateTime) throw new Error('Sem precondição de versão para liberar bloqueio.');
                await ref.delete({ lastUpdateTime: snap.updateTime });
            }
        } catch (error) {
            // A stale lock blocks future writes instead of risking concurrent loss.
            console.error('[CHAT-STORAGE] falha ao liberar bloqueio:', error);
        }
    }
}

async function verifyWrites(entries) {
    // Wait for every write to settle before releasing the cross-process lock.
    const results = await Promise.allSettled(entries.map(item => writeGcsVerified(item.path, item.value)));
    const failed = results.find(item => item.status === 'rejected');
    if (failed) throw failed.reason;
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
    const run = async () => {
        const now = new Date().toISOString();
        const session = { sessionId, uid, type, updatedAt: now, messages, tokens, meta };
        const idxFile = indexPath(uid, type);
        const sessionFile = sessionPath(uid, type, sessionId);
        const latestFile = latestRefPath(uid, type);

        // Read the GCS objects under the same distributed lock that protects writes.
        const current = cota ? await Promise.all([
            readGcsSized(sessionFile), readGcsSized(latestFile), readGcsSized(idxFile)
        ]) : null;
        const existing = (current ? current[2].value : await readGcs(idxFile)) || [];
        const entry = {
            sessionId,
            firstMessage: messages[0]?.content?.slice(0, 80) || '',
            updatedAt: now,
            messageCount: messages.length,
        };
        const filtered = existing.filter(item => item.sessionId !== sessionId);
        const newIndex = [entry, ...filtered];
        const latestRefPayload = { sessionId, updatedAt: now };
        const entries = [
            { path: sessionFile, value: session },
            { path: latestFile, value: latestRefPayload },
            { path: idxFile, value: newIndex },
        ];

        if (cota) {
            const changes = entries.map((item, i) => ({
                path: item.path, bytesAntes: current[i].bytes, bytesDepois: _tamanhoJson(item.value)
            }));
            const increase = Math.max(0, changes.reduce((n, item) =>
                n + item.bytesDepois - item.bytesAntes, 0));
            // Preflight before GCS writes; the authoritative check runs in Firestore.
            if (increase) await reservarCota(cota.email, cota.plano, increase);
            await verifyWrites(entries);
            await reconciliarCotaArquivos(cota.email, cota.plano, uid, changes);
        } else {
            await verifyWrites(entries);
        }
        return session;
    };
    return cota ? withChatLock(uid, `sessions:${type}`, run) : run();
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
    const run = async () => {
        const location = memoryPath(uid);
        const previous = cota ? await readGcsSized(location) : null;
        const existing = (previous ? previous.value : await readGcs(location)) || {};
        // Accept an internal updater to compute cumulative counters under lock.
        const changes = typeof patch === 'function' ? patch(existing) : patch;
        const updated = { ...existing, ...changes, uid, updatedAt: new Date().toISOString() };
        if (cota) {
            const bytesDepois = _tamanhoJson(updated);
            const increase = Math.max(0, bytesDepois - previous.bytes);
            if (increase) await reservarCota(cota.email, cota.plano, increase);
            await writeGcsVerified(location, updated);
            await reconciliarCotaArquivos(cota.email, cota.plano, uid, [
                { path: location, bytesAntes: previous.bytes, bytesDepois }
            ]);
        } else {
            await writeGcs(location, updated);
        }
        return updated;
    };
    return cota ? withChatLock(uid, 'memory', run) : run();
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
    // The updater executes inside saveMemory's distributed lock, so concurrent
    // completed sessions cannot overwrite each other's cumulative counters.
    return saveMemory(uid, existing => {
        const patch = {
            totalTokensUsed: (existing.totalTokensUsed || 0) + (session.tokens?.total || 0),
            sessionCount: (existing.sessionCount || 0) + 1,
            lastSessionAt: session.updatedAt,
            lastSessionType: session.type,
        };
        if (session.meta?.commandJson) {
            const cmd = session.meta.commandJson;
            patch.lastTemplate = {
                siteName: cmd.siteName || null,
                colorPreset: cmd.colorPreset || null,
                gridLayout: cmd.gridLayout || null,
                heroSection: cmd.heroSection || null,
                ts: session.updatedAt,
            };
        }
        return patch;
    }, cota);
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
