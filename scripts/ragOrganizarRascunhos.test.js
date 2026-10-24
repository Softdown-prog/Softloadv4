'use strict';

/**
 * Testes de scripts/ragOrganizarRascunhos.js (organizarRascunhos) —
 * dirDrafts/dirDestino/catalogoExistente injetáveis, nunca toca
 * src/solaris/rag/ real. Mesmo padrão de scripts/ragGenerate.test.js —
 * não faz parte de `npm test` (scripts/ fica fora do scan de
 * scripts/runTests.js), roda manual:
 *
 * Execute: node scripts/ragOrganizarRascunhos.test.js
 */

const fs   = require('fs');
const os   = require('os');
const path = require('path');

const { organizarRascunhos } = require('./ragOrganizarRascunhos');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function _novoAmbiente() {
    const dirDestino = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizar-test-dest-'));
    const dirDrafts  = fs.mkdtempSync(path.join(os.tmpdir(), 'solaris-rag-organizar-test-drafts-'));
    return { dirDestino, dirDrafts };
}

function _escreverRascunho(dirDrafts, nomeArquivo, conteudo) {
    fs.writeFileSync(path.join(dirDrafts, nomeArquivo), typeof conteudo === 'string' ? conteudo : JSON.stringify(conteudo, null, 2), 'utf8');
}

