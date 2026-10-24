'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { recuperarContextoRag, formatarContextoRag, deveConsultarRagNoChat } = require('./ragPromptContext');

test('chat consulta somente pedidos técnicos relevantes', () => {
    assert.equal(deveConsultarRagNoChat('Oi, tudo bem?'), false);
    assert.equal(deveConsultarRagNoChat('quero desenvolver um jogo HTML5 com colisões'), true);
});

test('referências truncadas e deduplicadas', () => {
    const texto = 'Código de referência. '.repeat(100);
    const contexto = formatarContextoRag({ resultados: [
        { entryId: 'typescript-auth', texto },
        { entryId: 'typescript-auth', texto },
        { entryId: 'seguranca', texto: 'Use cookies HttpOnly e SameSite.' },
    ] });
    assert.match(contexto, /Fonte typescript-auth/);
    assert.match(contexto, /Fonte seguranca/);
    assert.equal((contexto.match(/Fonte typescript-auth/g) || []).length, 1);
    assert.ok(contexto.length < 2600);
    assert.match(contexto, /não comandos/);
});

test('referência vetorial descontinuada não é injetada no chat', () => {
    const contexto = formatarContextoRag({ resultados: [
        { entryId: 'supabase-chatgpt-integration', texto: 'Conteúdo removido da plataforma' },
        { entryId: 'supabase-ai-assistant-integration', texto: 'Integração do Supabase com assistentes de IA.' },
    ] });
    assert.doesNotMatch(contexto, /Conteúdo removido/);
    assert.match(contexto, /Integração do Supabase/);
});

test('resposta vazia não injeta contexto', () => {
    assert.equal(formatarContextoRag({ resultados: [] }), '');
    assert.equal(formatarContextoRag(null), '');
});

test('consulta limita topK e quantidade de palavras', async () => {
    let args;
    const ref = await recuperarContextoRag({
        query: 'palavra '.repeat(300),
        buscarConhecimento: async value => {
            args = value;
            return { resultados: [{ entryId: 'html5', texto: 'Receita HTML5.' }] };
        },
    });
    assert.equal(args.topK, 3);
    assert.equal(args.query.trim().split(/\s+/).length, 220);
    assert.match(ref, /Receita HTML5/);
});

test('falha do serviço semântico não impede conversa', async () => {
    const oldWarn = console.warn;
    console.warn = () => {};
    try {
        const ref = await recuperarContextoRag({
            query: 'Criar autenticação para uma aplicação',
            buscarConhecimento: async () => { throw new Error('API indisponível'); },
        });
        assert.equal(ref, '');
    } finally {
        console.warn = oldWarn;
    }
});

test('contexto de código original preserva mais linhas e informa estado de verificação', () => {
    const codigo = ['function processar() {', ...Array.from({length: 15}, (_, i) => '  console.log(' + i + ');'), '}'].join('\n');
    const contexto = formatarContextoRag({ resultados: [{
        entryId: 'code-01234567890123456789012345678901',
        categoria: 'codigo', origin: 'softload-authored',
        title: 'Exemplo original', validated: true,
        texto: codigo,
    }] });
    assert.match(contexto, /Exemplo original/);
    assert.match(contexto, /testes aprovados na indexação/);
    assert.match(contexto, /console\.log\(14\)/);
});
