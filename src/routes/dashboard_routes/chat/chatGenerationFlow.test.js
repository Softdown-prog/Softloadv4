'use strict';

/**
 * Testes de chatGenerationFlow.js — foco na garantia central desta rodada:
 * o pipeline determinístico de geração de templates (detecção do marcador
 * [[TEMPLATE:{...}]] + _compilarParaChat) só roda quando permitirGeracao
 * é explicitamente true, independente do que o modelo decidir emitir no
 * texto. É o gate de código (não só de prompt) que garante que o
 * Especialista (chat.js, permitirGeracao=false) nunca compila nada, mesmo
 * que o modelo ignore o SISTEMA_SUPORTE e tente emitir o marcador.
 *
 * geminiService.gerarChatStream / openaiService.gerarChatGptStream /
 * chatTemplateCompiler._compilarParaChat são mockados (nenhuma chamada de
 * rede/GCS real) — monkey-patch nos exports ANTES do primeiro require de
 * chatGenerationFlow.js, já que este faz `const { x } = require(...)` uma
 * vez só (mesmo truque de pecaOrchestrator.test.js).
 */

const assert = require('assert');

const geminiService = require('../../../services/geminiService');
const openaiService = require('../../../services/openaiService');
const chatTemplateCompiler = require('./chatTemplateCompiler');

const MARKER_JSON = '{"siteName":"TechBR","pageType":"blogger-conteudo","nichoTema":"tecnologia-mag-tech","colorPreset":"tech-blue"}';

// Fila mutável — cada teste define o texto que o "modelo" deve devolver.
let mockStreamText = 'Resposta normal, sem marcador.';
let compilarChamado = 0;
// chatGenerationFlow.js faz `const { _compilarParaChat } = require(...)` —
// destructuring captura a referência da função UMA VEZ, no require original
// abaixo. Reatribuir chatTemplateCompiler._compilarParaChat depois não
// afetaria mais nada ali — por isso o mock precisa ser condicional via esta
// flag, não trocado por um mock novo a cada teste.
let deveFalhar = false;

async function* fakeStream() {
    yield mockStreamText;
}

geminiService.gerarChatStream = (...args) => fakeStream();
openaiService.gerarChatGptStream = (...args) => fakeStream();
chatTemplateCompiler._compilarParaChat = async (blueprint) => {
    compilarChamado++;
    if (deveFalhar) throw new Error('siteName inválido');
    return {
        downloadUrl: '/dashboard/compilacao/fake-id/download',
        snapshot: { siteName: blueprint.siteName, colorPreset: blueprint.colorPreset, gridLayout: 'mural', manifesto: {} },
    };
};

const { gerarComPossivelTemplate } = require('./chatGenerationFlow');

let passed = 0;
let failed = 0;

async function test(nome, fn) {
    compilarChamado = 0;
    try {
        await fn();
        console.log(`  OK: ${nome}`);
        passed++;
    } catch (err) {
        console.error(`  FALHOU: ${nome}\n    ${err.message}`);
        failed++;
    }
}

