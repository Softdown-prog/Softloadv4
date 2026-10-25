'use strict';
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

function digest(text) {
    return createHash('sha256').update(text).digest('hex');
}

async function registrarRequisicaoChat(db, uid, produto, requestId, payload) {
    if (typeof uid !== 'string' || !uid || typeof produto !== 'string' || !produto) {
        return 'invalid';
    }
    if (typeof requestId !== 'string' || !REQUEST_ID_RE.test(requestId)) {
        return 'invalid';
    }
    const receiptId = digest(JSON.stringify([uid, produto, requestId]));
    const fingerprint = digest(JSON.stringify(payload));
    const ref = db.collection('chat_stream_requests').doc(receiptId);
    return db.runTransaction(async tx => {
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
