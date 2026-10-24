import {
    perguntarAoSol, executeSolTool, _caminhoSeguro,
    _buscarNoCodigo, _statusNichos, SOL_TOOL_DECLARATIONS,
} from '../ai/solAgent';
import type {
    SolToolArgs, SolConversationMessage, SolProgressEvent, SolAgentReply,
    SolCodeSearchResult, SolBudget, SolNichoStatus,
} from '../ai/solAgent';

const path: string | null = _caminhoSeguro('src/core');
const query: SolCodeSearchResult = _buscarNoCodigo('resolverModulos');
const status: SolNichoStatus = _statusNichos();
const message: SolConversationMessage = { role: 'user', content: 'Como funciona o compilador?' };
const args: SolToolArgs = { pasta: 'src/core' };
const evt: SolProgressEvent = { type: 'status', label: 'Verificando...' };
const run = (budget: SolBudget): Promise<unknown> => executeSolTool('listar_arquivos', args, budget);
const reply: Promise<SolAgentReply> = perguntarAoSol([message], 'Explique o compilador', { onProgress: () => void evt });
const functions: string[] = SOL_TOOL_DECLARATIONS.functionDeclarations.map(fn => fn.name);
void path; void query; void status; void run; void reply; void functions;
