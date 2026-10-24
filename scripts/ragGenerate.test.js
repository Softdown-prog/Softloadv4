'use strict';

/**
 * Testes de scripts/ragGenerate.js (rodarGeracao) — modelRouter fake
 * injetado (nunca bate na API real), diretório temporário isolado
 * (nunca toca src/solaris/rag/ real). Mesmo padrão de
 * scripts/ragInboxWorker.test.js — não faz parte de `npm test`
 * (scripts/ fica fora do scan de scripts/runTests.js), roda manual:
 *
 * Execute: node scripts/ragGenerate.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { rodarGeracao } = require('./ragGenerate');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeModelRouterQueSempreRetorna(gerarResposta) {
    return {
        async executarTriagem({ prompt }) {
            return JSON.stringify(gerarResposta(prompt));
        },
    };
}

async function run() {
    // A. gera 1 tópico, grava arquivo no dir, sem tocar o catálogo real.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-generate-test-'));
        const modelRouter = fakeModelRouterQueSempreRetorna(() => ({
            categoria: 'topico',
            descricao: 'Descrição técnica de teste com mais de trinta caracteres pra passar no mínimo do validador.',
            componentes: ['x', 'y'],
            keywords: ['z'],
        }));

        const r = await rodarGeracao({ grupo: 'bootstrap5', topico: 'tooltip', modelRouter, dir, catalogoExistente: [] });
        assert('gerou o tópico pedido', r.gerados.includes('bootstrap5-tooltip'));
        // Já grava direto na pasta do grupo (ragOrganizerWorker.determinarPasta).
        assert('arquivo foi gravado em disco na pasta do grupo', fs.existsSync(path.join(dir, 'bootstrap5', 'bootstrap5-tooltip.json')));
        const conteudo = JSON.parse(fs.readFileSync(path.join(dir, 'bootstrap5', 'bootstrap5-tooltip.json'), 'utf8'));
        assert('conteúdo gravado tem id correto', conteudo.id === 'bootstrap5-tooltip');

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // B. tópico com conteúdo inválido (descricao curta) vira erro, nada é gravado.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-generate-test-'));
        const modelRouter = fakeModelRouterQueSempreRetorna(() => ({
            categoria: 'topico', descricao: 'curta', componentes: ['x'], keywords: [],
        }));

        const r = await rodarGeracao({ grupo: 'html5', topico: 'canvas', modelRouter, dir, catalogoExistente: [] });
        assert('descricao curta vira erro', r.erros.length === 1 && r.erros[0].id === 'html5-canvas');
        assert('nada foi gravado em disco', fs.readdirSync(dir).length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // C. tópico parecido demais com uma entrada já existente (injetada) vira
    // "revisar", não é gravado — nunca cria duplicata silenciosa no catálogo.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-generate-test-'));
        const existente = { id: 'bootstrap5-dialog-existente', categoria: 'topico', componentes: ['modal', 'modal-dialog', 'fade'], keywords: ['popup'] };
        const modelRouter = fakeModelRouterQueSempreRetorna(() => ({
            categoria: existente.categoria,
            descricao: 'Descrição de teste propositalmente parecida com uma entrada já existente no catálogo.',
            componentes: existente.componentes,
            keywords: existente.keywords,
        }));

        const r = await rodarGeracao({ grupo: 'bootstrap5', topico: 'modal', modelRouter, dir, catalogoExistente: [existente] });
        assert('entrada parecida demais vira "revisar"', r.revisar.some((rev) => rev.id === 'bootstrap5-modal'));
        assert('nada foi gravado em disco (ficou de fora do catálogo buscável)', fs.readdirSync(dir).length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // D. tópico cujo id já existe no catálogo injetado é pulado, modelo nem é chamado.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-generate-test-'));
        let chamouModelo = false;
        const modelRouter = { async executarTriagem() { chamouModelo = true; return '{}'; } };

        const r = await rodarGeracao({
            grupo: 'javascript', topico: 'fetch', modelRouter, dir,
            catalogoExistente: [{ id: 'javascript-fetch', categoria: 'topico', componentes: ['fetch'], keywords: [] }],
        });
        assert('tópico já existente é pulado', r.pulados.some((p) => p.id === 'javascript-fetch'));
        assert('modelo nunca foi chamado pro tópico pulado', !chamouModelo);
        assert('nada foi gravado em disco', fs.readdirSync(dir).length === 0);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // E. grupo desconhecido lança erro explícito.
    {
        let lancou = false;
        try { await rodarGeracao({ grupo: 'inexistente', modelRouter: {}, dir: os.tmpdir() }); } catch (_) { lancou = true; }
        assert('grupo desconhecido lança erro', lancou);
    }

    // F. tópico desconhecido dentro de um grupo válido lança erro explícito.
    {
        let lancou = false;
        try { await rodarGeracao({ grupo: 'bootstrap5', topico: 'coisa-que-nao-existe', modelRouter: {}, dir: os.tmpdir() }); } catch (_) { lancou = true; }
        assert('topico desconhecido lança erro', lancou);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} ragGenerate: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
