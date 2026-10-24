import { montarSolarisMdInicial, inicializarSolarisMd, registrarMudancasNoSolarisMd, SOLARIS_MD } from '../solaris/pipeline/projectMemory';
import type { SolarisProjectDescription, SolarisAppliedChange } from '../solaris/pipeline/projectMemory';
const project: SolarisProjectDescription = { objetivo: 'Site', framework: 'html5', arquivos: [{ caminho: 'index.html', tipo: 'html' }] };
const initial: string = montarSolarisMdInicial(project);
const change: SolarisAppliedChange = { caminho: 'index.html', operacao: 'editar', resumo: 'Melhoria visual' };
const write: void = inicializarSolarisMd('/tmp/projeto', project);
const changed: void = registrarMudancasNoSolarisMd('/tmp/projeto', [change]);
const name: string = SOLARIS_MD;
void initial; void write; void changed; void name;
