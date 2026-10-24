'use strict';

// Migração RAG Etapa 1 — a pasta legada permanece para rollback, mas a
// hierarquia é a fonte ativa. Este teste protege a remoção futura (Etapa 2).
const assert = require('assert');
const fs     = require('fs');
const path   = require('path');

const RAG_BASE = path.join(__dirname, '../../../rag');
const LEGADO   = path.join(RAG_BASE, 'ia-de-balcao');
const NOVO     = path.join(RAG_BASE, 'rag-ia-suporte/ia-de-balcao');
const {
    buscarRagRelevante,
} = require('./chatRag');

function listarDocumentos(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(item => {
        const full = path.join(dir, item.name);
        if (item.isDirectory()) return listarDocumentos(full, base);
        if (item.name === 'index.json') return [];
        return [path.relative(base, full).replace(/\\/g, '/')];
    });
}

const legados = listarDocumentos(LEGADO).sort();
const novos   = new Set(listarDocumentos(NOVO));

// 1. Todos os documentos legados, incluindo os 33 da pendência, já têm cópia
// na estrutura de destino; ainda não removemos a origem nesta etapa.
assert.ok(fs.existsSync(LEGADO), 'a pasta legada deve permanecer até a Etapa 2');
assert.deepStrictEqual(
    legados.filter(rel => !novos.has(rel)),
    [],
    'todo documento legado deve existir na hierarquia'
);

// 2. A própria estrutura de destino não pode repetir caminhos de documento.
const listaNova = [...novos];
assert.strictEqual(
    listaNova.length,
    new Set(listaNova).size,
    'a estrutura hierárquica não pode conter documentos duplicados'
);

// 3. A pesquisa direta carrega um dos novos documentos antes ausentes.
const resultados = buscarRagRelevante('como criar toast e alertas Bootstrap no Blogger?');
assert.ok(
    resultados.some(item => item.entry._cacheKey.endsWith('blogger-ui/ia-balcao-toasts-alertas.json')),
    'a busca deve encontrar o documento migrado de toasts e alertas'
);

// 4. Onde a fonte antiga e a hierárquica coexistem, a cópia hierárquica tem
// prioridade e o mesmo documento não aparece duas vezes na pesquisa.
const grade = buscarRagRelevante('grid sidebar col-lg-8 bootstrap grid');
const repetidos = grade.filter(item =>
    item.entry._cacheKey === 'ia-de-balcao/blogger-layout/ia-balcao-grid-sidebar-condicional.json'
);
assert.ok(
    repetidos.length === 1 &&
    repetidos[0].entry._dir.includes(path.join('rag-ia-suporte', 'ia-de-balcao')),
    'a pesquisa deve priorizar uma única cópia hierárquica do documento'
);

console.log('✅ chatRag migration: documentos migrados, sem duplicatas e pesquisa hierárquica OK');
