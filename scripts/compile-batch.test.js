'use strict';

/**
 * Testes de scripts/compile-batch.js (compilarLote) -- nunca toca
 * manifests/ real nem grava fora de diretórios temporários isolados.
 * Mesmo padrão de scripts/ragGenerate.test.js -- não faz parte de
 * `npm test` (scripts/ fica fora do scan de scripts/runTests.js), roda
 * manual:
 *
 * Execute: node scripts/compile-batch.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { compilarLote } = require('./compile-batch');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function manifestoMinimo(overrides = {}) {
    return {
        siteName: 'Site de Teste',
        nichoTema: 'saas-nexus',
        colorPreset: 'tech-blue',
        ...overrides,
    };
}

async function run() {
    // A. compila todo *.json do diretório, grava .xml correspondente em outDir.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-batch-test-'));
        const outDir = path.join(dir, 'saida');
        fs.writeFileSync(path.join(dir, 'site-a.json'), JSON.stringify(manifestoMinimo()), 'utf8');

        const { compilados, erros } = compilarLote({ dir, outDir });

        assert('compilou o manifesto', compilados.length === 1 && erros.length === 0, JSON.stringify(erros));
        assert('gravou o .xml de saída', fs.existsSync(path.join(outDir, 'site-a.xml')));
        const xml = fs.readFileSync(path.join(outDir, 'site-a.xml'), 'utf8');
        assert('xml gravado não está vazio e parece HTML/XML real', xml.includes('<html'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // B. manifesto inválido (falta campo obrigatório) vira erro, não aborta o lote.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-batch-test-'));
        const outDir = path.join(dir, 'saida');
        fs.writeFileSync(path.join(dir, 'bom.json'), JSON.stringify(manifestoMinimo()), 'utf8');
        // siteName é o único campo genuinamente obrigatório em
        // validarManifesto() -- nichoTema tem fallback e não basta pra
        // invalidar o manifesto.
        fs.writeFileSync(path.join(dir, 'ruim.json'), JSON.stringify({ nichoTema: 'saas-nexus' }), 'utf8');

        const { compilados, erros } = compilarLote({ dir, outDir });

        assert('manifesto bom ainda compila mesmo com outro inválido no lote', compilados.some((c) => c.manifesto === 'bom.json'));
        assert('manifesto inválido vira erro (não trava o processo)', erros.some((e) => e.manifesto === 'ruim.json'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // C. JSON malformado (sintaxe quebrada) vira erro por arquivo, não trava o lote.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-batch-test-'));
        const outDir = path.join(dir, 'saida');
        fs.writeFileSync(path.join(dir, 'bom.json'), JSON.stringify(manifestoMinimo()), 'utf8');
        fs.writeFileSync(path.join(dir, 'sintaxe-quebrada.json'), '{ nao fecha', 'utf8');

        const { compilados, erros } = compilarLote({ dir, outDir });

        assert('json malformado vira erro', erros.some((e) => e.manifesto === 'sintaxe-quebrada.json'));
        assert('manifesto bom ainda compila', compilados.some((c) => c.manifesto === 'bom.json'));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // D. diretório sem nenhum .json: nem erro, nem compilado -- listas vazias.
    {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'compile-batch-test-'));
        const outDir = path.join(dir, 'saida');

        const { compilados, erros } = compilarLote({ dir, outDir });
        assert('diretório vazio: nenhum compilado', compilados.length === 0);
        assert('diretório vazio: nenhum erro', erros.length === 0);
        assert('diretório de saída não é criado à toa quando não há nada pra compilar', !fs.existsSync(outDir));

        fs.rmSync(dir, { recursive: true, force: true });
    }

    // E. diretório de manifestos inexistente lança erro explícito.
    {
        let lancou = false;
        try {
            compilarLote({ dir: '/caminho/que/nao/existe', outDir: '/tmp/nao-importa' });
        } catch (_) { lancou = true; }
        assert('diretório de manifestos inexistente lança erro', lancou);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} compile-batch: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