async function run() {
    // A. rascunho já no formato de catálogo é movido pra pasta certa,
    // some de drafts/, e vira JSON válido no destino.
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        _escreverRascunho(dirDrafts, 'bootstrap5-novo-componente.json', {
            id: 'bootstrap5-novo-componente', slug: 'bootstrap5-novo-componente',
            categoria: 'topico',
            descricao: 'Descrição técnica de teste com mais de trinta caracteres pra passar no mínimo do validador.',
            componentes: ['x', 'y'], keywords: ['z'],
        });

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [] });
        assert('movido:true', r.movidos.length === 1 && r.movidos[0].arquivo === 'bootstrap5-novo-componente.json');
        assert('destino segue convenção <pasta>/<id>.json', r.movidos[0].destino === 'bootstrap5/bootstrap5-novo-componente.json');
        assert('arquivo real existe no destino', fs.existsSync(path.join(dirDestino, 'bootstrap5', 'bootstrap5-novo-componente.json')));
        assert('arquivo some de drafts/', !fs.existsSync(path.join(dirDrafts, 'bootstrap5-novo-componente.json')));
        assert('rejeitados/precisamDeCuradoria vazios', r.rejeitados.length === 0 && r.precisamDeCuradoria.length === 0);

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // B. rascunho de schema totalmente divergente (texto livre, tipo os
    // rascunhos Django/Flask reais) NUNCA é movido — fica em drafts/,
    // reportado como precisa de curadoria manual.
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        _escreverRascunho(dirDrafts, 'django-framework-overview', {
            topic: 'django-framework-overview', category: 'python-web-frameworks',
            description: 'Visão geral do Django.',
        });

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [] });
        assert('nada foi movido', r.movidos.length === 0);
        assert('arquivo continua em drafts/', fs.existsSync(path.join(dirDrafts, 'django-framework-overview')));
        assert('reportado em precisamDeCuradoria', r.precisamDeCuradoria.some((p) => p.arquivo === 'django-framework-overview'));

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // C. rascunho com id já existente no catálogo é rejeitado pelo Worker
    // determinístico — fica em drafts/, nunca sobrescreve silenciosamente.
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        _escreverRascunho(dirDrafts, 'flask-ja-existe.json', {
            id: 'flask-ja-existe', slug: 'flask-ja-existe', categoria: 'topico',
            descricao: 'Descrição técnica de teste com mais de trinta caracteres pra passar no mínimo do validador.',
            componentes: ['x'], keywords: ['y'],
        });
        const existente = { id: 'flask-ja-existe', categoria: 'topico', componentes: ['a'], keywords: [] };

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [existente] });
        assert('nada foi movido', r.movidos.length === 0);
        assert('rejeitado com motivo do Worker', r.rejeitados.some((rej) => rej.arquivo === 'flask-ja-existe.json' && /já existe no catálogo/.test(rej.motivo)));
        assert('arquivo continua em drafts/', fs.existsSync(path.join(dirDrafts, 'flask-ja-existe.json')));

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // D. rascunho parecido demais com entrada já existente é rejeitado
    // (deduplicador) — fica em drafts/ pra revisão humana, nunca move sozinho.
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        const existente = { id: 'bootstrap5-dialog-existente', categoria: 'topico', componentes: ['modal', 'modal-dialog', 'fade'], keywords: ['popup'] };
        _escreverRascunho(dirDrafts, 'bootstrap5-parecido.json', {
            id: 'bootstrap5-parecido', slug: 'bootstrap5-parecido', categoria: existente.categoria,
            descricao: 'Descrição de teste propositalmente parecida com uma entrada já existente no catálogo.',
            componentes: existente.componentes, keywords: existente.keywords,
        });

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [existente] });
        assert('nada foi movido', r.movidos.length === 0);
        assert('rejeitado por similaridade', r.rejeitados.some((rej) => rej.arquivo === 'bootstrap5-parecido.json' && /parecido demais/.test(rej.motivo)));

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // E. schema parcial (só alguns campos de catálogo presentes) também
    // fica em precisamDeCuradoria, não em rejeitados — motivo diferente,
    // mesma consequência (nunca movido sozinho).
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        _escreverRascunho(dirDrafts, 'parcial.json', {
            id: 'algo-parcial', categoria: 'topico', descricao: 'só tem id/categoria/descricao, faltam componentes/exemplos/keywords.',
        });

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [] });
        assert('nada foi movido', r.movidos.length === 0);
        assert('reportado em precisamDeCuradoria', r.precisamDeCuradoria.some((p) => p.arquivo === 'parcial.json'));

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // F. arquivo fora de escopo (extensão que não é candidata, ex .md
    // real que existe hoje em drafts/) não aparece em NENHUM dos 3
    // relatórios — já é coberto pela triagem, não duplica ruído aqui.
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        fs.writeFileSync(path.join(dirDrafts, 'Documentacao.md'), '# nota\nnão é candidato a catálogo.', 'utf8');

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [] });
        assert('nada movido', r.movidos.length === 0);
        assert('não aparece em rejeitados', !r.rejeitados.some((x) => x.arquivo === 'Documentacao.md'));
        assert('não aparece em precisamDeCuradoria', !r.precisamDeCuradoria.some((x) => x.arquivo === 'Documentacao.md'));
        assert('arquivo .md continua intacto em drafts/', fs.existsSync(path.join(dirDrafts, 'Documentacao.md')));

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    // G. múltiplos rascunhos prontos na mesma rodada — o 2º já enxerga o
    // 1º como "existente" pra dedup/unicidade de id (mesmo comportamento
    // acumulativo de rodarGeracao em ragGenerate.js).
    {
        const { dirDestino, dirDrafts } = _novoAmbiente();
        _escreverRascunho(dirDrafts, 'a.json', {
            id: 'flask-primeiro', slug: 'flask-primeiro', categoria: 'topico',
            descricao: 'Descrição técnica de teste com mais de trinta caracteres pra passar no mínimo do validador.',
            componentes: ['a', 'b'], keywords: ['x'],
        });
        _escreverRascunho(dirDrafts, 'b.json', {
            id: 'flask-primeiro', slug: 'flask-primeiro', categoria: 'topico',
            descricao: 'Descrição técnica de teste duplicando o id do primeiro rascunho de propósito.',
            componentes: ['a', 'b'], keywords: ['x'],
        });

        const r = organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: [] });
        assert('só 1 dos 2 foi movido (id duplicado entre rascunhos)', r.movidos.length === 1);
        assert('o outro foi rejeitado por id já existente', r.rejeitados.length === 1);

        fs.rmSync(dirDestino, { recursive: true, force: true });
        fs.rmSync(dirDrafts, { recursive: true, force: true });
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} ragOrganizarRascunhos: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
