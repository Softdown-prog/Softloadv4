'use strict';

/**
 * Testes de ragOrganizerWorker.js — determinarPasta puro testado
 * direto; organizarDiretorio testado contra diretório temporário
 * isolado (nunca toca o catálogo real).
 *
 * Execute: node src/solaris/workers/ragOrganizerWorker.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { determinarPasta, organizarDiretorio, PASTA_PADRAO, PASTA_PRESETS } = require('./ragOrganizerWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. determinarPasta — campo "pasta" explícito sempre vence.
    {
        const r = determinarPasta({ id: 'bootstrap5-navbar', pasta: 'Front End' });
        assert('campo "pasta" explícito vence tudo', r.pasta === 'front-end', r.pasta);
    }

    // B. determinarPasta — id no formato "<grupo>-<topico>" vira o grupo.
    {
        const r = determinarPasta({ id: 'bootstrap5-navbar', categoria: 'topico' });
        assert('grupo derivado do prefixo do id', r.pasta === 'bootstrap5', r.pasta);
    }
    {
        const r = determinarPasta({ id: 'flask-blueprints', categoria: 'topico' });
        assert('grupo "flask" derivado do prefixo', r.pasta === 'flask', r.pasta);
    }

    // C. determinarPasta — id igual ao próprio nome do grupo (referência
    // do framework) cai na mesma pasta dos tópicos dele.
    {
        const r = determinarPasta({ id: 'bootstrap5', categoria: 'framework' });
        assert('referência do framework cai no próprio grupo', r.pasta === 'bootstrap5', r.pasta);
    }

    // D. determinarPasta — preset vira pasta dedicada.
    {
        const r = determinarPasta({ id: 'flask-saas-glassmorphism', categoria: 'preset' });
        assert('categoria preset vira pasta "presets"', r.pasta === PASTA_PRESETS, r.pasta);
    }

    // E. determinarPasta — sem grupo reconhecido usa a própria categoria.
    {
        const r = determinarPasta({ id: 'meu-projeto-banco', categoria: 'banco' });
        assert('categoria "banco" (sem grupo bater) vira a própria pasta', r.pasta === 'banco', r.pasta);
    }
    {
        const r = determinarPasta({ id: 'agencia-digital', categoria: 'empresa' });
        assert('categoria "empresa" vira a própria pasta', r.pasta === 'empresa', r.pasta);
    }

    // F. determinarPasta — sem id nem categoria cai em PASTA_PADRAO, nunca lança.
    {
        assert('entrada vazia cai em PASTA_PADRAO', determinarPasta({}).pasta === PASTA_PADRAO);
        assert('entrada null cai em PASTA_PADRAO, não lança', determinarPasta(null).pasta === PASTA_PADRAO);
    }

    // G. organizarDiretorio — dry-run (aplicar:false) não move nada, só relata.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizer-test-'));
        fs.writeFileSync(path.join(dir, 'bootstrap5-navbar.json'), JSON.stringify({ id: 'bootstrap5-navbar', categoria: 'topico' }));
        fs.writeFileSync(path.join(dir, 'flask.json'), JSON.stringify({ id: 'flask', categoria: 'backend' }));

        const relatorio = organizarDiretorio({ dir, aplicar: false });
        assert('dry-run: cobre os 2 arquivos', relatorio.length === 2);
        assert('dry-run: nada foi movido de verdade', fs.existsSync(path.join(dir, 'bootstrap5-navbar.json')) && fs.existsSync(path.join(dir, 'flask.json')));
        assert('dry-run: nenhuma subpasta criada', !fs.existsSync(path.join(dir, 'bootstrap5')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // H. organizarDiretorio — aplicar:true move de verdade, preserva conteúdo.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizer-test-'));
        fs.writeFileSync(path.join(dir, 'bootstrap5-navbar.json'), JSON.stringify({ id: 'bootstrap5-navbar', categoria: 'topico', x: 1 }));
        fs.writeFileSync(path.join(dir, 'bootstrap5.json'), JSON.stringify({ id: 'bootstrap5', categoria: 'framework' }));
        fs.writeFileSync(path.join(dir, 'flask.json'), JSON.stringify({ id: 'flask', categoria: 'backend' }));

        const relatorio = organizarDiretorio({ dir, aplicar: true });
        assert('aplicar: bootstrap5-navbar.json movido pra bootstrap5/', fs.existsSync(path.join(dir, 'bootstrap5', 'bootstrap5-navbar.json')));
        assert('aplicar: bootstrap5.json (referência) também vai pra bootstrap5/', fs.existsSync(path.join(dir, 'bootstrap5', 'bootstrap5.json')));
        assert('aplicar: flask.json vai pra flask/', fs.existsSync(path.join(dir, 'flask', 'flask.json')));
        assert('aplicar: nada sobrou no topo', !fs.existsSync(path.join(dir, 'bootstrap5-navbar.json')) && !fs.existsSync(path.join(dir, 'flask.json')));

        const conteudo = JSON.parse(fs.readFileSync(path.join(dir, 'bootstrap5', 'bootstrap5-navbar.json'), 'utf8'));
        assert('aplicar: conteúdo preservado', conteudo.x === 1);

        const itemNavbar = relatorio.find((r) => r.arquivo === 'bootstrap5-navbar.json');
        assert('relatório: item aplicado marca aplicado=true', itemNavbar.aplicado === true && itemNavbar.ok === true);

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // I. organizarDiretorio — conflito de destino já existente não sobrescreve.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizer-test-'));
        fs.mkdirSync(path.join(dir, 'flask'));
        fs.writeFileSync(path.join(dir, 'flask', 'flask.json'), JSON.stringify({ id: 'flask-original', categoria: 'backend' }));
        fs.writeFileSync(path.join(dir, 'flask.json'), JSON.stringify({ id: 'flask-novo', categoria: 'backend' }));

        const relatorio = organizarDiretorio({ dir, aplicar: true });
        const item = relatorio.find((r) => r.arquivo === 'flask.json');
        assert('conflito: não aplica', item.aplicado === false);
        assert('conflito: ok vira false', item.ok === false);
        assert('conflito: erro explícito', item.erros.some((e) => e.includes('conflito')));
        assert('conflito: arquivo original do topo não foi apagado', fs.existsSync(path.join(dir, 'flask.json')));
        assert('conflito: arquivo de destino preservado', JSON.parse(fs.readFileSync(path.join(dir, 'flask', 'flask.json'), 'utf8')).id === 'flask-original');

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // J. organizarDiretorio — JSON inválido não lança, vira erro no relatório.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizer-test-'));
        fs.writeFileSync(path.join(dir, 'quebrado.json'), '{ isso não é json');

        let lancou = false;
        let relatorio = null;
        try { relatorio = organizarDiretorio({ dir, aplicar: true }); } catch (_) { lancou = true; }
        assert('JSON inválido não lança', !lancou);
        const item = relatorio.find((r) => r.arquivo === 'quebrado.json');
        assert('JSON inválido vira erro, não aplicado', item.ok === false && item.aplicado === false && item.erros.some((e) => e.includes('JSON inválido')));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // K. organizarDiretorio — nunca mexe em arquivo já dentro de subpasta
    // nem em rag/drafts/ (só varre o TOPO do diretório).
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizer-test-'));
        fs.mkdirSync(path.join(dir, 'drafts'));
        fs.writeFileSync(path.join(dir, 'drafts', 'rascunho.json'), JSON.stringify({ semId: true }));
        fs.mkdirSync(path.join(dir, 'ja-organizado'));
        fs.writeFileSync(path.join(dir, 'ja-organizado', 'algo.json'), JSON.stringify({ id: 'algo' }));

        const relatorio = organizarDiretorio({ dir, aplicar: true });
        assert('não varre subpastas — relatório vazio (só tinha subpastas, nada no topo)', relatorio.length === 0);
        assert('drafts/ intocado', fs.existsSync(path.join(dir, 'drafts', 'rascunho.json')));
        assert('subpasta já organizada intocada', fs.existsSync(path.join(dir, 'ja-organizado', 'algo.json')));

        fs.rmSync(dir, { recursive: true, force: true });
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} ragOrganizerWorker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
