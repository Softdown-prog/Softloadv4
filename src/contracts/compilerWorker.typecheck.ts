import { executarCompilacao, validarManifesto, validarXmlSaida, carregarChassisParaNicho, verificarMarcadoresDesignPackage } from '../core/compilerWorker';
import type { CompilerWorkerApi } from '../core/compilerWorker';
import type { WorkerCompilerBody } from '../core/workerOrchestrator';
import type { CompiledBloggerTheme } from './compiler';

const api: CompilerWorkerApi = { executarCompilacao, validarManifesto, validarXmlSaida, carregarChassisParaNicho, verificarMarcadoresDesignPackage };
const entrada: WorkerCompilerBody = { siteName: 'Site de Teste', modules: { darkMode: true }, heroHtml: '<h1>Olá</h1>' };
const resultado: CompiledBloggerTheme = api.executarCompilacao(entrada);
const erros: string[] = api.validarManifesto({ siteName: 'x' });
const avisos: string[] = api.validarXmlSaida('<html></html>');
const chassis: string = api.carregarChassisParaNicho(null);
const marcadores: { ok: boolean; erros: string[] } = api.verificarMarcadoresDesignPackage('<html/>');
void resultado; void erros; void avisos; void chassis; void marcadores;
// @ts-expect-error saída não é um número.
const invalido: number = api.executarCompilacao(entrada);
void invalido;
// @ts-expect-error validarXmlSaida recebe XML textual.
api.validarXmlSaida(42);
// @ts-expect-error campos de saída não podem ser texto em vez de lista.
const falhas: string = validarManifesto({});
void falhas;
