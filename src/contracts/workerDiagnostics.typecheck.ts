import { resumirGrafoCompilacao, listarErrosDiagnostico, montarEventoTelemetria, montarMetadadosCompilacao } from '../core/workerDiagnostics';
import type { WorkerMetadataInputs, WorkerTelemetryEvent, WorkerDiagnosticCategory } from '../core/workerDiagnostics';
import type { CompilerMetadata } from './compiler';
const resumo: CompilerMetadata['grafo'] = resumirGrafoCompilacao([],new Map());
const categorias: WorkerDiagnosticCategory[] = [{nome:'XML',achados:[{nivel:'erro',mensagem:'Teste'}]}];
const erros: string[] = listarErrosDiagnostico(categorias);
const evento: WorkerTelemetryEvent = montarEventoTelemetria('2026-10-22T22:00:00.000Z',null,null,erros,0);
const params: WorkerMetadataInputs = {
    siteNameSanitizado:'Teste',seoAtivo:true,modulosAtivos:{darkMode:true},badgesProcessados:[],
};
const metadata: CompilerMetadata = montarMetadadosCompilacao('<xml/>',params,resumo);
void evento;void metadata;
// @ts-expect-error totalSlots deve ser número.
const invalidGrafo: CompilerMetadata['grafo'] = {...resumo,totalSlots:'4'};
void invalidGrafo;
// @ts-expect-error timestamp precisa ser string.
const invalidEvent: WorkerTelemetryEvent = {...evento,timestamp:45};
void invalidEvent;
