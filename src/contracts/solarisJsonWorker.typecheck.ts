import { validarJson } from '../solaris/workers/jsonWorker';
import type { SolarisWorkerResult } from '../solaris/workers/jsonWorker';
const result: SolarisWorkerResult = validarJson('{}');
const valid: boolean = result.ok;
const errors: string[] = result.erros;
const warnings: string[] = result.avisos;
void valid;
void errors;
void warnings;
