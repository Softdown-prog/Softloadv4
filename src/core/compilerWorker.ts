import type { WorkerManifestDependencies } from './workerManifest';
import type { WorkerOrchestratorDependencies, WorkerCompilerBody } from './workerOrchestrator';
import type { CompiledBloggerTheme } from '../contracts/compiler';

declare const __dirname: string;
declare const module: { exports: unknown };
declare function require(path: string): unknown;
declare const console: {
    log(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};

/** API pública do worker preservada para Node/CommonJS e consumidores TypeScript. */
export interface CompilerWorkerApi {
    executarCompilacao(body: WorkerCompilerBody): CompiledBloggerTheme;
    validarManifesto: typeof import('./workerInput').validarManifesto;
    validarXmlSaida: typeof import('./workerXmlValidation').validarXmlSaida;
    carregarChassisParaNicho: (nicho: unknown) => string;
    verificarMarcadoresDesignPackage: typeof import('./workerDesignPackage').verificarMarcadoresDesignPackage;
}

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

const path = require('path') as { join(...paths: string[]): string };
const fs   = require('fs') as { readFileSync(file: string, encoding: 'utf-8'): string; existsSync(file: string): boolean };
const {
    compilarTemplate, construirGrafoCampos,
    sanitizarEntidadesXml, montarWidgetHtml, carregarNichoDossie, verificarDomIdsNoOutput,
} = require('./compilerEngine') as {
    compilarTemplate: typeof import('./compilerEngine/compile').compilarTemplate;
    construirGrafoCampos: typeof import('./compilerEngine/fieldGraph').construirGrafoCampos;
    sanitizarEntidadesXml: typeof import('./compilerEngine/xmlEntities').sanitizarEntidadesXml;
    montarWidgetHtml: typeof import('./compilerEngine/widgets').montarWidgetHtml;
    carregarNichoDossie: typeof import('./compilerEngine/dossieLoader').carregarNichoDossie;
    verificarDomIdsNoOutput: typeof import('./compilerEngine/dossieIntegrityChecker').verificarDomIdsNoOutput;
};
const { ENUMS }       = require('../ai/blueprintSchema') as { ENUMS: WorkerManifestDependencies['enums'] };
const { repararXml }  = require('./repairEngine') as typeof import('./repairEngine');
const { NICHO_DESIGN_VOICE_MAP, COLOR_DESIGN_VOICE_HINT } = require('./designVoicePresets') as {
    NICHO_DESIGN_VOICE_MAP: WorkerManifestDependencies['nicheVoiceMap'];
    COLOR_DESIGN_VOICE_HINT: WorkerManifestDependencies['colorVoiceHints'];
};
const { chassisParaNicho, pageTypeParaNicho } = require('./nichoTaxonomy') as typeof import('./nichoTaxonomy');
const { modulosPadraoDoNicho } = require('./nichoModuleDefaults') as { modulosPadraoDoNicho: WorkerManifestDependencies['modulosPadraoDoNicho'] };
const { gerarDiagnostico } = require('./diagnostico') as { gerarDiagnostico: WorkerOrchestratorDependencies['gerarDiagnostico'] };
const { registrarCompilacao } = require('./telemetria') as { registrarCompilacao: WorkerOrchestratorDependencies['registrarCompilacao'] };
const { hashSeed } = require('./blockLibrary') as typeof import('./blockLibrary');
const { validarManifesto } = require('./workerInput') as typeof import('./workerInput');
const { normalizarManifesto } = require('./workerManifest') as typeof import('./workerManifest');
const { criarCarregadorChassis } = require('./workerChassis') as typeof import('./workerChassis');
const { injetarDesignPackage, verificarMarcadoresDesignPackage } = require('./workerDesignPackage') as typeof import('./workerDesignPackage');
const { validarXmlSaida } = require('./workerXmlValidation') as typeof import('./workerXmlValidation');
const { resumirGrafoCompilacao, listarErrosDiagnostico, montarEventoTelemetria, montarMetadadosCompilacao } = require('./workerDiagnostics') as typeof import('./workerDiagnostics');
const { temHeroProtegido, prepararDesignPackage, temCamposDesignPackage } = require('./workerHeroGuard') as typeof import('./workerHeroGuard');
const { criarExecutorCompilacao } = require('./workerOrchestrator') as typeof import('./workerOrchestrator');

// A normalização aplica as mesmas dependências e avisos do worker legado.
const WORKER_MANIFEST_DEPENDENCIES: WorkerManifestDependencies = {
    enums: ENUMS,
    nicheVoiceMap: NICHO_DESIGN_VOICE_MAP,
    colorVoiceHints: COLOR_DESIGN_VOICE_HINT,
    chassisParaNicho,
    pageTypeParaNicho,
    modulosPadraoDoNicho,
    hashSeed,
    avisarNichoInvalido: (raw: string) => console.warn(`[COMPILER-WORKER] nichoTema inválido ignorado: "${raw}"`),
};

// Passos 1 e 2: validação pública e normalização tipada do manifesto.

// ==========================================
// PASSO 3: CARREGAR CHASSIS
// ==========================================

// O I/O é delegado a partir deste worker ao loader tipado.
const carregarChassisParaNicho = criarCarregadorChassis({
    workerDir: __dirname,
    joinPath: path.join,
    readFileSync: (file: string, encoding: 'utf-8') => fs.readFileSync(file, encoding),
    existsSync: (file: string) => fs.existsSync(file),
    chassisParaNicho,
    warn: (mensagem: string) => console.warn(mensagem),
});

// PASSO 4c: Design Package tipado em workerDesignPackage.ts.
// Contrato público do verificador e dependências legadas preservados.
const DESIGN_PACKAGE_DEPS = {
    sanitizarEntidadesXml,
    montarWidgetHtml,
    warn: (mensagem: string) => console.warn(mensagem),
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
    carregarNichoDossie: carregarNichoDossie as WorkerOrchestratorDependencies['carregarNichoDossie'],
    temHeroProtegido,
    prepararDesignPackage,
    temCamposDesignPackage,
    compilarTemplate,
    construirGrafoCampos,
    resumirGrafoCompilacao,
    injetarDesignPackage,
    designPackageDependencies: DESIGN_PACKAGE_DEPS,
    repararXml: repararXml as unknown as WorkerOrchestratorDependencies['repararXml'],
    verificarDomIdsNoOutput: verificarDomIdsNoOutput as unknown as WorkerOrchestratorDependencies['verificarDomIdsNoOutput'],
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

const publicApi: CompilerWorkerApi = {
    executarCompilacao,
    validarManifesto,
    validarXmlSaida,
    carregarChassisParaNicho,
    verificarMarcadoresDesignPackage,
};
module.exports = publicApi;
export { executarCompilacao, validarManifesto, validarXmlSaida, carregarChassisParaNicho, verificarMarcadoresDesignPackage };
