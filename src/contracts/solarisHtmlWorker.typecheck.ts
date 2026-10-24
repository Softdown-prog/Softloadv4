import { validarHtml } from '../solaris/workers/htmlWorker';
import type { SolarisWorkerResult, HtmlAnalysis } from '../solaris/workers/htmlWorker';
const result: SolarisWorkerResult<HtmlAnalysis> = validarHtml('');
const hasErrors: boolean = result.erros.length > 0;
void hasErrors;
