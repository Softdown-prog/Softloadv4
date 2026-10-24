"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resumirGrafoCompilacao = resumirGrafoCompilacao;
exports.listarErrosDiagnostico = listarErrosDiagnostico;
exports.montarEventoTelemetria = montarEventoTelemetria;
exports.montarMetadadosCompilacao = montarMetadadosCompilacao;
/** Grafo da compilação: preserva ordem de Map, estabilidade de sort e top 5. */
function resumirGrafoCompilacao(trace, campoParaSlots) {
    const slotsAtivos = trace.filter(n => n.active).length;
    const camposInfluentes = [...campoParaSlots.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([campo, slots]) => ({ campo, qtdSlots: slots.length, slots }));
    return { totalSlots: trace.length, slotsAtivos, camposInfluentes };
}
/** Apenas formatação de achados; não altera o diagnóstico nem suas exceções. */
function listarErrosDiagnostico(categorias) {
    return categorias
        .filter(c => c.achados.some(a => a.nivel === 'erro'))
        .map(c => c.nome + ': ' + c.achados.filter(a => a.nivel === 'erro').map(a => a.mensagem).join(' | '));
}
/** Mesmo evento Firestore, montado sem I/O; timestamp gerado no worker. */
function montarEventoTelemetria(timestamp, nichoTema, dossieDoNicho, avisos, diagnosticoErros) {
    return {
        timestamp,
        nichoTema: nichoTema || null,
        versaoDossie: dossieDoNicho ? dossieDoNicho.versaoDossie : null,
        pecasUsadas: dossieDoNicho ? dossieDoNicho.pecas.map(p => p.id) : [],
        validadoresPassaram: {
            xmlSemAvisos: avisos.length === 0,
            dossieDomIds: dossieDoNicho ? true : null,
            diagnosticoSemErros: diagnosticoErros === null ? null : diagnosticoErros === 0,
        },
        pecaGeradaPorIA: dossieDoNicho ? dossieDoNicho.pecas.some(p => p.origem === 'ia-gerada') : false,
    };
}
/** Campos e ordem idênticos ao objeto meta retornado pelo worker legado. */
function montarMetadadosCompilacao(xmlFinal, params, grafo) {
    return {
        linhas: xmlFinal.split('\n').length,
        tamanhoKb: (Buffer.byteLength(xmlFinal, 'utf8') / 1024).toFixed(1),
        siteName: params.siteNameSanitizado,
        seo: params.seoAtivo,
        modulos: Object.keys(params.modulosAtivos).filter(k => params.modulosAtivos[k]),
        badges: params.badgesProcessados.length,
        grafo,
    };
}
