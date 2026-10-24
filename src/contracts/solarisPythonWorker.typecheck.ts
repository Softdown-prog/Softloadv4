import { validarPy } from '../solaris/workers/pythonWorker';
import type { SolarisWorkerResult } from '../solaris/workers/pythonWorker';
const result: SolarisWorkerResult = validarPy('print(1)');
const valid: boolean = result.ok;
const errors: string[] = result.erros;
const warnings: string[] = result.avisos;
void valid;
void errors;
void warnings;
