import { criarModelRouter, MODEL_FLASH, MODEL_PRO } from '../solaris/llm/modelRouter';
import type { SolarisModelRouter, SolarisGeminiClient, SolarisTokenUsage, SolarisFerramentasOptions, SolarisToolLoopResult, GeminiGenerationInput } from '../solaris/llm/modelRouter';
const client: SolarisGeminiClient = {
  models: {
    async generateContent(_input: GeminiGenerationInput) { return { text: 'ok' }; },
    async generateContentStream(_input: GeminiGenerationInput) { async function* output() { yield { text: 'ok' }; } return output(); },
  },
  chats: { create() { return { async sendMessage() { return { candidates: [{ content: { parts: [{ text: 'ok' }] } }] }; } }; } },
};
const router: SolarisModelRouter = criarModelRouter(() => client);
const tokens: Partial<SolarisTokenUsage> = {};
const stream: AsyncGenerator<string, void, unknown> = router.executarTriagemStream({ prompt: 'chat', tokensRef: tokens });
const toolsOptions: SolarisFerramentasOptions = {
  prompt: 'inspecione o projeto',
  tools: [{ functionDeclarations: [{ name: 'listFiles', parameters: { type: 'object' } }] }],
  executorFerramenta: async (_nome, _args) => ({ arquivos: [] }),
  onProgress: ({ nome }) => { void nome; },
};
const result: Promise<SolarisToolLoopResult> = router.executarTarefaComFerramentas(toolsOptions);
const triagem: Promise<string | undefined> = router.executarTriagem({ prompt: 'qual stack?' });
const arquitetura = router.executarTarefaArquitetura({ prompt: 'arquitetura', responseSchema: { type: 'OBJECT' }, thinkingBudget: 2048 });
const flash: string = MODEL_FLASH;
const pro: string = MODEL_PRO;
void stream; void result; void triagem; void arquitetura; void flash; void pro;
