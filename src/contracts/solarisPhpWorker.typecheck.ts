import { validarPhp } from '../solaris/workers/phpWorker';
import type { SolarisWorkerResult, PhpAnalysis } from '../solaris/workers/phpWorker';
const result: SolarisWorkerResult<PhpAnalysis> = validarPhp('<?php echo 1;');
const valid: boolean = result.ok;
const errors: string[] = result.erros;
const warnings: string[] = result.avisos;
void valid;
void errors;
void warnings;
