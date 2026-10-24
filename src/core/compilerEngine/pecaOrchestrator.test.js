'use strict';

/**
 * Testes do pecaOrchestrator — resolverPeca() e seus caminhos
 * (dossiê próprio / biblioteca cross-nicho / geração por IA com retry).
 *
 * geminiService.gerarPeca é mockado (nenhuma chamada de rede real) —
 * monkey-patch no export ANTES do primeiro require de pecaOrchestrator.js,
 * já que este faz `const { gerarPeca } = require(...)` uma vez só. O mock
 * é um dispatcher fixo que consome de uma fila mutável (mockQueue),
 * permitindo simular sequências diferentes (sucesso direto, retry,
 * falha dupla) por teste sem precisar re-requerer o módulo.
 *
 * bibliotecaPecas (Firestore-backed, sem credenciais reais neste
 * ambiente de teste) é mockada com o mesmo truque de ordenação: um
 * array em memória substitui a coleção do Firestore, reaproveitando a
 * lógica de matching REAL (_melhorCandidato/_gerarPalavrasChave, ambas
 * puras, exportadas por bibliotecaPecas.js) — só a camada de I/O é
 * fake, o comportamento de busca/registro é o mesmo do código real.
 *
 * Usa "appstore-bulma-mobile" como nicho de teste (mesmo racional de
 * dossieWriter.test.js — nome de nicho real só pra herdar chassis/pageType
 * já válidos em nichoTaxonomy.js). O dossiê real desse nicho é lido e
 * guardado em memória antes do teste sobrescrever com o DOSSIE_BASE de
 * teste, e restaurado no final — nunca perde dado real.
 *
 * Execute: node src/core/compilerEngine/pecaOrchestrator.test.js
 */

const fs = require('fs');
const path = require('path');

const geminiService = require('../../services/geminiService');
let mockQueue = [];
geminiService.gerarPeca = async (...args) => {
    const proximo = mockQueue.shift();
    if (typeof proximo === 'function') return proximo(...args);
    return proximo;
};

const bibliotecaPecas = require('./bibliotecaPecas');
const { _gerarPalavrasChave, _melhorCandidato } = bibliotecaPecas;
let bibliotecaFake = [];
bibliotecaPecas.registrarNaBiblioteca = async (peca, nichoTema) => {
    if (!peca || !peca.id) return { ok: false, erros: ['peça sem id'] };
    bibliotecaFake = bibliotecaFake.filter(p => p.id !== peca.id);
    bibliotecaFake.push({ ...peca, nichoOrigem: nichoTema || null, palavras_chave: _gerarPalavrasChave(peca.descricao, nichoTema, peca.id) });
    return { ok: true, erros: [] };
};
bibliotecaPecas.buscarNaBiblioteca = async (pedido, opts = {}) => {
    const { melhor } = _melhorCandidato(pedido, bibliotecaFake);
    if (!melhor) return null;
    if (opts.excluirNicho && melhor.nichoOrigem === opts.excluirNicho) return null;
    const { palavras_chave, ...peca } = melhor;
    return peca;
};

const { limparCache } = require('./dossieLoader');
const { resolverPeca } = require('./pecaOrchestrator');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const NICHO = 'appstore-bulma-mobile';
const TEMAS_DIR = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');
const CAMINHO_DOSSIE = path.join(TEMAS_DIR, `tema-${NICHO}-dossie.json`);

const conteudoOriginalDossie = fs.existsSync(CAMINHO_DOSSIE) ? fs.readFileSync(CAMINHO_DOSSIE, 'utf-8') : null;

const DOSSIE_BASE = {
    nicho: NICHO,
    versaoDossie: 1,
    chassis: 'blog',
    pageType: 'catalogo-produtos',
    tokensCss: { light_mode: { '--tw-primary': '#111' } },
    pecas: [
        { id: 'header-existente', tipo: 'modulo', protegida: false, domIds: [], css: '.h{}', html: '', js: '', descricao: 'Estiliza o cabeçalho do nicho' },
    ],
};

function _resetDossie() {
    fs.writeFileSync(CAMINHO_DOSSIE, JSON.stringify(DOSSIE_BASE, null, 2), 'utf-8');
    limparCache();
}

