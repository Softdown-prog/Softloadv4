'use strict';
const { gerarEmbeddings } = require('../../src/solaris/rag/ragEmbeddingsClient');
const { findCodeVectors } = require('./codeVectorStore');
const { shouldSearchCodeCorpus } = require('../../src/knowledge/ragNamespaces');

// RAG do Blogger (src/rag) NÃO é importado nem consultado aqui.
// As duas buscas Solaris só recebem coleções próprias: ver ragNamespaces.js.
async function buscarCodigo({
  db, query, topK = 3, gerarEmbeddingsFn = gerarEmbeddings, findFn = findCodeVectors,
} = {}) {
  if (!db || typeof query !== 'string' || !query.trim()) throw new Error('Busca de código requer db e query');
  const limitedK = Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 3;
  const [vector] = await gerarEmbeddingsFn({
    textos: [query.trim().split(/\s+/).slice(0, 220).join(' ')],
    taskType: 'RETRIEVAL_QUERY',
  });
  const resultados = await findFn({ db, queryEmbedding: vector, topK: limitedK });
  return { query, resultados };
}
function uniqueResults(items, limit, seen = new Set()) {
  const out = [];
  if (limit <= 0) return out;
  for (const item of items || []) {
    if (!item || typeof item.entryId !== 'string' || typeof item.texto !== 'string' || !item.texto.trim()) continue;
    const id = item.entryId;
    // Vários chunks do mesmo exemplo não devem ocupar todo o contexto do modelo.
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

// Ambas as fontes são independentes. Se uma cair, a outra segue funcionando;
// só falha quando ambas estiverem indisponíveis. Blogger não participa.
async function buscarConhecimentoMisto({
  query, topK = 3, db, codeSearchEnabled = false,
  catalogFn = require('../../src/solaris/rag/ragSearchService').buscarNoCatalogo,
  codeFn = buscarCodigo,
} = {}) {
  if (!db || typeof query !== 'string' || !query.trim()) throw new Error('Busca RAG mista exige db e query');
  const wanted = Number.isInteger(topK) && topK > 0 ? Math.min(topK, 20) : 3;
  if (!codeSearchEnabled || !shouldSearchCodeCorpus(query)) {
    return catalogFn({ query, topK: wanted, db });
  }
  // Recupere uma margem extra para remover chunks duplicados por entryId.
  const codeLimit = wanted === 1 ? 1 : Math.min(2, wanted - 1);
  const [catalog, code] = await Promise.allSettled([
    catalogFn({ query, topK: wanted, db }),
    codeFn({ query, topK: Math.min(wanted * 3, 20), db }),
  ]);
  if (catalog.status === 'rejected') console.warn('[SOLARIS-RAG] Catálogo técnico indisponível: ' + catalog.reason?.message);
  if (code.status === 'rejected') console.warn('[SOLARIS-CODE-RAG] Receitas de código indisponíveis: ' + code.reason?.message);
  if (catalog.status === 'rejected' && code.status === 'rejected') {
    throw new Error('As duas bases RAG do Solaris estão indisponíveis');
  }
  const codeResults = code.status === 'fulfilled' ? uniqueResults(code.value?.resultados,
    catalog.status === 'rejected' ? wanted : codeLimit) : [];
  const seen = new Set(codeResults.map(item => item.entryId));
  const technicalResults = catalog.status === 'fulfilled'
    ? uniqueResults(catalog.value?.resultados, wanted - codeResults.length, seen)
    : [];
  // Se o catálogo estiver fora, ainda retorna código. Se não houver
  // código, devolve só o catálogo. Nunca cruza fronteira com o Blogger.
  return { query, resultados: [...codeResults, ...technicalResults].slice(0, wanted) };
}
module.exports = { buscarCodigo, buscarConhecimentoMisto, uniqueResults };
