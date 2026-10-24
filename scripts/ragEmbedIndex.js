'use strict';

// ============================================================
// npm run rag:embed-index [-- <id1,id2,...>]
// ============================================================
// Reindexa o catálogo RAG do Solaris (src/solaris/rag/*.json) na
// coleção vetorial do Firestore (solaris_rag_vectors). Pipeline:
//   catálogo (ragCatalogLoader, já existente)
//     → texto embedável (ragEntryText.montarTextoEmbedavel)
//     → chunks de até 250 palavras (ragChunker.chunkarTexto)
//     → embeddings via serviço isolado (ragEmbeddingsClient.gerarEmbeddings,
//       Embedings-python/server.py -- API Gemini)
//     → replace completo no Firestore (ragVectorStore.substituirVetoresDaEntrada)
//
// Idempotente: rodar duas vezes sobre a mesma entrada nunca duplica
// nem deixa vetor órfão (substituirVetoresDaEntrada faz replace
// completo por entrada, não append -- ver Embedings-python/Observações.md
// item 2.2 pro bug que esse design evita).
//
// `rodarIndexacao` é a função testável (catalogo/db/gerarEmbeddingsFn
// injetáveis, sem tocar Firestore/Gemini reais) -- o bloco
// `require.main === module` é só a casca de CLI, mesmo padrão de
// scripts/ragGenerate.js.
// ============================================================

const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader');
const { montarTextoEmbedavel } = require('../src/solaris/rag/ragEntryText');
const { chunkarTexto } = require('../src/solaris/rag/ragChunker');
const { gerarEmbeddings } = require('../src/solaris/rag/ragEmbeddingsClient');
const { substituirVetoresDaEntrada, COLECAO } = require('../src/solaris/rag/ragVectorStore');

const TAMANHO_LOTE_REMOVER = 400;

/**
 * Remove vetores cuja entrada-fonte não existe mais no catálogo. Só é
 * chamado numa indexação completa: em uma indexação filtrada, a ausência de
 * um id no filtro não significa que ele foi removido do RAG.
 *
 * Um catálogo vazio também nunca dispara remoção automática. É uma trava
 * contra apagar a base inteira por falha de leitura do diretório.
 */
async function removerVetoresOrfaos({ db, entryIdsAtuais }) {
    if (!(entryIdsAtuais instanceof Set) || entryIdsAtuais.size === 0) {
        return { documentos: 0, entradas: [] };
    }

    const colecao = db.collection(COLECAO);
    const snapshot = await colecao.get();
    const orfaos = snapshot.docs.filter((doc) => !entryIdsAtuais.has(doc.data().entryId));
    if (orfaos.length === 0) return { documentos: 0, entradas: [] };

    for (let inicio = 0; inicio < orfaos.length; inicio += TAMANHO_LOTE_REMOVER) {
        const lote = db.batch();
        for (const doc of orfaos.slice(inicio, inicio + TAMANHO_LOTE_REMOVER)) {
            lote.delete(doc.ref);
        }
        await lote.commit();
    }

    return {
        documentos: orfaos.length,
        entradas: [...new Set(orfaos.map((doc) => doc.data().entryId))].sort(),
    };
}

/**
 * Reindexa um subconjunto (ou o catálogo inteiro) do RAG na coleção
 * vetorial. Cada entrada é processada de forma independente -- uma
 * falha numa entrada (rede, validação) nunca impede as demais.
 *
 * @param {object} params
 * @param {object[]} [params.catalogo] - default: carregarCatalogo() real.
 * @param {FirebaseFirestore.Firestore} params.db
 * @param {Function} [params.gerarEmbeddingsFn] - default: ragEmbeddingsClient.gerarEmbeddings.
 * @param {string[]|null} [params.idsFiltro] - se fornecido, indexa só essas ids (default: catálogo inteiro).
 * @returns {Promise<{ indexados: string[], pulados: Array<{id:string, motivo:string}>, erros: Array<{id:string, erro:string}>, removidos: {documentos:number, entradas:string[]} }>}
 */
async function rodarIndexacao({
    catalogo = null,
    db,
    gerarEmbeddingsFn = gerarEmbeddings,
    idsFiltro = null,
}) {
    if (!db) {
        throw new Error('rodarIndexacao: "db" é obrigatório');
    }

    const entradas = (catalogo || carregarCatalogo({ forcarRecarga: true }))
        .filter((entrada) => !idsFiltro || idsFiltro.includes(entrada.id));

    const resultado = { indexados: [], pulados: [], erros: [], removidos: { documentos: 0, entradas: [] } };

    for (const entrada of entradas) {
        const texto = montarTextoEmbedavel(entrada);
        const chunks = chunkarTexto(texto);
        if (chunks.length === 0) {
            resultado.pulados.push({ id: entrada.id, motivo: 'texto embedável vazio' });
            continue;
        }

        try {
            const embeddings = await gerarEmbeddingsFn({ textos: chunks, taskType: 'RETRIEVAL_DOCUMENT' });
            await substituirVetoresDaEntrada({ db, entrada, chunks, embeddings });
            resultado.indexados.push(entrada.id);
        } catch (err) {
            resultado.erros.push({ id: entrada.id, erro: err.message });
        }
    }

    // A limpeza precisa considerar o catálogo INTEIRO, não só as entradas
    // selecionadas para esta execução. Por isso ela não roda com idsFiltro.
    if (!idsFiltro) {
        resultado.removidos = await removerVetoresOrfaos({
            db,
            entryIdsAtuais: new Set(entradas.map((entrada) => entrada.id).filter(Boolean)),
        });
    }

    return resultado;
}

if (require.main === module) {
    require('dotenv').config();
    const { db } = require('../src/services/firebase');

    const [, , filtroArg] = process.argv;
    const idsFiltro = filtroArg ? filtroArg.split(',').map((s) => s.trim()).filter(Boolean) : null;

    rodarIndexacao({ db, idsFiltro })
        .then((r) => {
            console.log(`\n✅ indexados (${r.indexados.length}): ${r.indexados.join(', ') || '-'}`);
            console.log(`⏭️  pulados (${r.pulados.length}): ${r.pulados.map((p) => p.id).join(', ') || '-'}`);
            console.log(`🗑️  vetores órfãos removidos (${r.removidos.documentos}): ${r.removidos.entradas.join(', ') || '-'}`);
            if (r.erros.length) {
                console.log(`❌ erros (${r.erros.length}):`);
                for (const e of r.erros) console.log(`   - ${e.id}: ${e.erro}`);
            }
            process.exit(r.erros.length > 0 ? 1 : 0);
        })
        .catch((err) => {
            console.error(`[RAG-EMBED-INDEX] falhou: ${err.message}`);
            process.exit(1);
        });
}

module.exports = { rodarIndexacao, removerVetoresOrfaos };
