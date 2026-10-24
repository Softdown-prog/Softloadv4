import { validarEjs } from '../solaris/workers/ejsWorker';
import type { SolarisWorkerResult, EjsAnalysis } from '../solaris/workers/ejsWorker';
const result: SolarisWorkerResult<EjsAnalysis> = validarEjs('<h1><%= title %></h1>');
const valid: boolean = result.ok;
const errors: string[] = result.erros;
const warnings: string[] = result.avisos;
void valid;
void errors;
void warnings;
