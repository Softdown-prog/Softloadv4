'use strict';

/**
 * Testes de modelRouter.js — sem bater na API real do Gemini: injeta um
 * clientFactory fake que grava os parâmetros de chamada.
 *
 * Fakes seguem a forma real da SDK unificada @google/genai:
 * `ai.models.generateContent({model,contents,config})`,
 * `ai.models.generateContentStream({model,contents,config})` e
 * `ai.chats.create({model,config}).sendMessage({message})` — não mais
 * `ai.getGenerativeModel({...generationConfig}).generateContent(prompt)`
 * da SDK antiga (@google/generative-ai), descontinuada.
 *
 * Execute: node src/solaris/llm/modelRouter.test.js
 */

const { criarModelRouter, MODEL_FLASH, MODEL_PRO } = require('./modelRouter');

// Teto real de saída do Gemini 2.5 é 65.536 — o cap calibrado pelo dono do
// produto (60.000) fica abaixo disso de propósito, não é o teto real.
const MAX_OUTPUT_TOKENS_ESPERADO = 8192;

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeClientFactory(respostaTexto) {
    const chamadas = [];
    const factory = () => ({
        models: {
            async generateContent(params) {
                chamadas.push(params);
                return { text: respostaTexto };
            },
        },
    });
    factory.chamadas = chamadas;
    return factory;
}

// Fake pra generateContentStream — cede os `pedacos` um a um (mesmo
// formato de chunk.text/chunk.usageMetadata do SDK real: `text` é
// propriedade, não função). `usageMetadataFinal` vai só no ÚLTIMO chunk —
// a SDK nova não tem mais uma Promise de "response" agregada à parte, o
// consumidor extrai usageMetadata do(s) chunk(s) do próprio stream.
function fakeClientFactoryStream(pedacos, usageMetadataFinal = null) {
    const chamadas = [];
    const factory = () => ({
        models: {
            async generateContentStream(params) {
                chamadas.push(params);
                async function* gerarStream() {
                    for (let i = 0; i < pedacos.length; i++) {
                        const ehUltimo = i === pedacos.length - 1;
                        yield { text: pedacos[i], usageMetadata: ehUltimo ? usageMetadataFinal : null };
                    }
                }
                return gerarStream();
            },
        },
    });
    factory.chamadas = chamadas;
    return factory;
}

async function coletarStream(gerador) {
    const pedacos = [];
    for await (const p of gerador) pedacos.push(p);
    return pedacos;
}

// Fake pra executarTarefaComFerramentas — simula ai.chats.create().sendMessage(),
// devolvendo um `response` pré-definido a cada chamada (mesmo shape do SDK
// real: candidates[0].content.parts[], usageMetadata, sem wrapper `.response`
// — a SDK nova resolve pro objeto de resposta direto). `turnos` é consumido
// em ordem, uma resposta por chamada de sendMessage.
function fakeClientFactoryChat(turnos) {
    const chamadas = [];
    const mensagensRecebidas = [];
    let idx = 0;
    const factory = () => ({
        chats: {
            create(params) {
                chamadas.push(params);
                return {
                    async sendMessage({ message }) {
                        mensagensRecebidas.push(message);
                        const response = turnos[idx++];
                        if (!response) throw new Error('fakeClientFactoryChat: sem mais turnos configurados');
                        return response;
                    },
                };
            },
        },
    });
    factory.chamadas = chamadas;
    factory.mensagensRecebidas = mensagensRecebidas;
    return factory;
}

function respostaTexto(texto, usageMetadata = null) {
    return { candidates: [{ content: { parts: [{ text: texto }] } }], usageMetadata };
}

function respostaToolCall(nome, args, usageMetadata = null) {
    return { candidates: [{ content: { parts: [{ functionCall: { name: nome, args } }] } }], usageMetadata };
}

