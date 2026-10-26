import type { Bucket } from '@google-cloud/storage';
import type { Firestore } from 'firebase-admin/firestore';
export interface ChatStorageQuota { email: string; plano: string }
export interface ChatStoredTokens { total?: number; input?: number; output?: number }
export interface ChatStoredMessage { role?: string; content?: string; ts?: string | number; [key: string]: unknown }
export interface ChatSessionMeta { commandJson?: { siteName?: string | null; colorPreset?: string | null; gridLayout?: string | null; heroSection?: string | null }; templateGenerated?: boolean; [key: string]: unknown }
export interface ChatSessionPayload { messages: ChatStoredMessage[]; tokens?: ChatStoredTokens; meta?: ChatSessionMeta }
export interface ChatStoredSession extends ChatSessionPayload { sessionId: string; uid: string; type: string; updatedAt: string; meta: ChatSessionMeta }
export interface ChatSessionIndexEntry { sessionId: string; firstMessage: string; updatedAt: string; messageCount: number }
export interface ChatLastTemplate { siteName: string | null; colorPreset: string | null; gridLayout: string | null; heroSection: string | null; ts: string }
export interface ChatMemory {
    uid?: string; updatedAt?: string; totalTokensUsed?: number; sessionCount?: number;
    lastSessionAt?: string; lastSessionType?: string; lastTemplate?: ChatLastTemplate;
    [key: string]: unknown;
}
export type ChatMemoryPatch = Partial<ChatMemory> | ((existing: ChatMemory) => Partial<ChatMemory>);
interface StorageFailure { code?: number | string; message?: string }
type SizedObject<T> = { value: T | null; bytes: number };

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

const { bucket, db } = require('./firebase') as { bucket: Bucket; db: Firestore };
const { reservarCota, reconciliarCotaArquivos } = require('./storageService') as typeof import('./storageService');
const { createHash, randomUUID } = require('node:crypto') as typeof import('node:crypto');

function _tamanhoJson(obj: unknown): number {
    return Buffer.byteLength(JSON.stringify(obj), 'utf8');
}

// ── Paths ─────────────────────────────────────────────────────────────────

function assertGcsSegment(value: unknown, label: string): asserts value is string {
    // GCS keys are strings, not filesystem paths. Never let user-controlled
    // session IDs impersonate the metadata objects in this same prefix.
    if (typeof value !== 'string' || value.length === 0 ||
        value === '.' || value === '..' ||
        value.includes('/') || value.includes('\\') ||
        /[\x00-\x1f\x7f]/.test(value)) {
        throw new TypeError(`Identificador de armazenamento inválido: ${label}`);
    }
}

function sessionPath(uid: string, type: string, sessionId: string): string {
    assertGcsSegment(uid, 'uid');
    assertGcsSegment(type, 'type');
    assertGcsSegment(sessionId, 'sessionId');
    if (sessionId === 'latest' || sessionId === '_index') {
        throw new TypeError('Identificador de sessão reservado pelo armazenamento.');
    }
    return `users/${uid}/sessions/${type}/${sessionId}.json`;
}

function latestRefPath(uid: string, type: string): string {
    assertGcsSegment(uid, 'uid');
    assertGcsSegment(type, 'type');
    return `users/${uid}/sessions/${type}/latest.json`;
}

function memoryPath(uid: string): string {
    assertGcsSegment(uid, 'uid');
    return `users/${uid}/memory/context.json`;
}

function indexPath(uid: string, type: string): string {
    assertGcsSegment(uid, 'uid');
    assertGcsSegment(type, 'type');
    return `users/${uid}/sessions/${type}/_index.json`;
}

// ── Helpers ───────────────────────────────────────────────────────────────

