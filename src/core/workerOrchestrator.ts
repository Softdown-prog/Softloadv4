import type { CompilerTemplateOptions, CompilerTemplateResult, CompilerTraceSlot, CompiledBloggerTheme } from '../contracts/compiler';
import type { WorkerManifestInput, WorkerManifestDependencies, NormalizedWorkerManifest } from './workerManifest';
import type { DesignPackageBody, DesignPackageDependencies, DesignPackageResult } from './workerDesignPackage';
import type { WorkerDiagnosticCategory, WorkerTelemetryEvent, WorkerDossieTelemetry } from './workerDiagnostics';

export interface CompilerExecutionOptions { telemetry?: boolean }
export interface WorkerCompilerBody extends WorkerManifestInput, DesignPackageBody {}
export interface WorkerDossie extends WorkerDossieTelemetry {
    pecas: ReadonlyArray<{ id: string; tipo: string; protegida?: boolean; origem?: string | null }>;
}
export interface WorkerXmlRepair { acção?: string; detalhes?: string; [key: string]: unknown }

/** Contratos explícitos para o motor JS, dossiês, relógio, logs e telemetria. */
export interface WorkerOrchestratorDependencies {
    validarManifesto: (body: unknown) => string[];
    normalizarManifesto: (body: WorkerCompilerBody, deps: WorkerManifestDependencies) => NormalizedWorkerManifest;
    manifestDependencies: WorkerManifestDependencies;
    carregarChassisParaNicho: (nicho: string | null) => string;
    carregarNichoDossie: (nicho: string | null) => WorkerDossie | null;
    temHeroProtegido: typeof import('./workerHeroGuard').temHeroProtegido;
    prepararDesignPackage: typeof import('./workerHeroGuard').prepararDesignPackage;
    temCamposDesignPackage: typeof import('./workerHeroGuard').temCamposDesignPackage;
    compilarTemplate: (template: string, options: CompilerTemplateOptions) => CompilerTemplateResult;
    construirGrafoCampos: (trace: readonly CompilerTraceSlot[]) => { campoParaSlots: Map<string, string[]> };
    resumirGrafoCompilacao: typeof import('./workerDiagnostics').resumirGrafoCompilacao;
    injetarDesignPackage: (xml: string, body: WorkerCompilerBody, deps: DesignPackageDependencies) => DesignPackageResult;
    designPackageDependencies: DesignPackageDependencies;
    repararXml: (xml: string) => { xml: string; reparos: WorkerXmlRepair[] };
    verificarDomIdsNoOutput: (xml: string, dossie: WorkerDossie) => { ok: boolean; erros: string[] };
    validarXmlSaida: (xml: string) => string[];
    gerarDiagnostico: (xml: string) => { totalErros: number; categorias: WorkerDiagnosticCategory[] };
    listarErrosDiagnostico: typeof import('./workerDiagnostics').listarErrosDiagnostico;
    montarEventoTelemetria: typeof import('./workerDiagnostics').montarEventoTelemetria;
    montarMetadadosCompilacao: typeof import('./workerDiagnostics').montarMetadadosCompilacao;
    registrarCompilacao: (evento: WorkerTelemetryEvent) => void;
    now: () => string;
    log: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
}