// Limpa a biblioteca fake (array em memória) entre casos de teste —
// pra uma peça registrada num teste não aparecer no keyword-match do
// próximo (achado real, da época do arquivo local: "widget" genérico
// de um teste colidia com o pedido do teste seguinte).
function _resetBiblioteca() {
    bibliotecaFake = [];
}

async function run() {
    // A. jaExisteNoDossie — pedido bate por keyword (2+ palavras) com peça já existente.
    {
        _resetDossie();
        _resetBiblioteca();
        const r = await resolverPeca(NICHO, { pedido: 'preciso ajustar o cabeçalho existente do nicho' });
        assert('dossiê: ok=true', r.ok === true, JSON.stringify(r.erros));
        assert('dossiê: origem="dossie"', r.origem === 'dossie');
        assert('dossiê: devolve a peça existente', r.peca && r.peca.id === 'header-existente');
    }

    // A2. Regressão do bug: 1 palavra genérica coincidindo por acaso NÃO
    // pode "resolver" um pedido contra o dossiê — precisa cair pra
    // biblioteca/IA em vez de devolver a peça errada silenciosamente.
    // "nicho" é a única palavra de _keywordsDePeca('header-existente') que
    // aparece no pedido abaixo (1 hit, abaixo do piso de 2).
    {
        _resetDossie();
        _resetBiblioteca();
        mockQueue = [{
            valido: true, erros: [], peca: {
                tipo: 'modulo', protegida: false, domIds: [],
                css: '.novo{color:var(--tw-primary)}', html: '', js: '',
                descricao: 'Peça de teste gerada porque o match fraco não deve resolver',
            },
        }];
        const r = await resolverPeca(NICHO, { pedido: 'quero uma peça nova pra qualquer coisa do nicho' });
        assert('match fraco (1 palavra): NÃO resolve pelo dossiê', r.origem !== 'dossie', JSON.stringify(r));
        assert('match fraco: cai pra geração via IA de verdade', r.origem === 'ia-gerada', JSON.stringify(r));
    }

    // B. buscarNaBiblioteca — peça registrada por OUTRO nicho é encontrada
    // e persistida no dossiê do nicho pedinte.
    {
        _resetDossie();
        _resetBiblioteca();
        const { registrarNaBiblioteca } = require('./bibliotecaPecas');
        await registrarNaBiblioteca({
            id: 'teste-countdown-promo-widget',
            tipo: 'widget',
            protegida: false,
            domIds: ['cd-widget'],
            css: '.cd-widget {}',
            html: '<div id="cd-widget"></div>',
            js: 'const cdWidgetX = 1;',
            descricao: 'Widget de contagem regressiva promocional',
        }, 'viral-magazine');

        const r = await resolverPeca(NICHO, { pedido: 'quero um widget de contagem regressiva promocional' });
        assert('biblioteca: ok=true', r.ok === true, JSON.stringify(r.erros));
        assert('biblioteca: origem="biblioteca"', r.origem === 'biblioteca');
        assert('biblioteca: zero chamadas à IA', mockQueue.length === 0);

        const dossieDepois = JSON.parse(fs.readFileSync(CAMINHO_DOSSIE, 'utf-8'));
        assert('biblioteca: peça persistida no dossiê do nicho pedinte', dossieDepois.pecas.some(p => p.id === 'teste-countdown-promo-widget'));
    }

    // C. Geração por IA — sucesso na primeira tentativa.
    {
        _resetDossie();
        _resetBiblioteca();
        mockQueue = [{
            valido: true, erros: [], peca: {
                tipo: 'widget', protegida: false, domIds: ['trend-widget'],
                css: '.trend-widget{color:var(--tw-primary)}',
                html: '<div id="trend-widget"></div>',
                js: 'const trendWidgetInit = 1;',
                descricao: 'Widget de posts em alta agora',
            },
        }];

        const r = await resolverPeca(NICHO, { pedido: 'gere um widget de posts em alta agora, trending' });
        assert('IA sucesso 1ª tentativa: ok=true', r.ok === true, JSON.stringify(r.erros));
        assert('IA sucesso 1ª tentativa: origem="ia-gerada"', r.origem === 'ia-gerada');
        assert('IA sucesso 1ª tentativa: id atribuído pelo orquestrador', typeof r.peca.id === 'string' && r.peca.id.length > 0);

        const dossieDepois = JSON.parse(fs.readFileSync(CAMINHO_DOSSIE, 'utf-8'));
        assert('IA sucesso: peça persistida no dossiê', dossieDepois.pecas.some(p => p.id === r.peca.id));
    }

    // D. Geração por IA — 1ª tentativa reprovada (var CSS órfã), retry com
    // erro no prompt corrige na 2ª.
    {
        _resetDossie();
        _resetBiblioteca();
        mockQueue = [
            {
                valido: true, erros: [], peca: {
                    tipo: 'modulo', protegida: false, domIds: [],
                    css: '.z{color:var(--nunca-declarada-no-teste)}', html: '', js: '',
                    descricao: 'Módulo de teste com var órfã',
                },
            },
            {
                valido: true, erros: [], peca: {
                    tipo: 'modulo', protegida: false, domIds: [],
                    css: '.z{color:var(--tw-primary)}', html: '', js: '',
                    descricao: 'Módulo de teste corrigido',
                },
            },
        ];

        const r = await resolverPeca(NICHO, { pedido: 'módulo de teste de retry com var css órfã' });
        assert('IA retry: ok=true após 2ª tentativa', r.ok === true, JSON.stringify(r.erros));
        assert('IA retry: consumiu as 2 respostas mockadas', mockQueue.length === 0);
    }

    // E. Geração por IA — reprovada nas 2 tentativas, nada é persistido.
    {
        _resetDossie();
        _resetBiblioteca();
        const pecaInvalida = () => ({
            valido: true, erros: [], peca: {
                tipo: 'modulo', protegida: false, domIds: [],
                css: '.w{color:var(--outra-var-orfa-teste)}', html: '', js: '',
                descricao: 'Sempre inválida',
            },
        });
        mockQueue = [pecaInvalida(), pecaInvalida()];

        const pecasAntes = JSON.parse(fs.readFileSync(CAMINHO_DOSSIE, 'utf-8')).pecas.length;
        const r = await resolverPeca(NICHO, { pedido: 'peça de teste que sempre falha validação' });
        assert('IA falha dupla: ok=false', r.ok === false);
        assert('IA falha dupla: erros não vazio', r.erros.length > 0);

        const pecasDepois = JSON.parse(fs.readFileSync(CAMINHO_DOSSIE, 'utf-8')).pecas.length;
        assert('IA falha dupla: nada foi persistido no dossiê', pecasAntes === pecasDepois);
    }

    // F. Geração por IA usando um token GLOBAL do chassis (--sl-primary-rgb,
    // --sl-card-bg etc.) — não é do tokensCss do próprio nicho, mas é
    // injetado sitewide por designTokensCss.js/template_*.xml pra TODO
    // nicho. Achado real: sem TOKENS_GLOBAIS_CHASSIS em _tokensExternos,
    // qualquer peça nova usando esse padrão idiomático (usado na maioria
    // dos nichos) era rejeitada por engano como "variável CSS órfã".
    {
        _resetDossie();
        _resetBiblioteca();
        mockQueue = [{
            valido: true, erros: [], peca: {
                tipo: 'modulo', protegida: false, domIds: [],
                css: '.g{background:rgba(var(--sl-primary-rgb),.1);color:var(--sl-card-bg)}', html: '', js: '',
                descricao: 'Módulo de teste usando tokens globais do chassis',
            },
        }];

        const r = await resolverPeca(NICHO, { pedido: 'módulo de teste usando token global do chassis sl-primary-rgb' });
        assert('token global do chassis: ok=true (não é órfã)', r.ok === true, JSON.stringify(r.erros));
    }
}

run().finally(() => {
    if (conteudoOriginalDossie !== null) {
        fs.writeFileSync(CAMINHO_DOSSIE, conteudoOriginalDossie, 'utf-8');
    } else if (fs.existsSync(CAMINHO_DOSSIE)) {
        fs.unlinkSync(CAMINHO_DOSSIE);
    }
    if (fs.existsSync(`${CAMINHO_DOSSIE}.tmp`)) fs.unlinkSync(`${CAMINHO_DOSSIE}.tmp`);
    limparCache();
    _resetBiblioteca();

    console.log(`\n${failed === 0 ? '✅' : '❌'} pecaOrchestrator: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
});
