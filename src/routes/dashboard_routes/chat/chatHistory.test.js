'use strict';

/**
 * Testes de montarHistoricoSeguro — garante que o corte de histórico nunca
 * devolve um array cujo primeiro elemento não seja 'user' (Gemini rejeita
 * com 400 "First content should be with role 'user'" caso contrário —
 * bug real reproduzido em produção assim que a conversa passa de histLen
 * mensagens).
 *
 * Execute: node src/routes/dashboard_routes/chat/chatHistory.test.js
 */

const { montarHistoricoSeguro } = require('./chatHistory');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function msg(role, i) {
    return { role, content: `msg-${role}-${i}` };
}

// ── entrada não-array ───────────────────────────────────────────────────
{
    assert('undefined vira array vazio', Array.isArray(montarHistoricoSeguro(undefined, 10)) && montarHistoricoSeguro(undefined, 10).length === 0);
    assert('null vira array vazio', montarHistoricoSeguro(null, 10).length === 0);
}

// ── corte que caía no meio de um par (o bug real) ───────────────────────
{
    // 11 mensagens alternadas começando em 'user' (índices 0..10) — slice(-10)
    // simples pegaria índices 1..10, cujo primeiro elemento é 'assistant'.
    const historico = [];
    for (let i = 0; i < 11; i++) historico.push(msg(i % 2 === 0 ? 'user' : 'assistant', i));

    const resultado = montarHistoricoSeguro(historico, 10);
    assert('primeiro elemento é sempre "user"', resultado.length > 0 && resultado[0].role === 'user', JSON.stringify(resultado[0]));
    assert('descarta só o necessário (9 de 10 cortados)', resultado.length === 9, `length=${resultado.length}`);
}

// ── corte que já cai certinho em 'user' — nada descartado além do slice ──
{
    const historico = [];
    for (let i = 0; i < 10; i++) historico.push(msg(i % 2 === 0 ? 'user' : 'assistant', i));
    const resultado = montarHistoricoSeguro(historico, 10);
    assert('slice exato: mantém todos os 10', resultado.length === 10);
    assert('slice exato: primeiro é user', resultado[0].role === 'user');
}

// ── histórico menor que histLen ──────────────────────────────────────────
{
    const historico = [msg('user', 1), msg('assistant', 1)];
    const resultado = montarHistoricoSeguro(historico, 10);
    assert('histórico curto: preservado inteiro', resultado.length === 2);
}

// ── filtra entradas malformadas (role/content inválidos) ────────────────
{
    const historico = [
        { role: 'system', content: 'x' },
        msg('user', 1),
        { role: 'assistant', content: 123 }, // content não-string
        msg('assistant', 2),
    ];
    const resultado = montarHistoricoSeguro(historico, 10);
    assert('descarta role desconhecida e content não-string', resultado.length === 2, JSON.stringify(resultado));
    assert('mantém só user/assistant válidos, começando em user', resultado[0].role === 'user');
}

// ── só mensagens 'assistant' (nenhum 'user' pra ancorar) ────────────────
{
    const historico = [msg('assistant', 1), msg('assistant', 2)];
    const resultado = montarHistoricoSeguro(historico, 10);
    assert('sem nenhum user: descarta tudo (array vazio, não crasha)', resultado.length === 0);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} chatHistory: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
