'use strict';

/**
 * Testes de ragDeduplicator.js — puro, sem I/O nem rede (Jaccard sobre
 * tokens, não embeddings).
 *
 * Execute: node src/solaris/rag/ragDeduplicator.test.js
 */

const { similaridadeJaccard, encontrarSimilares } = require('./ragDeduplicator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. entradas idênticas em conteúdo (id diferente) têm score 1.
    {
        const a = { id: 'bootstrap5-modal', categoria: 'topico', componentes: ['modal', 'modal-dialog'], keywords: ['popup'] };
        const b = { id: 'bootstrap5-dialog', categoria: 'topico', componentes: ['modal', 'modal-dialog'], keywords: ['popup'] };
        assert('conteúdo idêntico: score 1', similaridadeJaccard(a, b) === 1);
    }

    // B. entradas sem nada em comum têm score 0.
    {
        const a = { id: 'flask-blueprints', categoria: 'topico', componentes: ['blueprint'], keywords: [] };
        const b = { id: 'css3-grid', categoria: 'topico', componentes: ['grid-template-columns'], keywords: [] };
        assert('conteúdo totalmente diferente: score 0', similaridadeJaccard(a, b) === 0);
    }

    // C. entrada sem tokens nenhum (campos vazios) tem score 0 com qualquer outra.
    {
        const a = { id: 'x', categoria: '', componentes: [], keywords: [] };
        const b = { id: 'y', categoria: 'topico', componentes: ['algo'], keywords: [] };
        assert('entrada vazia: score 0', similaridadeJaccard(a, b) === 0);
    }

    // D. encontrarSimilares nunca compara uma entrada consigo mesma (mesmo id).
    {
        const nova = { id: 'bootstrap5-navbar', categoria: 'topico', componentes: ['navbar'], keywords: [] };
        const catalogo = [{ id: 'bootstrap5-navbar', categoria: 'topico', componentes: ['navbar'], keywords: [] }];
        assert('não compara com a própria entrada (mesmo id)', encontrarSimilares(nova, catalogo).length === 0);
    }

    // E. encontrarSimilares acha e ordena por score decrescente.
    {
        const nova = { id: 'bootstrap5-modal-novo', categoria: 'topico', componentes: ['modal', 'modal-dialog', 'fade'], keywords: ['popup'] };
        const catalogo = [
            { id: 'bootstrap5-offcanvas', categoria: 'topico', componentes: ['offcanvas'], keywords: [] },              // nada em comum
            { id: 'bootstrap5-dialog-parecido', categoria: 'topico', componentes: ['modal', 'modal-dialog'], keywords: ['popup'] }, // muito parecido
            { id: 'bootstrap5-toast', categoria: 'topico', componentes: ['modal'], keywords: [] },                       // parecido fraco
        ];
        const similares = encontrarSimilares(nova, catalogo, { limiar: 0.1 });
        assert('achou os 2 parecidos, ignorou o sem nada em comum', similares.length === 2);
        assert('ordenado por score decrescente', similares[0].entrada.id === 'bootstrap5-dialog-parecido');
        assert('score do 1º é maior que o do 2º', similares[0].score > similares[1].score);
    }

    // F. limiar alto filtra parecidos fracos.
    {
        const nova = { id: 'a', categoria: 'topico', componentes: ['x', 'y', 'z'], keywords: [] };
        const catalogo = [{ id: 'b', categoria: 'topico', componentes: ['x'], keywords: [] }]; // 1 de 3 tokens em comum
        assert('limiar alto (0.9) filtra parecido fraco', encontrarSimilares(nova, catalogo, { limiar: 0.9 }).length === 0);
        assert('limiar baixo (0.1) encontra o mesmo par', encontrarSimilares(nova, catalogo, { limiar: 0.1 }).length === 1);
    }

    // G. entrada/catálogo inválidos não lançam, retornam array vazio.
    {
        assert('encontrarSimilares(null, [...]) retorna []', encontrarSimilares(null, [{ id: 'x' }]).length === 0);
        assert('encontrarSimilares(entrada, null) retorna []', encontrarSimilares({ id: 'x' }, null).length === 0);
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragDeduplicator: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
