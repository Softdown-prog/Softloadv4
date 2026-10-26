'use strict';
interface UsageMetadata { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number; cachedContentTokenCount?: number }
interface ArchitectureOptions { prompt?: unknown; [field: string]: unknown }
interface ArchitectureAnswer { text?: unknown; usageMetadata?: UsageMetadata; [field: string]: unknown }
interface ArchitectureRouter { executarTarefaArquitetura(options: ArchitectureOptions): Promise<ArchitectureAnswer> }
interface UsageCount { input: number; output: number; chamadas: number; estimadas: number }
interface OrchestratorSetup<T> {
  modelRouter: ArchitectureRouter;
  buscarConhecimento: unknown;
  criarOrquestrador(args: { modelRouter: ArchitectureRouter; buscarConhecimento: unknown }): T;
}
declare const require: (id: string) => unknown;
declare const module: { exports: unknown };

/**
 * Agrega usageMetadata do Gemini Pro por requisição, não por singleton.
 * Inclui thoughtsTokenCount, que é faturável. Quando o provedor não fornece
 * metadados, estima apenas a chamada sem medição e registra a ocorrência.
 * O ledger V2 (quando ativado) continua responsável pela cobrança monetária
 * por chamada; esta agregação atende auditoria e débito do modo legado.
 */
const {extrairTokensFaturaveisGemini}=require('../../services/geminiCost') as { extrairTokensFaturaveisGemini(usage: UsageMetadata | undefined): { entrada: number; saida: number } | null };

function criarOrquestradorComMedicao<T>({modelRouter,buscarConhecimento,criarOrquestrador}: OrchestratorSetup<T>): {orquestrador:T;contagem:UsageCount} {
  if(!modelRouter || typeof modelRouter.executarTarefaArquitetura!=='function'
    || typeof criarOrquestrador!=='function') throw new TypeError('Orquestrador inválido');
  const contagem: UsageCount={input:0,output:0,chamadas:0,estimadas:0};
  const modelRouterMedido: ArchitectureRouter={
    async executarTarefaArquitetura(options: ArchitectureOptions): Promise<ArchitectureAnswer> {
      const resposta=await modelRouter.executarTarefaArquitetura(options);
      contagem.chamadas++;
      const real=extrairTokensFaturaveisGemini(resposta?.usageMetadata);
      const input=real?.entrada??Math.ceil(String(options?.prompt||'').length/3.5);
      const output=real?.saida??Math.ceil(String(resposta?.text||'').length/3.5);
      if(!real)contagem.estimadas++;
      if(!Number.isSafeInteger(input)||input<0||!Number.isSafeInteger(output)||output<0
        ||!Number.isSafeInteger(contagem.input+input)||!Number.isSafeInteger(contagem.output+output))
        throw new TypeError('Medição de tokens inválida');
      contagem.input+=input;
      contagem.output+=output;
      return resposta;
    }
  };
  const orquestrador=criarOrquestrador({modelRouter:modelRouterMedido,buscarConhecimento});
  return {orquestrador,contagem};
}
module.exports={criarOrquestradorComMedicao};

export {};
