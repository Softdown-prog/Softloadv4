'use strict';

// ============================================================
// npm run rag:organizar
// ============================================================
// Pega candidatos de rag/drafts/ que JÁ ESTÃO no formato de catálogo
// (ver workers/ragDraftWorker.js — triarDiretorio/prontoPraCatalogo:
// tem id/categoria/descricao + componentes-ou-exemplos + keywords) e
// só move pra pasta certa (ragOrganizerWorker.determinarPasta) — nunca
// gera, reescreve ou inventa conteúdo. Isso é papel de
// scripts/ragGenerate.js (com IA), pra quando o rascunho é texto livre
// de schema totalmente divergente — que é a maioria dos casos reais
// hoje (ver auditoria desta sessão: rascunhos Django/Flask chegam como
// {topic,category,description,framework,...}, não
// {id,slug,categoria,descricao,...}). Rascunho assim NUNCA é forçado
// pro catálogo aqui: fica em drafts/, reportado como "precisa de
// curadoria manual ou virar fonte pro pipeline de IA".
//
// Mesmo gate de sempre antes de qualquer coisa entrar no catálogo
// buscável — reusado de scripts/ragGenerate.js, não reinventado:
//   1. ragKebabWorker.validarEntradaGerada — Worker determinístico
//      (kebab-case, slug===id, campos obrigatórios, id não duplicado).
//   2. ragDeduplicator.encontrarSimilares — nunca move sozinho uma
//      entrada parecida demais com uma já existente; fica em drafts/
//      pra revisão humana.
//
// `organizarRascunhos` é a função testável (dirDrafts/dirDestino/
// catalogoExistente injetáveis, nunca toca src/solaris/rag/ real em
// teste) — o bloco `require.main === module` é só a casca de CLI.
// ============================================================

const fs   = require('fs');
const path = require('path');

const { triarDiretorio, PASTA_RASCUNHOS } = require('../src/solaris/workers/ragDraftWorker');
const { validarEntradaGerada } = require('../src/solaris/workers/ragKebabWorker');
const { encontrarSimilares } = require('../src/solaris/rag/ragDeduplicator');
const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader');

/**
 * Varre `dirDrafts` (default rag/drafts/ real) via
 * ragDraftWorker.triarDiretorio e move pra `dirDestino` (default rag/
 * real) só os rascunhos prontos-pra-catálogo que também passem em
 * validarEntradaGerada + encontrarSimilares. Todo o resto fica onde
 * está, reportado com o motivo — nunca movido às cegas.
 *
 * @param {object} [opts]
 * @param {string} [opts.dirDrafts]          default: rag/drafts/ real
 * @param {string} [opts.dirDestino]         default: rag/ real (pasta-pai das subpastas de categoria)
 * @param {Array}  [opts.catalogoExistente]  injetável pra teste — default: catálogo real via carregarCatalogo
 * @returns {{ movidos: Array<{arquivo,destino}>, rejeitados: Array<{arquivo,motivo}>, precisamDeCuradoria: Array<{arquivo,motivo}> }}
 */
function organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: catalogoInicial = null } = {}) {
    const ragDir    = dirDestino || path.join(__dirname, '../src/solaris/rag');
    const draftsDir = dirDrafts  || path.join(ragDir, PASTA_RASCUNHOS);

    const relatorio = triarDiretorio({ dir: draftsDir });
    const catalogoExistente = [...(catalogoInicial || carregarCatalogo({ forcarRecarga: true }))];

    const movidos = [];
    const rejeitados = [];
    const precisamDeCuradoria = [];

    for (const item of relatorio) {
        // Fora de escopo (extensão que não é candidata) já é reportado
        // por triarDiretorio/README — não duplica relatório aqui.
        if (item.foraDeEscopo) continue;

        if (!item.jsonValido || !item.prontoPraCatalogo) {
            precisamDeCuradoria.push({ arquivo: item.arquivo, motivo: item.motivo });
            continue;
        }

        const caminhoOrigem = path.join(draftsDir, item.arquivo);
        const entrada = JSON.parse(fs.readFileSync(caminhoOrigem, 'utf8'));

        const idsExistentes = catalogoExistente.map((e) => e.id);
        const { ok, erros } = validarEntradaGerada(entrada, { idsExistentes });
        if (!ok) {
            rejeitados.push({ arquivo: item.arquivo, motivo: `reprovado pelo Worker determinístico: ${erros.join(' | ')}` });
            continue;
        }

        const similares = encontrarSimilares(entrada, catalogoExistente);
        if (similares.length > 0) {
            rejeitados.push({
                arquivo: item.arquivo,
                motivo: `parecido demais com entrada já existente: ${similares.map((s) => `${s.entrada.id} (${(s.score * 100).toFixed(0)}%)`).join(', ')} — revisão manual antes de mover.`,
            });
            continue;
        }

        // pastaSugerida já vem calculada da triagem (ragOrganizerWorker.
        // determinarPasta) — nunca null aqui: prontoPraCatalogo:true
        // implica id presente, e determinarPasta sempre resolve pra
        // algo (cai em "outros" no pior caso, nunca falha).
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
    for (const m of resultado.movidos) console.log(`   - ${m.arquivo} -> ${m.destino}`);

    if (resultado.rejeitados.length) {
        console.log(`\n❌ rejeitados, ficaram em drafts/ (${resultado.rejeitados.length}):`);
        for (const r of resultado.rejeitados) console.log(`   - ${r.arquivo}: ${r.motivo}`);
    }

    if (resultado.precisamDeCuradoria.length) {
        console.log(`\n📝 precisam de curadoria manual, ficaram em drafts/ (${resultado.precisamDeCuradoria.length}):`);
        for (const p of resultado.precisamDeCuradoria) console.log(`   - ${p.arquivo}: ${p.motivo}`);
    }

    process.exit(resultado.rejeitados.length > 0 ? 1 : 0);
}

module.exports = { organizarRascunhos };
