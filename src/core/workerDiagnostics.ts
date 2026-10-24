import type { CompilerMetadata, CompilerTraceSlot } from '../contracts/compiler';

/** Os dados já foram normalizados pelo workerManifest; não muda os valores. */
export interface WorkerMetadataInputs {
    siteNameSanitizado: string;
    seoAtivo: boolean;
    modulosAtivos: Readonly<Record<string, unknown>>;
    badgesProcessados: readonly unknown[];
}

export interface WorkerDossieTelemetry {
    versaoDossie: unknown;
    pecas: ReadonlyArray<{ id: string; origem?: string | null }>;
}

export interface WorkerTelemetryEvent {
    timestamp: string;
    nichoTema: string | null;
    versaoDossie: unknown;
    pecasUsadas: string[];
    validadoresPassaram: {
        xmlSemAvisos: boolean;
        dossieDomIds: true | null;
        diagnosticoSemErros: boolean | null;
    };
    pecaGeradaPorIA: boolean;
}

export interface WorkerDiagnosticCategory {
    nome: string;
    achados: ReadonlyArray<{ nivel: string; mensagem: string }>;
}

/** Grafo da compilação: preserva ordem de Map, estabilidade de sort e top 5. */
export function resumirGrafoCompilacao(
    trace: readonly CompilerTraceSlot[],
    campoParaSlots: ReadonlyMap<string, string[]>,
): CompilerMetadata['grafo'] {
    const slotsAtivos = trace.filter(n => n.active).length;
    const camposInfluentes = [...campoParaSlots.entries()]
        .sort((a, b) => b[1].length - a[1].length)
        .slice(0, 5)
        .map(([campo, slots]) => ({ campo, qtdSlots: slots.length, slots }));
    return { totalSlots: trace.length, slotsAtivos, camposInfluentes };
}

/** Apenas formatação de achados; não altera o diagnóstico nem suas exceções. */
export function listarErrosDiagnostico(
    categorias: readonly WorkerDiagnosticCategory[],
): string[] {
    return categorias
        .filter(c => c.achados.some(a => a.nivel === 'erro'))
        .map(c => c.nome + ': ' + c.achados.filter(a => a.nivel === 'erro').map(a => a.mensagem).join(' | '));
}

/** Mesmo evento Firestore, montado sem I/O; timestamp gerado no worker. */
export function montarEventoTelemetria(
    timestamp: string,
    nichoTema: string | null,
    dossieDoNicho: WorkerDossieTelemetry | null,
    avisos: readonly string[],
    diagnosticoErros: number | null,
): WorkerTelemetryEvent {
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

// Mesmo Buffer global do Node que o worker já usava; não acrescenta dependência.
declare const Buffer: { byteLength(value: string, encoding: 'utf8'): number };

/** Campos e ordem idênticos ao objeto meta retornado pelo worker legado. */
export function montarMetadadosCompilacao(
    xmlFinal: string,
    params: WorkerMetadataInputs,
    grafo: CompilerMetadata['grafo'],
): CompilerMetadata {
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
