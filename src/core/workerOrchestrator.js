"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarExecutorCompilacao = criarExecutorCompilacao;
/** Mantém ordem e fronteiras de erro do compilerWorker.js legado. */
function criarExecutorCompilacao(deps) {
    return function executarCompilacao(body, options = {}) {
        const errosManifesto = deps.validarManifesto(body);
        if (errosManifesto.length > 0) {
            throw new Error(`[MANIFEST] ${errosManifesto.join(' | ')}`);
        }
        const params = deps.normalizarManifesto(body, deps.manifestDependencies);
        const templateBase = deps.carregarChassisParaNicho(params.nichoTema);
        const dossieDoNicho = deps.carregarNichoDossie(params.nichoTema);
        let xmlBruto;
        let trace;
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
        }
        catch (err) {
            throw new Error(`[ENGINE] Falha na compilação: ${err.message}`);
        }
        const grafo = deps.construirGrafoCampos(trace);
        const grafoResumo = deps.resumirGrafoCompilacao(trace, grafo.campoParaSlots);
        deps.log(`[COMPILER-WORKER] Grafo: ${trace.length} slots | ${grafoResumo.slotsAtivos} ativos | ` +
            `campo mais influente: ${grafoResumo.camposInfluentes[0]?.campo ?? '-'} (${grafoResumo.camposInfluentes[0]?.qtdSlots ?? 0} slots)`);
        // Heros declarados protegidos no dossiê sempre vencem o Design Package.
        const bodyParaDesignPackage = deps.prepararDesignPackage(body, heroProtegidoNoDossie);
        const temDesignPackage = deps.temCamposDesignPackage(bodyParaDesignPackage);
        let xmlParaReparar = xmlBruto;
        let injecoesPackage = [];
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
        let diagnosticoErros = null;
        try {
            const diagSeguranca = deps.gerarDiagnostico(xmlFinal);
            diagnosticoErros = diagSeguranca.totalErros;
            if (diagSeguranca.totalErros > 0) {
                const errosPorCategoria = deps.listarErrosDiagnostico(diagSeguranca.categorias);
                deps.error(`[COMPILER-WORKER] 🩺 Diagnóstico encontrou ${diagSeguranca.totalErros} erro(s) real(is) no XML compilado (nicho: ${params.nichoTema || 'nenhum'}):`, errosPorCategoria.join(' || '));
            }
        }
        catch (err) {
            deps.warn('[COMPILER-WORKER] Safety-net do Diagnóstico falhou ao rodar (ignorado):', err.message);
        }
        if (options.telemetry !== false)
            deps.registrarCompilacao(deps.montarEventoTelemetria(deps.now(), params.nichoTema, dossieDoNicho, avisos, diagnosticoErros));
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