async function run() {
    // A. executarTriagem usa o modelo Flash, temperature baixa.
    {
        const factory = fakeClientFactory('ok-flash');
        const router = criarModelRouter(factory);
        const texto = await router.executarTriagem({ prompt: 'detecta o framework' });
        assert('executarTriagem retorna o texto da resposta', texto === 'ok-flash');
        assert('executarTriagem usa MODEL_FLASH', factory.chamadas[0].model === MODEL_FLASH);
        assert('executarTriagem usa temperature 0.2', factory.chamadas[0].config.temperature === 0.2);
        assert('executarTriagem usa teto econômico de 2048 tokens', factory.chamadas[0].config.maxOutputTokens === 2048);
        assert('executarTriagem sem responseSchema não seta responseMimeType', !factory.chamadas[0].config.responseMimeType);
    }

    // B. executarTriagem com responseSchema seta responseMimeType/responseSchema.
    {
        const factory = fakeClientFactory('{}');
        const router = criarModelRouter(factory);
        const schema = { type: 'object' };
        await router.executarTriagem({ prompt: 'x', responseSchema: schema });
        assert('responseMimeType application/json setado', factory.chamadas[0].config.responseMimeType === 'application/json');
        assert('responseSchema repassado', factory.chamadas[0].config.responseSchema === schema);
    }

    // C. executarTarefaArquitetura usa o modelo Pro, temperature mais alta, thinkingConfig por padrão.
    {
        const factory = fakeClientFactory('ok-pro');
        const router = criarModelRouter(factory);
        const resp = await router.executarTarefaArquitetura({ prompt: 'monta o manifesto' });
        assert('executarTarefaArquitetura retorna response', resp.text === 'ok-pro');
        assert('executarTarefaArquitetura usa MODEL_PRO', factory.chamadas[0].model === MODEL_PRO);
        assert('executarTarefaArquitetura usa temperature 0.7', factory.chamadas[0].config.temperature === 0.7);
        assert('executarTarefaArquitetura usa teto conservador de 8192 tokens', factory.chamadas[0].config.maxOutputTokens === MAX_OUTPUT_TOKENS_ESPERADO);
        assert('thinkingConfig.thinkingBudget default 2048', factory.chamadas[0].config.thinkingConfig.thinkingBudget === 2048);
    }

    // D. executarTarefaArquitetura com thinkingBudget:0 desliga o thinking.
    {
        const factory = fakeClientFactory('ok');
        const router = criarModelRouter(factory);
        await router.executarTarefaArquitetura({ prompt: 'x', thinkingBudget: 0 });
        assert('thinkingBudget:0 não seta thinkingConfig', !factory.chamadas[0].config.thinkingConfig);
    }

    // E. tools são repassadas dentro do config (function calling).
    {
        const factory = fakeClientFactory('ok');
        const router = criarModelRouter(factory);
        const tools = [{ functionDeclarations: [{ name: 'createHtml' }] }];
        await router.executarTarefaArquitetura({ prompt: 'x', tools });
        assert('tools repassadas', factory.chamadas[0].config.tools === tools);
    }

    // F. prompt ausente rejeita com erro claro em vez de bater na API com undefined.
    {
        const router = criarModelRouter(fakeClientFactory('x'));
        let erro = null;
        try { await router.executarTriagem({}); } catch (e) { erro = e; }
        assert('executarTriagem sem prompt rejeita', erro && /prompt é obrigatório/.test(erro.message));

        let erro2 = null;
        try { await router.executarTarefaArquitetura({}); } catch (e) { erro2 = e; }
        assert('executarTarefaArquitetura sem prompt rejeita', erro2 && /prompt é obrigatório/.test(erro2.message));
    }

    // G. executarTriagemStream cede cada trecho de texto (async generator).
    {
        const factory = fakeClientFactoryStream(['Olá', ', ', 'tudo bem?']);
        const router = criarModelRouter(factory);
        const pedacos = await coletarStream(router.executarTriagemStream({ prompt: 'oi' }));
        assert('executarTriagemStream cede todos os pedaços em ordem', pedacos.join('') === 'Olá, tudo bem?');
        assert('executarTriagemStream usa MODEL_FLASH', factory.chamadas[0].model === MODEL_FLASH);
        // 2.0 (teto real da API Gemini), não 0.2 (diferente de
        // executarTriagem) — pedido explícito do dono do produto pra
        // deixar o chat o mais livre/criativo possível, ver comentário em
        // modelRouter.js.
        assert('executarTriagemStream usa temperature 2.0 (teto da API, chat livre)', factory.chamadas[0].config.temperature === 2.0);
    }

    // H. executarTriagemStream popula tokensRef ao final (usageMetadata do último chunk).
    {
        const usage = { totalTokenCount: 120, promptTokenCount: 80, candidatesTokenCount: 40 };
        const factory = fakeClientFactoryStream(['abc'], usage);
        const router = criarModelRouter(factory);
        const tokensRef = { total: 0, input: 0, output: 0 };
        await coletarStream(router.executarTriagemStream({ prompt: 'oi', tokensRef }));
        assert('tokensRef.total populado', tokensRef.total === 120);
        assert('tokensRef.input populado', tokensRef.input === 80);
        assert('tokensRef.output populado', tokensRef.output === 40);
    }

    // I. executarTriagemStream sem prompt rejeita antes de chamar o modelo.
    {
        const router = criarModelRouter(fakeClientFactoryStream(['x']));
        let erro = null;
        try { await coletarStream(router.executarTriagemStream({})); } catch (e) { erro = e; }
        assert('executarTriagemStream sem prompt rejeita', erro && /prompt é obrigatório/.test(erro.message));
    }

    // J. executarTarefaComFerramentas — sem chamada de ferramenta, resposta direta na 1ª volta.
    {
        const factory = fakeClientFactoryChat([respostaTexto('resposta direta', { totalTokenCount: 10, promptTokenCount: 6, candidatesTokenCount: 4 })]);
        const router = criarModelRouter(factory);
        const executor = async () => { throw new Error('não deveria ser chamado'); };
        const r = await router.executarTarefaComFerramentas({ prompt: 'oi', executorFerramenta: executor, tools: [{ functionDeclarations: [] }] });
        assert('sem tool call: texto devolvido direto', r.texto === 'resposta direta');
        assert('sem tool call: 1 iteração', r.iteracoes === 1);
        assert('sem tool call: tokens agregados do usageMetadata', r.tokens.total === 10 && r.tokens.input === 6 && r.tokens.output === 4);
        assert('usa MODEL_PRO', factory.chamadas[0].model === MODEL_PRO);
    }

    // K. executarTarefaComFerramentas — 1 chamada de ferramenta, depois resposta final.
    {
        const factory = fakeClientFactoryChat([
            respostaToolCall('minhaFerramenta', { x: 1 }),
            respostaTexto('ok depois da ferramenta'),
        ]);
        const router = criarModelRouter(factory);
        const chamadasRecebidas = [];
        const executor = async (nome, args) => {
            chamadasRecebidas.push({ nome, args });
            return { resultado: 'valor-da-ferramenta' };
        };
        const r = await router.executarTarefaComFerramentas({ prompt: 'investiga', executorFerramenta: executor });
        assert('tool call: executorFerramenta chamado com nome/args certos', chamadasRecebidas.length === 1 && chamadasRecebidas[0].nome === 'minhaFerramenta' && chamadasRecebidas[0].args.x === 1);
        assert('tool call: texto final depois da ferramenta', r.texto === 'ok depois da ferramenta');
        assert('tool call: 2 iterações (chamada + resposta final)', r.iteracoes === 2);
        // SDK nova recusa parts functionResponse crus — precisam vir
        // envolvidos num Content ({role,parts}) explícito (achado real, ver
        // comentário em modelRouter.js).
        const segundaMensagem = factory.mensagensRecebidas[1];
        assert('tool call: functionResponse envolvido num Content com role', segundaMensagem[0].role === 'user' && Array.isArray(segundaMensagem[0].parts));
        assert('tool call: functionResponse repassado de volta pro chat', segundaMensagem[0].parts[0].functionResponse.name === 'minhaFerramenta');
        assert('tool call: resultado do executor vai no functionResponse.response', segundaMensagem[0].parts[0].functionResponse.response.resultado === 'valor-da-ferramenta');
    }

    // L. executarTarefaComFerramentas — esgota maxToolCalls sem lançar, texto vazio.
    {
        const factory = fakeClientFactoryChat([
            respostaToolCall('f', {}),
            respostaToolCall('f', {}),
        ]);
        const router = criarModelRouter(factory);
        const r = await router.executarTarefaComFerramentas({ prompt: 'x', executorFerramenta: async () => ({}), maxToolCalls: 2 });
        assert('esgotamento: nunca lança', true);
        assert('esgotamento: iteracoes === maxToolCalls', r.iteracoes === 2);
        assert('esgotamento: texto vazio (sem resposta final)', r.texto === '');
    }

    // M. executarTarefaComFerramentas — onProgress chamado por chamada de ferramenta.
    {
        const factory = fakeClientFactoryChat([respostaToolCall('minhaFerramenta', { y: 2 }), respostaTexto('fim')]);
        const router = criarModelRouter(factory);
        const eventos = [];
        await router.executarTarefaComFerramentas({
            prompt: 'x',
            executorFerramenta: async () => ({}),
            onProgress: (ev) => eventos.push(ev),
        });
        assert('onProgress chamado com nome/args da ferramenta', eventos.length === 1 && eventos[0].nome === 'minhaFerramenta' && eventos[0].args.y === 2);
    }

    // N. executarTarefaComFerramentas — prompt/executorFerramenta ausentes rejeitam.
    {
        const router = criarModelRouter(fakeClientFactoryChat([respostaTexto('x')]));
        let erro1 = null;
        try { await router.executarTarefaComFerramentas({ executorFerramenta: async () => ({}) }); } catch (e) { erro1 = e; }
        assert('sem prompt rejeita', erro1 && /prompt é obrigatório/.test(erro1.message));

        let erro2 = null;
        try { await router.executarTarefaComFerramentas({ prompt: 'x' }); } catch (e) { erro2 = e; }
        assert('sem executorFerramenta rejeita', erro2 && /executorFerramenta é obrigatório/.test(erro2.message));
    }

    // O. executarTarefaComFerramentas — thinkingBudget:0 (default) não seta thinkingConfig; >0 seta.
    {
        const factory1 = fakeClientFactoryChat([respostaTexto('x')]);
        await criarModelRouter(factory1).executarTarefaComFerramentas({ prompt: 'x', executorFerramenta: async () => ({}) });
        assert('thinkingBudget default (0) não seta thinkingConfig', !factory1.chamadas[0].config.thinkingConfig);

        const factory2 = fakeClientFactoryChat([respostaTexto('x')]);
        await criarModelRouter(factory2).executarTarefaComFerramentas({ prompt: 'x', executorFerramenta: async () => ({}), thinkingBudget: 1024 });
        assert('thinkingBudget>0 seta thinkingConfig.thinkingBudget', factory2.chamadas[0].config.thinkingConfig.thinkingBudget === 1024);
    }

    // P. executarTarefaComFerramentas — tools repassadas dentro do config.
    {
        const factory = fakeClientFactoryChat([respostaTexto('x')]);
        const tools = [{ functionDeclarations: [{ name: 'foo' }] }];
        await criarModelRouter(factory).executarTarefaComFerramentas({ prompt: 'x', executorFerramenta: async () => ({}), tools });
        assert('tools repassadas', factory.chamadas[0].config.tools === tools);
    }
}

run().then(() => {
    console.log(`\n${failed === 0 ? '✅' : '❌'} modelRouter: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
