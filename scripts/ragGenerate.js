'use strict';

// ============================================================
// npm run rag:generate -- <grupo> [topico]
// ============================================================
// CLI que roda o pipeline completo de geração do catálogo RAG do
// Solaris (ver src/solaris/README.md, "Pipeline de geração do
// catálogo"): topico (determinístico, ragTopicMatrix.js) → Gemini
// (ragEntryGenerator.js, único estágio com IA) → Validador
// (ragKebabWorker.validarEntradaGerada) → Deduplicador
// (ragDeduplicator.js) → grava em disco.
//
// `rodarGeracao` é a função testável (modelRouter injetável, sem
// tocar GEMINI_API_KEY real) — o bloco `require.main === module` é só
// a casca de CLI (parse de argv, dotenv, print de relatório).
// ============================================================

const fs   = require('fs');
const path = require('path');

const { listarGrupos, listarTopicos, idParaTopico } = require('../src/solaris/rag/ragTopicMatrix');
const { gerarEntradaCatalogo } = require('../src/solaris/rag/ragEntryGenerator');
const { encontrarSimilares } = require('../src/solaris/rag/ragDeduplicator');
const { validarEntradaGerada } = require('../src/solaris/workers/ragKebabWorker');
const { determinarPasta } = require('../src/solaris/workers/ragOrganizerWorker');
const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader');

/**
 * Roda o pipeline de geração pra um grupo (ou um único tópico dele).
 * Puro em relação a rede/IA (modelRouter injetável) — só toca disco
 * pra gravar arquivo novo em `dir`.
 *
 * `catalogoExistente` é injetável (default: catálogo real via
 * `carregarCatalogo`) — testes passam um array controlado, sem
 * depender do conteúdo real de src/solaris/rag/ nem escrever nele.
 *
 * @returns {Promise<{ gerados: string[], pulados: Array<{id,motivo}>, erros: Array<{id,erros}>, revisar: Array<{id,similar}> }>}
 */
async function rodarGeracao({ grupo, topico = null, modelRouter, dir, catalogoExistente: catalogoInicial = null }) {
    if (!listarGrupos().includes(grupo)) {
        throw new Error(`[RAG-GENERATE] grupo desconhecido: "${grupo}". Grupos válidos: ${listarGrupos().join(', ')}.`);
    }
    const topicos = topico ? [topico] : listarTopicos(grupo);
    if (topico && !listarTopicos(grupo).includes(topico)) {
        throw new Error(`[RAG-GENERATE] tópico "${topico}" não existe no grupo "${grupo}".`);
    }

    // Catálogo carregado 1x — ids/entradas existentes servem tanto pra
    // checagem de unicidade (Validador) quanto pra deduplicação; cada
    // entrada nova gerada nesta mesma rodada entra na cópia em memória
    // logo depois de salva, pra também contar contra a próxima do lote.
    const catalogoExistente = [...(catalogoInicial || carregarCatalogo({ forcarRecarga: true }))];

    const resultado = { gerados: [], pulados: [], erros: [], revisar: [] };

    for (const t of topicos) {
        const id = idParaTopico(grupo, t);

        if (catalogoExistente.some((e) => e.id === id)) {
            resultado.pulados.push({ id, motivo: 'já existe no catálogo' });
            continue;
        }

        let entrada;
        try {
            entrada = await gerarEntradaCatalogo({ grupo, topico: t, modelRouter });
        } catch (err) {
            resultado.erros.push({ id, erros: [err.message] });
            continue;
        }

        const idsExistentes = catalogoExistente.map((e) => e.id);
        const { ok, erros } = validarEntradaGerada(entrada, { idsExistentes });
        if (!ok) {
            resultado.erros.push({ id, erros });
            continue;
        }

        const similares = encontrarSimilares(entrada, catalogoExistente);
        if (similares.length > 0) {
            resultado.revisar.push({
                id,
                similar: similares.map((s) => `${s.entrada.id} (${(s.score * 100).toFixed(0)}%)`),
            });
            continue; // nunca grava sozinho no catálogo buscável — fica de fora até revisão humana
        }

        // Já grava direto na pasta certa (ragOrganizerWorker.determinarPasta)
        // — não precisa de uma passada de organização separada depois.
        const { pasta } = determinarPasta(entrada);
        const destinoDir = path.join(dir, pasta);
        fs.mkdirSync(destinoDir, { recursive: true });
        fs.writeFileSync(path.join(destinoDir, `${id}.json`), JSON.stringify(entrada, null, 2) + '\n', 'utf8');
        catalogoExistente.push(entrada);
        resultado.gerados.push(id);
    }

    return resultado;
}

if (require.main === module) {
    require('dotenv').config();
    const { criarModelRouter } = require('../src/solaris/llm/modelRouter');
    const RAG_DIR = path.join(__dirname, '../src/solaris/rag');

    const [, , grupoArg, topicoArg] = process.argv;
    if (!grupoArg) {
        console.error(`Uso: npm run rag:generate -- <grupo> [topico]\nGrupos: ${listarGrupos().join(', ')}`);
        process.exit(1);
    }

    rodarGeracao({ grupo: grupoArg, topico: topicoArg || null, modelRouter: criarModelRouter(), dir: RAG_DIR })
        .then((r) => {
            console.log(`\n✅ gerados (${r.gerados.length}): ${r.gerados.join(', ') || '-'}`);
            console.log(`⏭️  pulados (${r.pulados.length}): ${r.pulados.map((p) => p.id).join(', ') || '-'}`);
            if (r.revisar.length) {
                console.log(`⚠️  revisar manualmente (${r.revisar.length}):`);
                for (const rev of r.revisar) console.log(`   - ${rev.id}: parecido com ${rev.similar.join(', ')}`);
            }
            if (r.erros.length) {
                console.log(`❌ erros (${r.erros.length}):`);
                for (const e of r.erros) console.log(`   - ${e.id}: ${e.erros.join(' | ')}`);
            }
            process.exit(r.erros.length > 0 ? 1 : 0);
        })
        .catch((err) => {
            console.error(`[RAG-GENERATE] falhou: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { rodarGeracao };
