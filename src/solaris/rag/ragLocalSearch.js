"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buscarCatalogoLocal = buscarCatalogoLocal;
const { buscarCategoria, resumirParaPrompt } = require('./ragCatalogLoader');
/** Busca sem serviço externo; consulta os JSONs do catálogo existente. */
async function buscarCatalogoLocal({ query }) {
    if (typeof query !== 'string' || !query.trim()) throw new Error('query deve ser string não vazia');
    const encontrado = buscarCategoria(query);
    if (!encontrado) return { query, resultados: [] };
    const conteudo = resumirParaPrompt(encontrado);
    return { query, resultados: [{
        entryId: encontrado.id,
        categoria: encontrado.categoria || 'catalogo',
        texto: JSON.stringify(conteudo).slice(0, 1800),
    }] };
}
