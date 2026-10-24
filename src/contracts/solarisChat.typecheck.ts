import { criarSolarisChat } from '../solaris/chat/solarisChat';
import type { SolarisChat, SolarisChatOptions, SolarisHistoricoMensagem, BuscarConhecimentoSolarisChat } from '../solaris/chat/solarisChat';
import type { SolarisTokenUsage } from '../solaris/llm/modelRouter';

const conhecimento: BuscarConhecimentoSolarisChat = async ({ query, topK }) => ({ resultados: [{ entryId: String(topK), texto: query }] });
const options: SolarisChatOptions = {
    buscarConhecimento: conhecimento,
    modelRouter: {
        executarTriagem: async () => 'resposta',
        async *executarTriagemStream() { yield 'resposta'; },
    },
};
const chat: SolarisChat = criarSolarisChat(options);
const historico: SolarisHistoricoMensagem[] = [{ autor: 'usuario', texto: 'olá' }];
const tokens: Partial<SolarisTokenUsage> = {};
const resposta: Promise<string | undefined> = chat.perguntar('ajude no projeto', historico);
const streaming: AsyncGenerator<string, void, unknown> = chat.perguntarStream('ajude no projeto', historico, tokens);
void resposta; void streaming;
