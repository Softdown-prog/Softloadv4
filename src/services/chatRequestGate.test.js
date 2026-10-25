'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { registrarRequisicaoChat } = require('./chatRequestGate');

function fakeDb() {
    const docs = new Map();
    const calls = [];
    let fail = false;
    return {
        docs, calls,
        failNext() { fail = true; },
        collection(name) {
            assert.equal(name, 'chat_stream_requests');
            return { doc(id) { return { id }; } };
        },
        async runTransaction(cb) {
            calls.push('transaction');
            if (fail) {
                fail = false;
                throw Object.assign(new Error('UNAVAILABLE'), { code: 14 });
            }
            const writes = [];
            const tx = {
                async get(ref) {
                    const data = docs.get(ref.id);
                    return { exists: !!data, data: () => data };
                },
                set(ref, value) { writes.push([ref.id, value]); },
            };
            const result = await cb(tx);
            for (const [key, value] of writes) docs.set(key, value);
            return result;
        },
    };
}
const id = '2f071443-bd75-4fc3-98d8-d2aacbb626c8';

test('primeiro envio é aceito; segundo idêntico é barrado de forma persistente', async () => {
    const db = fakeDb(), payload = { message: 'Olá', sessionId: null };
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'solaris', id, payload), 'accepted');
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'solaris', id, payload), 'duplicate');
    assert.equal(db.docs.size, 1);
    assert.equal(db.calls.length, 2);
});

test('mesmo id com outro conteúdo dá mismatch; usuários e produtos são isolados', async () => {
    const db = fakeDb(), payload = { message: 'A' };
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'especialista', id, payload), 'accepted');
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'especialista', id, { message: 'B' }), 'mismatch');
    assert.equal(await registrarRequisicaoChat(db, 'u-2', 'especialista', id, payload), 'accepted');
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'workspace', id, payload), 'accepted');
    assert.equal(db.docs.size, 3);
});

test('IDs malformados falham fechados antes de tocar no Firestore', async () => {
    const db = fakeDb();
    for (const value of [null, '', 'latest', '../../admin', id.replace('4fc3', '1fc3')]) {
        assert.equal(await registrarRequisicaoChat(db, 'u-1', 'solaris', value, {}), 'invalid');
    }
    assert.equal(db.calls.length, 0);
});

test('erro de Firestore impede admissão: não prosseguir para a IA', async () => {
    const db = fakeDb();
    db.failNext();
    await assert.rejects(registrarRequisicaoChat(db, 'u-1', 'solaris', id, {message:'x'}), /UNAVAILABLE/);
    assert.equal(db.docs.size, 0);
    assert.equal(await registrarRequisicaoChat(db, 'u-1', 'solaris', id, {message:'x'}), 'accepted');
});
