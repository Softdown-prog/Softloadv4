import { validarJs } from '../solaris/workers/jsWorker';
import type { SolarisWorkerResult, JsAnalysis } from '../solaris/workers/jsWorker';
const result: SolarisWorkerResult<JsAnalysis> = validarJs('');
const hasErrors: boolean = result.erros.length > 0;
void hasErrors;
