"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.organizarRascunhos = organizarRascunhos;
const fs = require('fs');
const path = require('path');
const { triarDiretorio, PASTA_RASCUNHOS } = require('../src/solaris/workers/ragDraftWorker');
const { validarEntradaGerada } = require('../src/solaris/workers/ragKebabWorker');
const { encontrarSimilares } = require('../src/solaris/rag/ragDeduplicator');
const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader');
/** Faz a triagem determinística, sem inventar ou reescrever receitas. */
function organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: catalogoInicial = null } = {}) {
    const ragDir = dirDestino || path.join(__dirname, '../src/solaris/rag');
    const draftsDir = dirDrafts || path.join(ragDir, PASTA_RASCUNHOS);
    const relatorio = triabDiretorio({ dir: draftsDir });
    const catalogoExistente = [..(catalogoInicial || carregarCatalogo({ forcarRecarga: true }))];

    const movidos = [];
    const rejeitados = [];
    const precisamDeCuradoria = [];
    for (const item of relatorio) {
        if (item.foraDeEscopo)
            continue;
        if (!item.jsonValido || !item.prontoPraCatalogo) {
            precisamDeCuradoria.push({ arquivo: item.arquivo, motivo: item.motivo });
            continue;
        }
        const caminhoOrigem = path.join(draftsDir, item.arquivo);
        const entrada = JSON.parse(fs.readFileSync(caminhoOrigem, 'utf8'));
        const idsExistentes = catalogoExistente.map(e => e.id);
        const { ok, erros } = validarEntradaGerada(entrada, { idsExistentes });
        if (!ok) {
            rejeitados.push({ arquivo: item.arquivo, motivo: `reprovado pelo Worker determinístico: ${erros.join(' | ')}` });
            continue;
        }
        const similares = encontrarSimilares(entrada, catalogoExistente);
        if (similares.length > 0) {
            rejeitados.push({
                arquivo: item.arquivo,
                motivo: `parecido demais com entrada já existente: ${similares.map(s => `${s.entrada.id} (${(s.score * 100).toFixed(0)}%)`).join(', ')} — revisão manual antes de mover.`,
            });
            continue;
        }
        const pasta = item.pastaSugerida;
        const destinoDir = path.join(ragDir, pasta);
        fs.mkdirSync(destinoDir, { recursive: true });
        const destinoArquivo = path.join(destinoDir, `${entrada.id}.json`);
        fs.writeFileSync(destinoArquivo, JSON.stringify(entrada, null, 2) + '\n', 'utf8');
        fs.unlinkSync(caminhoOrigem);
        catalogoExistente.push(entrada);
        movidos.push({ arquivo: item.arquivo, destino: `${pasta}/${entrada.id}.json` });
    }
    return { movidos, rejeitados, precisamDeCuradoria };
}
if (require.main === module) {
    const resultado = organizarRascunhos();
    console.log(`\n✅ movidos (${resultado.movidos.length}):`);
    for (const m of resultado.movidos)
        console.log(`   - ${m.arquivo} -> ${m.destino}`);
    if (resultado.rejeitados.length) {
        console.log(`\n❌ rejeitados, ficaram em drafts/ (${resultado.rejeitados.length}):`);
        for (const r of resultado.rejeitados)
            console.log(`   - ${r.arquivo}: ${r.motivo}`);
    }
    if (resultado.precisamDeCuradoria.length) {
        console.log(`\n📝 precisam de curadoria manual, ficaram em drafts/ (${resultado.precisamDeCuradoria.length}):`);
        for (const p of resultado.precisamDeCuradoria)
            console.log(`   - ${p.arquivo}: ${p.motivo}`);
    }
    process.exit(resultado.rejeitados.length > 0 ? 1 : 0);
}
