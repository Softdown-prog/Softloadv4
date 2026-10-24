import { validarCss } from '../solaris/workers/cssWorker';
import type { SolarisWorkerResult, CssAnalysis } from '../solaris/workers/cssWorker';
const result: SolarisWorkerResult<CssAnalysis> = validarCss('', { tokensExternos: [] });
const hasErrors: boolean = result.erros.length > 0;
void hasErrors;