/** Mantém ordem e fronteiras de erro do compilerWorker.js legado. */
export function criarExecutorCompilacao(deps: WorkerOrchestratorDependencies):
    (body: WorkerCompilerBody, options?: CompilerExecutionOptions) => CompiledBloggerTheme {
    return function executarCompilacao(body: WorkerCompilerBody, options: CompilerExecutionOptions = {}): CompiledBloggerTheme {
        const errosManifesto = deps.validarManifesto(body);
        if (errosManifesto.length > 0) {
            throw new Error(`[MANIFEST] ${errosManifesto.join(' | ')}`);
        }
        const params = deps.normalizarManifesto(body, deps.manifestDependencies);
        const templateBase = deps.carregarChassisParaNicho(params.nichoTema);
        const dossieDoNicho = deps.carregarNichoDossie(params.nichoTema);
        let xmlBruto: string;
        let trace: CompilerTraceSlot[];
        const heroProtegidoNoDossie = deps.temHeroProtegido(dossieDoNicho);
        try {
            ({ xml: xmlBruto, trace } = deps.compilarTemplate(templateBase, {
                siteName: params.siteName,
                description: params.description,
                enableSeo: params.seoAtivo,
                gridLayout: params.gridLayout,
                colorPreset: params.colorPreset,
                buttonStyle: params.buttonStyle,
                typography: params.typography,
                modules: params.modulosAtivos,
                categoryBadges: params.badgesProcessados,
                lazyLoad: params.lazyLoadAtivo,
                nichoTema: params.nichoTema,
                footerStyle: params.footerStyle,
                sidebarPosition: params.sidebarPosition,
                heroTitle: params.heroTitle,
                heroSubtitle: params.heroSubtitle,
                designVoice: params.designVoice,
                temHeroDesignPackage: heroProtegidoNoDossie
                    ? false
                    : Boolean(typeof body.heroHtml === 'string' && body.heroHtml.trim()),
            }));
        } catch (err) {
            throw new Error(`[ENGINE] Falha na compilação: ${(err as Error).message}`);
        }
        const grafo = deps.construirGrafoCampos(trace);
        const grafoResumo = deps.resumirGrafoCompilacao(trace, grafo.campoParaSlots);
        deps.log(
            `[COMPILER-WORKER] Grafo: ${trace.length} slots | ${grafoResumo.slotsAtivos} ativos | ` +
            `campo mais influente: ${grafoResumo.camposInfluentes[0]?.campo ?? '-'} (${grafoResumo.camposInfluentes[0]?.qtdSlots ?? 0} slots)`
        );
        // Heros declarados protegidos no dossiê sempre vencem o Design Package.
        const bodyParaDesignPackage = deps.prepararDesignPackage(body, heroProtegidoNoDossie);
        const temDesignPackage = deps.temCamposDesignPackage(bodyParaDesignPackage);
        let xmlParaReparar = xmlBruto;
        let injecoesPackage: string[] = [];
        if (temDesignPackage) {
            ({ xml: xmlParaReparar, injecoes: injecoesPackage } = deps.injetarDesignPackage(xmlBruto, bodyParaDesignPackage, deps.designPackageDependencies));
            if (injecoesPackage.length > 0) {
                deps.log(`[COMPILER-WORKER] Design Package injetado: ${injecoesPackage.join(', ')}`);
            }
        }
        const { xml: xmlFinal, reparos: reparosXml } = deps.repararXml(xmlParaReparar);
        if (reparosXml.length > 0) {
            deps.warn('[COMPILER-WORKER] XML reparado:', reparosXml.map(r => r.acção || r.detalhes).join(' | '));
        }
        if (dossieDoNicho) {
            const { ok, erros: errosIntegridade } = deps.verificarDomIdsNoOutput(xmlFinal, dossieDoNicho);
            if (!ok) {
                throw new Error(`[DOSSIE] Integridade do nicho "${params.nichoTema}" violada: ${errosIntegridade.join(' | ')}`);
            }
        }
        const avisos = deps.validarXmlSaida(xmlFinal);
        if (avisos.length > 0) {
            deps.warn('[COMPILER-WORKER] ⚠️ Avisos na validação do XML de saída:', avisos.join(' | '));
        }
        // Diagnóstico observável, mas nunca bloqueante; integridade do dossiê é bloqueante.
        let diagnosticoErros: number | null = null;
        try {
            const diagSeguranca = deps.gerarDiagnostico(xmlFinal);
            diagnosticoErros = diagSeguranca.totalErros;
            if (diagSeguranca.totalErros > 0) {
                const errosPorCategoria = deps.listarErrosDiagnostico(diagSeguranca.categorias);
                deps.error(`[COMPILER-WORKER] 🩺 Diagnóstico encontrou ${diagSeguranca.totalErros} erro(s) real(is) no XML compilado (nicho: ${params.nichoTema || 'nenhum'}):`, errosPorCategoria.join(' || '));
            }
        } catch (err) {
            deps.warn('[COMPILER-WORKER] Safety-net do Diagnóstico falhou ao rodar (ignorado):', (err as Error).message);
        }
        if (options.telemetry !== false) deps.registrarCompilacao(deps.montarEventoTelemetria(deps.now(), params.nichoTema, dossieDoNicho, avisos, diagnosticoErros));
        return {
            xmlFinal,
            avisos,
            reparosXml,
            injecoesPackage,
            slug: params.slug,
            siteNameSanitizado: params.siteNameSanitizado,
            modulosAtivos: params.modulosAtivos,
            badgesProcessados: params.badgesProcessados,
            meta: deps.montarMetadadosCompilacao(xmlFinal, params, grafoResumo),
        };
    };
}
