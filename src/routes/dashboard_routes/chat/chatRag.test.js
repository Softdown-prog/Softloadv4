'use strict';

/**
 * Regressões do índice RAG unificado.
 *
 * A base legada (src/rag/ia-de-balcao) e a base hierárquica
 * (src/rag/rag-ia-suporte/ia-de-balcao) coexistem durante a migração.
 * Estes testes garantem que a hierarquia nova é realmente carregada,
 * documentos Markdown são aceitos e caminhos repetidos não entram duas
 * vezes no mesmo prompt.
 */

const assert = require('assert');
const path = require('path');
const { buscarRagRelevante, montarContextoRag } = require('./chatRag');

let passed = 0;
let failed = 0;

function test(nome, fn) {
    try {
        fn();
        console.log(`  OK: ${nome}`);
        passed++;
    } catch (err) {
        console.error(`  FALHOU: ${nome}\n    ${err.message}`);
        failed++;
    }
}

function buscar(query) {
    return buscarRagRelevante(query);
}

console.log('chatRag.test.js');

test('carrega grupo hierárquico de integrações externas e arquivos Markdown', () => {
    const resultados = buscar('como usar cloudflare workers com blogger e esconder a api key');
    const chatbot = resultados.find(r =>
        r.entry.arquivo === 'integracoes-externas/chatbot-gemini-worker.md'
    );

    assert.ok(chatbot, 'deveria selecionar o guia de chatbot/Worker, não só domínio e HTTPS');
    assert.strictEqual(typeof chatbot.data, 'string', 'Markdown deve ser mantido como texto');
    assert.ok(
        montarContextoRag([chatbot]).includes('chatbot-gemini-worker.md'),
        'o Markdown precisa chegar ao contexto final'
    );
});

test('webhook seleciona o guia hierárquico de automação Blogger', () => {
    const resultados = buscar('como receber um webhook de pagamento e fazer entrega automática no blogger');
    assert.ok(
        resultados.some(r => r.entry.arquivo === 'integracoes-externas/workers-automacao-blogger.md'),
        'deveria selecionar workers-automacao-blogger.md'
    );
});

test('base hierárquica substitui duplicata legada pelo mesmo caminho lógico', () => {
    const resultados = buscar('grid sidebar col-lg-8 bootstrap grid');
    const cacheKey = 'ia-de-balcao/blogger-layout/ia-balcao-grid-sidebar-condicional.json';
    const repetidos = resultados.filter(r => r.entry._cacheKey === cacheKey);

    assert.strictEqual(repetidos.length, 1, 'o mesmo documento não pode entrar duas vezes');
    assert.ok(
        repetidos[0].entry._dir.includes(path.join('rag-ia-suporte', 'ia-de-balcao')),
        'a cópia hierárquica nova deve prevalecer sobre a legada'
    );
});

test('resultado de qualquer busca não repete _cacheKey', () => {
    const resultados = buscar('grid sidebar bootstrap grid');
    assert.ok(resultados.length > 0, 'a consulta precisa produzir resultados para validar a deduplicação');
    const keys = resultados.map(r => r.entry._cacheKey);
    assert.strictEqual(new Set(keys).size, keys.length);
});

console.log(`\n${passed} passou / ${failed} falhou`);
process.exit(failed === 0 ? 0 : 1);
