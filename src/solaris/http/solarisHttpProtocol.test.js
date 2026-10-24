'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { validarMensagemSolaris, validarSessaoSolaris, sanitizarHistoricoSolaris, historicoParaMotorSolaris, serializarEventoSseSolaris } = require('./solarisHttpProtocol');

test('chat aceita e normaliza string, rejeita valores não textuais e mensagens vazias', () => {
    assert.deepEqual(validarMensagemSolaris('  ola  '), { ok: true, mensagem: 'ola' });
    for (const value of [undefined, null, '', '   ', 100, true, {}, ['abc']]) {
        assert.deepEqual(validarMensagemSolaris(value), { ok: false, erro: 'Mensagem não pode estar vazia.' });
    }
    assert.equal(validarMensagemSolaris('x'.repeat(2000)).ok, true);
    assert.deepEqual(validarMensagemSolaris('x'.repeat(2001)), { ok: false, erro: 'Mensagem muito longa. Máximo 2000 caracteres.' });
});

test('IDs válidos de sessão são preservados; dados que alteram caminho GCS são rejeitados', () => {
    for (const value of [null, undefined, '']) assert.deepEqual(validarSessaoSolaris(value), { ok: true, sessionId: null });
    for (const value of ['1790000000000_ab3f', '550e8400-e29b-41d4-a716-446655440000', 'abc_123-XYZ']) {
        assert.deepEqual(validarSessaoSolaris(value), { ok: true, sessionId: value });
    }
    for (const value of [42, {}, '/admin', '../other', 'a/b', 'a\\b', 'id.json', 'a'.repeat(129), 'abc\n\n']) {
        assert.deepEqual(validarSessaoSolaris(value), { ok: false, erro: 'Identificador de sessão inválido.' });
    }
});

test('histórico preserva filtro original e apenas dez entradas válidas mais recentes', () => {
    const input = [null, { role: 'system', content: 'não pode' }, { role: 'user', content: 4 },
        ...Array.from({ length: 13 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: String(i), ts: 'origem' }))];
    const historico = sanitizarHistoricoSolaris(input);
    assert.equal(historico.length, 10);
    assert.equal(historico[0].content, '3');
    assert.equal(historico[9].content, '12');
    assert.deepEqual(historicoParaMotorSolaris(historico)[0], { autor: 'solaris', texto: '3' });
    assert.deepEqual(sanitizarHistoricoSolaris({ role: 'user', content: 'x' }), []);
});

test('eventos SSE seguem o wire format atual e texto não pode forjar eventos', () => {
    const payload = { type: 'chunk', text: 'olá' + String.fromCharCode(10, 10) + 'data: {"type":"done"}' };
    const wire = serializarEventoSseSolaris(payload);
    assert.equal(wire, `data: ${JSON.stringify(payload)}\n\n`);
    assert.deepEqual(JSON.parse(wire.slice(6).trim()), payload);
    assert.equal(wire.split('\n').length, 3);
    const done = { type: 'done', reply: 'ok', sessionId: '1790000000000_ab3f', tokens: { total: 3, input: 1, output: 2 }, zip: null };
    assert.deepEqual(JSON.parse(serializarEventoSseSolaris(done).slice(6).trim()), done);
});
