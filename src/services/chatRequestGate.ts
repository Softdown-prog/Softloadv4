'use strict';
interface ChatDocRef { readonly id?: string }
interface ChatReceipt { fingerprint: string; produto: string; criado_em: string; expira_em: Date }
interface ChatSnapshot { exists: boolean; data(): ChatReceipt | undefined }
interface ChatTransaction {
    get(ref: ChatDocRef): Promise<ChatSnapshot>;
    set(ref: ChatDocRef, record: ChatReceipt): void;
}
interface ChatGateDb {
    collection(name: 'chat_stream_requests'): { doc(id: string): ChatDocRef };
    runTransaction<T>(callback: (tx: ChatTransaction) => Promise<T>): Promise<T>;
}
type ChatRequestResult = 'invalid' | 'accepted' | 'duplicate' | 'mismatch';
declare const module: { exports: unknown };
declare const require: (name: string) => { createHash(algorithm: string): { update(value: string): { digest(encoding: string): string } } };

/**
 * Bloqueio persistente de requests de streaming. Identificador do cliente
 * identifica o envio, mas NUNCA é usado para o débito de créditos.
 * Cada requestId é vinculado ao UID, produto e fingerprint do payload.
 *
 * Um registro recebido não pode ser reaberto automaticamente: o processo
 * pode morrer após iniciar uma geração cobrável. Rejeitar a mesma chave é
 * mais seguro do que executar duas vezes. O usuário pode enviar outra
 * mensagem, que terá outra chave.
 */
const { createHash } = require('node:crypto');

const REQUEST_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function digest(text: string): string {
    return createHash('sha256').update(text).digest('hex');
}

async function registrarRequisicaoChat(db: ChatGateDb, uid: unknown, produto: unknown, requestId: unknown, payload: unknown): Promise<ChatRequestResult> {
    if (typeof uid !== 'string' || !uid || typeof produto !== 'string' || !produto) {
        return 'invalid';
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
        return 'invalid';
    }
    const receiptId = digest(JSON.stringify([uid, produto, requestId]));
    const fingerprint = digest(JSON.stringify(payload));
    const ref = db.collection('chat_stream_requests').doc(receiptId);
    return db.runTransaction<ChatRequestResult>(async tx => {
        const snap = await tx.get(ref);
        if (snap.exists) {
            return snap.data()?.fingerprint === fingerprint ? 'duplicate' : 'mismatch';
        }
        tx.set(ref, {
            produto,
            fingerprint,
            criado_em: new Date().toISOString(),
            // Habilitar política de TTL Firestore neste campo em produção.
            // Firestore TTL exige timestamp, não string ISO.
            expira_em: new Date(Date.now() + 30 * 86400000),
        });
        return 'accepted';
    });
}

module.exports = { registrarRequisicaoChat };

export {};