async function main() {
    console.log('chatGenerationFlow.test.js');

    // ── Caso 1: permitirGeracao=false (Especialista) + modelo tenta emitir
    //    o marcador mesmo assim → NUNCA compila, marcador nunca vaza ──────
    await test('permitirGeracao=false: marcador emitido pelo modelo não compila nem vaza', async () => {
        mockStreamText = `Beleza, aqui vai! [[TEMPLATE:${MARKER_JSON}]]`;
        const resultado = await gerarComPossivelTemplate({
            msg: 'confirmo', safeHistory: [], isGpt: false, wsSnapshot: null,
            email: 'teste@softload.com', uid: 'uid-teste-1', user: { email: 'teste@softload.com', uid: 'uid-teste-1' },
            sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
            permitirGeracao: false,
        });
        assert.strictEqual(compilarChamado, 0, '_compilarParaChat não deveria ter sido chamado');
        assert.strictEqual(resultado.downloadUrl, null, 'downloadUrl deveria ficar null');
        assert.strictEqual(resultado.novoSnapshot, null, 'novoSnapshot deveria ficar null');
        assert.ok(!resultado.fullText.includes('[[TEMPLATE:'), 'marcador não pode vazar no texto mostrado ao usuário');
    });

    // ── Caso 2: permitirGeracao=false + isGpt=true (Especialista com GPT)
    //    — mesmo resultado, dupla garantia ──────────────────────────────
    await test('permitirGeracao=false + isGpt=true: também não compila', async () => {
        mockStreamText = `Aqui está. [[TEMPLATE:${MARKER_JSON}]]`;
        const resultado = await gerarComPossivelTemplate({
            msg: 'confirmo', safeHistory: [], isGpt: true, wsSnapshot: null,
            email: 'teste@softload.com', uid: 'uid-teste-2', user: { email: 'teste@softload.com', uid: 'uid-teste-2' },
            sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
            permitirGeracao: false,
        });
        assert.strictEqual(compilarChamado, 0, '_compilarParaChat não deveria ter sido chamado');
        assert.strictEqual(resultado.downloadUrl, null, 'downloadUrl deveria ficar null');
    });

    // ── Caso 3: permitirGeracao=true + isGpt=false (Workspace, Gemini)
    //    — compila normalmente ────────────────────────────────────────
    await test('permitirGeracao=true + isGpt=false: compila e devolve downloadUrl', async () => {
        mockStreamText = `Pronto! [[TEMPLATE:${MARKER_JSON}]]`;
        const resultado = await gerarComPossivelTemplate({
            msg: 'confirmo', safeHistory: [], isGpt: false, wsSnapshot: null,
            email: 'teste@softload.com', uid: 'uid-teste-3', user: { email: 'teste@softload.com', uid: 'uid-teste-3' },
            sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
            permitirGeracao: true,
        });
        assert.strictEqual(compilarChamado, 1, '_compilarParaChat deveria ter sido chamado exatamente 1x');
        assert.strictEqual(resultado.downloadUrl, '/dashboard/compilacao/fake-id/download');
        assert.ok(resultado.novoSnapshot && resultado.novoSnapshot.siteName === 'TechBR');
        assert.ok(!resultado.fullText.includes('[[TEMPLATE:'), 'marcador não pode vazar no texto mostrado ao usuário');
    });

    // ── Caso 4: permitirGeracao=true + isGpt=true (defesa em profundidade —
    //    não deveria acontecer na prática, Workspace já força Gemini, mas
    //    o gate de código não deve depender só disso) ────────────────────
    await test('permitirGeracao=true + isGpt=true: ainda assim não compila (defesa em profundidade)', async () => {
        mockStreamText = `Ok. [[TEMPLATE:${MARKER_JSON}]]`;
        const resultado = await gerarComPossivelTemplate({
            msg: 'confirmo', safeHistory: [], isGpt: true, wsSnapshot: null,
            email: 'teste@softload.com', uid: 'uid-teste-4', user: { email: 'teste@softload.com', uid: 'uid-teste-4' },
            sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
            permitirGeracao: true,
        });
        assert.strictEqual(compilarChamado, 0, '_compilarParaChat não deveria ter sido chamado com isGpt=true');
        assert.strictEqual(resultado.downloadUrl, null);
    });

    // ── Caso 5: sem permitirGeracao no objeto (default) → mesmo
    //    comportamento de false ──────────────────────────────────────────
    await test('permitirGeracao omitido: default é false, não compila', async () => {
        mockStreamText = `Sem marcador nenhum aqui, resposta de suporte normal.`;
        const resultado = await gerarComPossivelTemplate({
            msg: 'como configuro o AdSense?', safeHistory: [], isGpt: false, wsSnapshot: null,
            email: 'teste@softload.com', uid: 'uid-teste-5', user: { email: 'teste@softload.com', uid: 'uid-teste-5' },
            sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
        });
        assert.strictEqual(compilarChamado, 0);
        assert.strictEqual(resultado.downloadUrl, null);
        assert.ok(resultado.fullText.includes('resposta de suporte normal'));
    });

    // ── Caso 6: permitirGeracao=true + _compilarParaChat lança erro (ex:
    //    siteName técnico, heroHtml com tag Blogger) → fullText NUNCA pode
    //    ficar com a promessa de download do modelo sem cumprir (achado real:
    //    antes desta correção só logava e devolvia o texto original) ───────
    await test('_compilarParaChat falha: fullText vira mensagem honesta, não a promessa original', async () => {
        deveFalhar = true;
        try {
            mockStreamText = `Show! ✅ Template em geração! Seu download aparecerá aqui em instantes. [[TEMPLATE:${MARKER_JSON}]]`;
            const resultado = await gerarComPossivelTemplate({
                msg: 'confirmo', safeHistory: [], isGpt: false, wsSnapshot: null,
                email: 'teste@softload.com', uid: 'uid-teste-6', user: { email: 'teste@softload.com', uid: 'uid-teste-6' },
                sendEvent: () => {}, tokensRef: { total: 0, input: 0, output: 0 },
                permitirGeracao: true,
            });
            assert.strictEqual(resultado.downloadUrl, null, 'downloadUrl deveria ficar null quando a compilação falha');
            assert.ok(!resultado.fullText.includes('aparecerá aqui em instantes'), 'promessa de download vazia não pode sobrar no texto');
            assert.ok(!resultado.fullText.includes('[[TEMPLATE:'), 'marcador não pode vazar no texto mostrado ao usuário');
            assert.ok(resultado.fullText.length > 0, 'usuário precisa receber alguma explicação, não texto vazio');
        } finally {
            deveFalhar = false;
        }
    });

    console.log(`\n${passed} passou / ${failed} falhou`);
    if (failed > 0) process.exit(1);
}

main().catch(err => {
    console.error('Erro fatal no test runner:', err);
    process.exit(1);
});
