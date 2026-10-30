"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarMarcadoresDesignPackage = exports.carregarChassisParaNicho = exports.validarXmlSaida = exports.validarManifesto = exports.executarCompilacao = void 0;
/**
 * Compiler Worker — Orquestrador do pipeline de compilação.
 *
 * Responsabilidades:
 *  1. Validar manifesto JSON de entrada (campos obrigatórios, tipos, valores aceitos)
 *  2. Sanitizar e normalizar todos os inputs
 *  3. Carregar o Chassis (template_base.xml)
 *  4. Chamar compilarTemplate() (motor de injeção DNA)
 *  5. Reparar XML de saída (tokens órfãos, widget IDs duplicados) — via repairEngine
 *  6. Validar estrutura básica do XML de saída (Blogger-aware)
 *  7. Retornar resultado estruturado com metadados, avisos e reparos aplicados
 *
 * Separa a lógica de negócio das rotas HTTP — facilita testes e manutenção.
 */
const path = require('path');
const fs = require('fs');
const { compilarTemplate, construirGrafoCampos, sanitizarEntidadesXml, montarWidgetHtml, carregarNichoDossie, verificarDomIdsNoOutput, } = require('./compilerEngine');
const { ENUMS } = require('../blogger/manifestSchema');
const { repararXml } = require('./repairEngine');
const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT } = require('./designVoicePresets');
const { chassisParaNicho, pageTypeParaNicho } = require('./nichoTaxonomy');
const { modulosPadraoDoNicho } = require('./nichoModuleDefaults');
const { gerarDiagnostico } = require('./diagnostico');
const { registrarCompilacao } = require('./telemetria');
const { hashSeed } = require('./blockLibrary');
const { validarManifesto } = require('./workerInput');
exports.validarManifesto = validarManifesto;
const { normalizarManifesto } = require('./workerManifest');
const { criarCarregadorChassis } = require('./workerChassis');
const { injetarDesignPackage, verificarMarcadoresDesignPackage } = require('./workerDesignPackage');
exports.verificarMarcadoresDesignPackage = verificarMarcadoresDesignPackage;
const { validarXmlSaida } = require('./workerXmlValidation');
exports.validarXmlSaida = validarXmlSaida;
const { resumirGrafoCompilacao, listarErrosDiagnostico, montarEventoTelemetria, montarMetadadosCompilacao } = require('./workerDiagnostics');
const { temHeroProtegido, prepararDesignPackage, temCamposDesignPackage } = require('./workerHeroGuard');
const { criarExecutorCompilacao } = require('./workerOrchestrator');
// A normalização aplica as mesmas dependências e avisos do worker legado.
const WORKER_MANIFEST_DEPENDENCIES = {
    enums: ENUMS,
    nicheVoiceMap: NICHO_DESIGN_VOICE_MAP,
    colorVoiceHints: COLOR_DESIGN_VOICE_HINT,
    chassisParaNicho,
    pageTypeParaNicho,
    modulosPadraoDoNicho,
    hashSeed,
    avisarNichoInvalido: (raw) => console.warn(`[COMPILER-WORKER] nichoTema inválido ignorado: "${raw}"`),
};
// Passos 1 e 2: validação pública e normalização tipada do manifesto.
// ==========================================
// PASSO 3: CARREGAR CHASSIS
// ==========================================
// O I/O é delegado a partir deste worker ao loader tipado.
const carregarChassisParaNicho = criarCarregadorChassis({
    workerDir: __dirname,
    joinPath: path.join,
    readFileSync: (file, encoding) => fs.readFileSync(file, encoding),
    existsSync: (file) => fs.existsSync(file),
    chassisParaNicho,
    warn: (mensagem) => console.warn(mensagem),
});
exports.carregarChassisParaNicho = carregarChassisParaNicho;
// PASSO 4c: Design Package tipado em workerDesignPackage.ts.
// Contrato público do verificador e dependências legadas preservados.
const DESIGN_PACKAGE_DEPS = {
    sanitizarEntidadesXml,
    montarWidgetHtml,
    warn: (mensagem) => console.warn(mensagem),
};
// ==========================================
// PASSO 5: VALIDAÇÃO DO XML DE SAÍDA
// ==========================================
// ==========================================
// WORKER PRINCIPAL
// ==========================================
/**
 * Executa o pipeline completo de compilação.
 * Lança Error com prefixo de etapa em caso de falha.
 * Retorna resultado estruturado em caso de sucesso.
 */
const executarCompilacao = criarExecutorCompilacao({
    validarManifesto,
    normalizarManifesto,
    manifestDependencies: WORKER_MANIFEST_DEPENDENCIES,
    carregarChassisParaNicho,
    carregarNichoDossie: carregarNichoDossie,
    temHeroProtegido,
    prepararDesignPackage,
    temCamposDesignPackage,
    compilarTemplate,
    construirGrafoCampos,
    resumirGrafoCompilacao,
    injetarDesignPackage,
    designPackageDependencies: DESIGN_PACKAGE_DEPS,
    repararXml: repararXml,
    verificarDomIdsNoOutput: verificarDomIdsNoOutput,
    validarXmlSaida,
    gerarDiagnostico,
    listarErrosDiagnostico,
    montarEventoTelemetria,
    montarMetadadosCompilacao,
    registrarCompilacao,
    now: () => new Date().toISOString(),
    log: (...args) => console.log(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
});
exports.executarCompilacao = executarCompilacao;
const publicApi = {
    executarCompilacao,
    validarManifesto,
    validarXmlSaida,
    carregarChassisParaNicho,
    verificarMarcadoresDesignPackage,
};
module.exports = publicApi;