export function newSessionId(): string {
    return `${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

async function readGcs<T>(filePath: string): Promise<T | null> {
    try {
        const [content] = await bucket.file(filePath).download();
        return JSON.parse(content.toString('utf8'));
    } catch (err) {
        // 404 = arquivo ainda não existe (comportamento normal na 1ª vez)
        const is404 = (err as StorageFailure).code === 404 || (err as StorageFailure).message?.includes('No such object');
        if (is404) return null;
        throw err;
    }
}

async function writeGcs(filePath: string, data: unknown): Promise<void> {
    await bucket.file(filePath).save(
        JSON.stringify(data),
        { metadata: { contentType: 'application/json; charset=utf-8' } }
    );
}


async function readGcsSized<T>(filePath: string): Promise<SizedObject<T>> {
    try {
        const [bytes] = await bucket.file(filePath).download();
        return { value: JSON.parse(bytes.toString('utf8')), bytes: bytes.length };
    } catch (err) {
        if ((err as StorageFailure).code === 404 || (err as StorageFailure).message?.includes('No such object')) {
            return { value: null, bytes: 0 };
        }
        throw err;
    }
}

async function writeGcsVerified(filePath: string, data: unknown): Promise<void> {
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

function lockId(uid: string, scope: string): string {
    if (typeof uid !== 'string' || !uid || typeof scope !== 'string' || !scope) {
        throw new TypeError('Identidade de armazenamento inválida.');
    }
    return createHash('sha256').update(JSON.stringify([uid, scope])).digest('hex');
}

/**
 * Firestore create() serializes writers across VPS replicas. Do not clear a
 * lock by age: a slow worker can still be updating shared index/latest files.
 */
async function withChatLock<T>(uid: string, scope: string, callback: () => Promise<T>): Promise<T> {
    const ref = db.collection('chat_storage_bloqueios').doc(lockId(uid, scope));
    const owner = randomUUID();
    let acquired = false;
    for (let attempt = 0; attempt < 12; attempt++) {
        try {
            await ref.create({ uid, scope, owner, iniciadoEm: new Date().toISOString() });
            acquired = true;
            break;
        } catch (error) {
            if (!([6, 409, 'ALREADY_EXISTS'] as (number | string | undefined)[]).includes((error as StorageFailure).code)) throw error;
            if (attempt === 11) {
                const busy = new Error('O histórico de chat está ocupado. Tente novamente.') as Error & { code: string; status: number };
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

/**
 * A DELETE may remove the GCS object and lose its acknowledgement.
 * A 404 on read-back confirms removal; other failures stay visible.
 */
async function deleteGcsVerified(filePath: string): Promise<void> {
    try {
        await bucket.file(filePath).delete({ ignoreNotFound: true });
    } catch (error) {
        try {
            await bucket.file(filePath).download();
        } catch (readError) {
            if ((readError as StorageFailure).code === 404 || (readError as StorageFailure).message?.includes('No such object')) return;
            console.error('[CHAT-STORAGE] exclusão incerta; exige reconciliação:', filePath, readError);
        }
        throw error;
    }
}

async function verifyWrites(entries: { path: string; value: unknown }[]): Promise<void> {
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
export async function saveSession(uid: string, type: string, sessionId: string, { messages, tokens, meta = {} }: ChatSessionPayload, cota: ChatStorageQuota | null = null): Promise<ChatStoredSession> {
    const run = async () => {
        const now = new Date().toISOString();
        const session: ChatStoredSession = { sessionId, uid, type, updatedAt: now, messages, tokens, meta };
        const idxFile = indexPath(uid, type);
        const sessionFile = sessionPath(uid, type, sessionId);
        const latestFile = latestRefPath(uid, type);

        // Read the GCS objects under the same distributed lock that protects writes.
        const current = cota ? await Promise.all([
            readGcsSized<ChatStoredSession>(sessionFile), readGcsSized<{ sessionId: string }>(latestFile), readGcsSized<ChatSessionIndexEntry[]>(idxFile)
        ]) : null;
        const existing = (current ? current[2].value : await readGcs<ChatSessionIndexEntry[]>(idxFile)) || [];
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
                path: item.path, bytesAntes: current![i].bytes, bytesDepois: _tamanhoJson(item.value)
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
export async function loadSession(uid: string, type: string, sessionId: string): Promise<ChatStoredSession | null> {
    return readGcs<ChatStoredSession>(sessionPath(uid, type, sessionId));
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
export async function listSessions(uid: string, type: string): Promise<ChatSessionIndexEntry[]> {
    const index = await readGcs<ChatSessionIndexEntry[]>(indexPath(uid, type));
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
export async function deleteSession(uid: string, type: string, sessionId: string, cota: ChatStorageQuota | null = null): Promise<void> {
    if (cota) {
        return withChatLock(uid, `sessions:${type}`, async () => {
            const sessionFile = sessionPath(uid, type, sessionId);
            const idxFile = indexPath(uid, type);
            const latestFile = latestRefPath(uid, type);
            const paths = [sessionFile, idxFile, latestFile];
            const before = await Promise.all(paths.map(path => readGcsSized<ChatSessionIndexEntry[] | { sessionId: string }>(path)));

            const existingIndex = before[1].value;
            const newIndex = Array.isArray(existingIndex)
                ? existingIndex.filter(item => item.sessionId !== sessionId)
                : [];
            const latestIsTarget = (before[2].value as { sessionId?: string } | null)?.sessionId === sessionId;
            const ops = [];

            // Do not fabricate index/latest objects when removing an already
            // absent session. The first deletion must be safe to retry.
            if (before[0].bytes) ops.push(deleteGcsVerified(sessionFile));
            if (Array.isArray(existingIndex) && newIndex.length !== existingIndex.length) {
                ops.push(writeGcsVerified(idxFile, newIndex));
            }
            if (latestIsTarget) ops.push(deleteGcsVerified(latestFile));

            // A failure in one operation must not leave another in flight when
            // the lock is released. Account for successfully changed objects
            // even when another deletion failed; retry handles the remainder.
            const results = await Promise.allSettled(ops);
            const after = await Promise.all(paths.map(path => readGcsSized<ChatSessionIndexEntry[] | { sessionId: string }>(path)));
            await reconciliarCotaArquivos(cota.email, cota.plano, uid,
                paths.map((path, i) => ({
                    path,
                    bytesAntes: before[i].bytes,
                    bytesDepois: after[i].bytes,
                })), { apenasCreditosRastreados: true });

            const failed = results.find(result => result.status === 'rejected');
            if (failed) throw failed.reason;
        });
    }

    // Legacy callers without cota retain the previous behaviour.
    const [index, latestRef] = await Promise.all([
        readGcs<ChatSessionIndexEntry[]>(indexPath(uid, type)),
        readGcs<{ sessionId: string }>(latestRefPath(uid, type)),
    ]);

    const ops: Promise<unknown>[] = [
        bucket.file(sessionPath(uid, type, sessionId)).delete({ ignoreNotFound: true }),
    ];
    const newIndex = Array.isArray(index)
        ? index.filter(entry => entry.sessionId !== sessionId)
        : [];
    ops.push(writeGcs(indexPath(uid, type), newIndex));
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
export async function loadMemory(uid: string): Promise<ChatMemory | null> {
    return readGcs<ChatMemory>(memoryPath(uid));
}

/**
 * Salva (merge) dados na memória do usuário.
 * Faz merge com o estado existente — não substitui campos não enviados.
 *
 * @param {string} uid
 * @param {object} patch
 * @param {object} [cota]  {email, plano} — opcional, ver comentário de topo do arquivo.
 */
export async function saveMemory(uid: string, patch: ChatMemoryPatch, cota: ChatStorageQuota | null = null): Promise<ChatMemory> {
    const run = async () => {
        const location = memoryPath(uid);
        const previous = cota ? await readGcsSized<ChatMemory>(location) : null;
        const existing = (previous ? previous.value : await readGcs<ChatMemory>(location)) || {};
        // Accept an internal updater to compute cumulative counters under lock.
        const changes = typeof patch === 'function' ? patch(existing) : patch;
        const updated = { ...existing, ...changes, uid, updatedAt: new Date().toISOString() };
        if (cota) {
            const bytesDepois = _tamanhoJson(updated);
            const increase = Math.max(0, bytesDepois - previous!.bytes);
            if (increase) await reservarCota(cota.email, cota.plano, increase);
            await writeGcsVerified(location, updated);
            await reconciliarCotaArquivos(cota.email, cota.plano, uid, [
                { path: location, bytesAntes: previous!.bytes, bytesDepois }
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
export async function updateMemoryFromSession(uid: string, session: ChatStoredSession, cota: ChatStorageQuota | null = null): Promise<ChatMemory> {
    // The updater executes inside saveMemory's distributed lock, so concurrent
    // completed sessions cannot overwrite each other's cumulative counters.
    return saveMemory(uid, existing => {
        const patch: Partial<ChatMemory> = {
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
export function formatMemoryForPrompt(memory: ChatMemory | null | undefined): string {
    if (!memory) return '';

    const lines = [];

    if (memory.lastTemplate) {
        const t = memory.lastTemplate;
        lines.push(`- Último template gerado: "${t.siteName || 'sem nome'}" | cor: ${t.colorPreset || '?'} | grid: ${t.gridLayout || '?'}`);
    }
    if ((memory.sessionCount ?? 0) > 1) {
        lines.push(`- Sessões anteriores: ${memory.sessionCount! - 1}`);
    }
    if ((memory.totalTokensUsed ?? 0) > 0) {
        const k = (memory.totalTokensUsed! / 1000).toFixed(1);
        lines.push(`- Total de tokens utilizados (lifetime): ${k}K`);
    }

    if (lines.length === 0) return '';

    return '\n\n## CONTEXTO DO USUÁRIO (histórico)\n' + lines.join('\n');
}
