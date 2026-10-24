import { inspecionarProjeto, INSPECAO_TOOLS, _executorFerramenta } from '../solaris/pipeline/projectInspector';
import type { ProjectInspectionOptions, ProjectInspectionResult, InspectionToolSchema } from '../solaris/pipeline/projectInspector';
const opts: ProjectInspectionOptions = {
    baseDir: '/tmp/projeto', arquivos: ['app.py'], framework: 'flask',
    modelRouter: { executarTarefaComFerramentas: async () => ({ texto: 'Resumo', iteracoes: 1, tokens: {} }) },
};
const inspected: Promise<ProjectInspectionResult> = inspecionarProjeto(opts);
const readOnly: Promise<unknown> = _executorFerramenta('/tmp/projeto', 'readFile', { caminho: 'app.py' });
const tools: InspectionToolSchema[] = INSPECAO_TOOLS;
void inspected; void readOnly; void tools;
