'use strict';

/**
 * Testes da telemetria interna (Cano 4, fase 1).
 *
 * registrarCompilacao()/consultarTelemetria() são Firestore-backed —
 * sem credenciais reais neste ambiente de teste, então este arquivo
 * cobre só a parte determinística: _agregarEventos() (pura, recebe uma
 * lista de eventos já carregados e devolve o resumo) e a garantia de
 * que registrarCompilacao() nunca lança de forma síncrona, mesmo com
 * evento estranho — mesmo padrão de solAgent.test.js, que também não
 * exercita a chamada de rede real, só a lógica em volta dela.
 *
 * Execute: node src/core/telemetria.test.js
 */

const { registrarCompilacao, _agregarEventos } = require('./telemetria');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. registrarCompilacao nunca lança de forma síncrona (mesmo com
// evento estranho) — é fire-and-forget, a compilação real nunca pode
// ser derrubada por uma falha de log.
{
    let lancou = false;
    try { registrarCompilacao(undefined); } catch (e) { lancou = true; }
    assert('registrarCompilacao(undefined) não lança', lancou === false);
}
{
    let lancou = false;
    try { registrarCompilacao({ nichoTema: 'teste-telemetria', validadoresPassaram: { x: true } }); } catch (e) { lancou = true; }
    assert('registrarCompilacao(evento válido) não lança', lancou === false);
}

// B. _agregarEventos — mesma cobertura que o teste anterior tinha
// lendo o JSONL local, agora contra uma lista de eventos em memória.
{
    const eventos = [
        { nichoTema: 'teste-sol-a', pecaGeradaPorIA: true, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: false } },
        { nichoTema: 'teste-sol-a', pecaGeradaPorIA: false, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: true } },
        { nichoTema: 'teste-sol-b', pecaGeradaPorIA: false, validadoresPassaram: { xmlSemAvisos: true, dossieDomIds: true } },
    ];
    const r = _agregarEventos(eventos);
    assert('_agregarEventos: total correto', r.totalCompilacoes === 3, JSON.stringify(r));
    assert('_agregarEventos: agrega por nicho', r.porNicho['teste-sol-a'] === 2 && r.porNicho['teste-sol-b'] === 1);
    assert('_agregarEventos: conta peça gerada por IA', r.compilacoesComPecaGeradaPorIA === 1);
    assert('_agregarEventos: conta falha de validador', r.falhasPorValidador.dossieDomIds === 1);
}
{
    const r = _agregarEventos([]);
    assert('_agregarEventos: lista vazia não lança e devolve zero', r.totalCompilacoes === 0);
}
{
    const r = _agregarEventos([{ validadoresPassaram: {} }]);
    assert('_agregarEventos: evento sem nichoTema cai em "desconhecido"', r.porNicho['desconhecido'] === 1);
}

console.log(`\n${failed === 0 ? '✅' : '❌'} telemetria: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
