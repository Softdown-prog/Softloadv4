'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Agrega usageMetadata do Gemini Pro por requisição, não por singleton.
 * Inclui thoughtsTokenCount, que é faturável. Quando o provedor não fornece
 * metadados, estima apenas a chamada sem medição e registra a ocorrência.
 * O ledger V2 (quando ativado) continua responsável pela cobrança monetária
 * por chamada; esta agregação atende auditoria e débito do modo legado.
 */
const { extrairTokensFaturaveisGemini } = require('../../services/geminiCost');
function criarOrquestradorComMedicao({ modelRouter, buscarConhecimento, criarOrquestrador }) {
    if (!modelRouter || typeof modelRouter.executarTarefaArquitetura !== 'function'
        || typeof criarOrquestrador !== 'function')
        throw new TypeError('Orquestrador inválido');
    const contagem = { input: 0, output: 0, chamadas: 0, estimadas: 0 };
    const modelRouterMedido = {
        async executarTarefaArquitetura(options) {
            const resposta = await modelRouter.executarTarefaArquitetura(options);
            contagem.chamadas++;
            const real = extrairTokensFaturaveisGemini(resposta?.usageMetadata);
            const input = real?.entrada ?? Math.ceil(String(options?.prompt || '').length / 3.5);
            const output = real?.saida ?? Math.ceil(String(resposta?.text || '').length / 3.5);
            if (!real)
                contagem.estimadas++;
            if (!Number.isSafeInteger(input) || input < 0 || !Number.isSafeInteger(output) || output < 0
                || !Number.isSafeInteger(contagem.input + input) || !Number.isSafeInteger(contagem.output + output))
                throw new TypeError('Medição de tokens inválida');
            contagem.input += input;
            contagem.output += output;
            return resposta;
        }
    };
    const orquestrador = criarOrquestrador({ modelRouter: modelRouterMedido, buscarConhecimento });
    return { orquestrador, contagem };
}
module.exports = { criarOrquestradorComMedicao };
