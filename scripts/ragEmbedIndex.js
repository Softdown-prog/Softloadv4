"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.removerVetoresOrfaos = removerVetoresOrfaos;
exports.rodarIndexacao = rodarIndexacao;
const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader');
const { montarTextoEmbedavel } = require('../src/solaris/rag/ragEntryText');
const { chunkarTexto } = require('../src/solaris/rag/ragChunker');
const { gerarEmbeddings } = require('../src/solaris/rag/ragEmbeddingsClient');
const { substituirVetoresDaEntrada, COLECAO } = require('../src/solaris/rag/ragVectorStore');
const TAMANHO_LOTE_REMOVER = 400;
/**
 * A limpeza de órfãos só é permitida após indexação completa e não vazia.
 * Também só consulta a coleção técnica (COLECAO), nunca os outros RAGs.
 */
async function removerVetoresOrfaos({ db, entryIdsAtuais }) {
    if (!(entryIdsAtuais instanceof Set) || entryIdsAtuais.size === 0) {
        return { documentos: 0, entradas: [] };
    }
    const colecao = db.collection(COLECAO);
    const snapshot = await colecao.get();
    const orfaos = snapshot.docs.filter(doc => !entryIdsAtuais.has(doc.data().entryId));
    if (orfaos.length === 0)
        return { documentos: 0, entradas: [] };
    for (let inicio = 0; inicio < orfaos.length; inicio += TAMANHO_LOTE_REMOVER) {
        const lote = db.batch();
        for (const doc of orfaos.slice(inicio, inicio + TAMANHO_LOTE_REMOVER)) {
            lote.delete(doc.ref);
        }
        await lote.commit();
    }
    return {
        documentos: orfaos.length,
        entradas: [...new Set(orfaos.map(doc => doc.data().entryId))].sort(),
    };
}
/** Cada entrada é independente: erro de embedding não cancela as demais. */
async function rodarIndexacao({ catalogo = null, db, gerarEmbeddingsFn = gerarEmbeddings, idsFiltro = null, }) {
    if (!db) {
        throw new Error('rodarIndexacao: "db" é obrigatório');
    }
    const entradas = (catalogo || carregarCatalogo({ forcarRecarga: true }))
        .filter(entrada => !idsFiltro || idsFiltro.includes(entrada.id));
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
        }
        catch (err) {
            resultado.erros.push({ id: entrada.id, erro: err.message });
        }
    }
    // Indexação filtrada NÃO pode remover vetores fora do filtro.
    if (!idsFiltro) {
        resultado.removidos = await removerVetoresOrfaos({
            db,
            entryIdsAtuais: new Set(entradas.map(entrada => entrada.id).filter(Boolean)),
        });
    }
    return resultado;
}
if (require.main === module) {
    require('dotenv').config();
    const { db } = require('../src/services/firebase');
    const [, , filtroArg] = process.argv;
    const idsFiltro = filtroArg ? filtroArg.split(',').map(s => s.trim()).filter(Boolean) : null;
    rodarIndexacao({ db, idsFiltro })
        .then(r => {
        console.log(`\n✅ indexados (${r.indexados.length}): ${r.indexados.join(', ') || '-'}`);
        console.log(`⏭️  pulados (${r.pulados.length}): ${r.pulados.map(p => p.id).join(', ') || '-'}`);
        console.log(`🗑️  vetores órfãos removidos (${r.removidos.documentos}): ${r.removidos.entradas.join(', ') || '-'}`);
        if (r.erros.length) {
            console.log(`❌ erros (${r.erros.length}):`);
            for (const e of r.erros)
                console.log(`   - ${e.id}: ${e.erro}`);
        }
        process.exit(r.erros.length > 0 ? 1 : 0);
    })
        .catch((err) => {
        console.error(`[RAG-EMBED-INDEX] falhou: ${err.message}`);
        process.exit(1);
    });
}
