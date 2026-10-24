'use strict';

/**
 * Testes de solarisChat.js — modelRouter fake injetado.
 * Execute: node src/solaris/chat/solarisChat.test.js
 */

const { criarSolarisChat } = require('./solarisChat');
const { SOLARIS_SYSTEM_PROMPT } = require('../prompts/systemPrompt');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeModelRouter(resposta) {
    const chamadas = [];
    return {
        chamadas,
        async executarTriagem(params) {
            chamadas.push(params);
            return resposta;
        },
    };
}

function fakeModelRouterStream(pedacos) {
    const chamadas = [];
    return {
        chamadas,
        async *executarTriagemStream(params) {
            chamadas.push(params);
            for (const p of pedacos) yield p;
            if (params.tokensRef) {
                params.tokensRef.total = 99;
                params.tokensRef.input = 60;
                params.tokensRef.output = 39;
            }
        },
    };
}

async function coletar(gerador) {
    const pedacos = [];
    for await (const p of gerador) pedacos.push(p);
    return pedacos;
}

async function run() {
    // A. perguntar() repassa o system prompt do Solaris (nunca menciona o Compiler Blogger).
    // Mensagem neutra de propósito — não deve casar com nenhuma categoria do
    // catálogo RAG (isolando este teste do comportamento de injeção de
    // contexto, coberto à parte nos testes G/H).
    {
        const router = fakeModelRouter('Claro, posso ajudar com HTML5.');
        const chat = criarSolarisChat({ modelRouter: router });
        const resp = await chat.perguntar('me ajuda a revisar um trecho de código, por favor');
        assert('perguntar retorna a resposta do modelo', resp === 'Claro, posso ajudar com HTML5.');
        assert('perguntar usa o system prompt do Solaris', router.chamadas[0].systemInstruction === SOLARIS_SYSTEM_PROMPT);
        assert('prompt sem histórico é só a mensagem (sem categoria reconhecida)', router.chamadas[0].prompt === 'me ajuda a revisar um trecho de código, por favor');
    }

    // B. histórico vira contexto prefixado no prompt. "e agora?" não casa
    // categoria nenhuma — mensagem atual (não o histórico) é o que decide
    // se o contexto de categoria entra, então o prompt termina exatamente
    // na mensagem do usuário sem nada depois.
    {
        const router = fakeModelRouter('ok');
        const chat = criarSolarisChat({ modelRouter: router });
        await chat.perguntar('e agora?', [
            { autor: 'usuario', texto: 'preciso de uma ajuda geral' },
            { autor: 'solaris', texto: 'qual framework você prefere?' },
        ]);
        assert('histórico vira prefixo Usuário:/Solaris:', router.chamadas[0].prompt.includes('Usuário: preciso de uma ajuda geral') && router.chamadas[0].prompt.includes('Solaris: qual framework'));
        assert('mensagem atual vai no final do prompt (sem categoria reconhecida)', router.chamadas[0].prompt.trim().endsWith('Usuário: e agora?'));
    }

    // C. mensagem vazia/ausente rejeita, não lança pra fora do chat sem contexto.
    {
        const chat = criarSolarisChat({ modelRouter: fakeModelRouter('x') });
        let erro = null;
        try { await chat.perguntar(''); } catch (e) { erro = e; }
        assert('mensagem vazia rejeita com erro claro', erro && /mensagem é obrigatória/.test(erro.message));
    }

    // D. perguntarStream cede os pedaços do modelRouter.executarTriagemStream em ordem.
    {
        const router = fakeModelRouterStream(['ol', 'á, ', 'tudo bem?']);
        const chat = criarSolarisChat({ modelRouter: router });
        const pedacos = await coletar(chat.perguntarStream('me ajuda a revisar um trecho de código'));
        assert('perguntarStream cede todos os pedaços em ordem', pedacos.join('') === 'olá, tudo bem?');
        assert('perguntarStream usa o system prompt do Solaris', router.chamadas[0].systemInstruction === SOLARIS_SYSTEM_PROMPT);
    }

    // E. perguntarStream repassa tokensRef pro modelRouter e ele é populado ao final.
    {
        const router = fakeModelRouterStream(['x']);
        const chat = criarSolarisChat({ modelRouter: router });
        const tokensRef = { total: 0, input: 0, output: 0 };
        await coletar(chat.perguntarStream('oi', [], tokensRef));
        assert('tokensRef populado após o stream terminar', tokensRef.total === 99 && tokensRef.input === 60 && tokensRef.output === 39);
    }

    // F. perguntarStream com mensagem vazia rejeita (via iterador — 1ª chamada a .next() lança).
    {
        const chat = criarSolarisChat({ modelRouter: fakeModelRouterStream(['x']) });
        let erro = null;
        try { await coletar(chat.perguntarStream('')); } catch (e) { erro = e; }
        assert('perguntarStream com mensagem vazia rejeita', erro && /mensagem é obrigatória/.test(erro.message));
    }

    // G. perguntar() injeta contexto de categoria reconhecida no prompt
    // (Fase 2 — mesmo catálogo RAG usado pelo orchestrator.gerarManifesto).
    {
        const router = fakeModelRouter('ok');
        const chat = criarSolarisChat({ modelRouter: router });
        await chat.perguntar('quero criar um blog de culinária pra postar receitas');
        const prompt = router.chamadas[0].prompt;
        assert('prompt inclui contexto de categoria reconhecida', prompt.includes('categoria reconhecida'));
        assert('prompt inclui o id da categoria casada ("blog")', prompt.includes('"blog"'));
        assert('contexto de categoria vem depois da mensagem do usuário', prompt.indexOf('quero criar um blog') < prompt.indexOf('categoria reconhecida'));
    }

    // H. perguntarStream também injeta o contexto de categoria (mesmo _montarPrompt).
    {
        const router = fakeModelRouterStream(['ok']);
        const chat = criarSolarisChat({ modelRouter: router });
        await coletar(chat.perguntarStream('preciso de uma landing page de vendas focada em conversão'));
        assert('perguntarStream também inclui contexto de categoria', router.chamadas[0].prompt.includes('"landing-page"'));
    }

    // I. mensagem sem categoria reconhecida não injeta contexto nenhum.
    {
        const router = fakeModelRouter('ok');
        const chat = criarSolarisChat({ modelRouter: router });
        await chat.perguntar('me ajuda a revisar um trecho de código, por favor');
        assert('sem categoria reconhecida: prompt não inclui contexto', !router.chamadas[0].prompt.includes('categoria reconhecida'));
    }
    // J. RAG vetorial entra no chat e também no streaming.
    {
        const consultas = [];
        const buscarConhecimento = async args => {
            consultas.push(args);
            return { resultados: [{ entryId: 'typescript-auth', texto: 'Use cookies HttpOnly e valide entradas.' }] };
        };
        const router = fakeModelRouter('ok');
        const chat = criarSolarisChat({ modelRouter: router, buscarConhecimento });
        await chat.perguntar('crie uma aplicação TypeScript com autenticação segura');
        assert('chat inclui conhecimento semântico', router.chamadas[0].prompt.includes('Fonte typescript-auth'));
        assert('chat faz apenas uma consulta topK=3', consultas.length === 1 && consultas[0].topK === 3);

        const stream = fakeModelRouterStream(['ok']);
        const chatStream = criarSolarisChat({ modelRouter: stream, buscarConhecimento });
        await coletar(chatStream.perguntarStream('quero desenvolver um jogo HTML5 com sprites'));
        assert('stream inclui conhecimento semântico', stream.chamadas[0].prompt.includes('Fonte typescript-auth'));
    }

    // K. Conversas não técnicas não gastam recursos de embeddings.
    {
        let consultas = 0;
        const chat = criarSolarisChat({
            modelRouter: fakeModelRouter('ok'),
            buscarConhecimento: async () => { consultas++; return { resultados: [] }; },
        });
        await chat.perguntar('Oi, tudo bem com você?');
        assert('chat casual ignora embeddings', consultas === 0);
    }

}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} solarisChat: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
