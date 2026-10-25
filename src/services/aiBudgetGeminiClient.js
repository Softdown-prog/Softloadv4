"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.criarClienteGeminiComOrcamento = criarClienteGeminiComOrcamento;
/**
 * Proteção por chamada ao Gemini Pro (não por request HTTP).
 * Integrada pela rota Solaris apenas com SOLARIS_AI_BUDGET_ENFORCE=true.
 * Falhas ambíguas do provedor consomem a reserva integral: nunca liberar
 * orçamento se uma chamada pode ter sido faturada.
 */
const node_crypto_1 = require("node:crypto");
const aiBudgetLedger_1 = require("./aiBudgetLedger");
const geminiCost_1 = require("./geminiCost");
/** Valor deliberadamente pequeno enquanto calibramos os planos baratos. */
const MAX_OUTPUT_PADRAO = 8192;
function maximoOutput(valor) {
    return Number.isSafeInteger(valor) && valor >= 1024 && valor <= 16384 ? valor : MAX_OUTPUT_PADRAO;
}
function custoDaReserva(modelo, payload, tokensOutput, cambio) {
    // Bytes UTF-8 incluem instruções, schemas, tools e functionResponse.
    // É uma aproximação conservadora, NÃO garantia de teto físico de tokens.
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (!Number.isSafeInteger(bytes) || bytes > 1_000_000) {
        throw new aiBudgetLedger_1.OrcamentoIaIndisponivel('PROMPT_MUITO_GRANDE');
    }
    const entrada = bytes + 4096; // margem para serialização e tokens implícitos
    const custo = (0, geminiCost_1.estimarCustoGemini)({ modelo, entrada, saida: tokensOutput, cambioBrlPorUsd: cambio });
    if (!custo)
        throw new aiBudgetLedger_1.OrcamentoIaIndisponivel('MODELO_NAO_PRECIFICADO');
    return custo.custoMicroBrl;
}
function criarClienteGeminiComOrcamento(clientFactory, { email, livro, modeloPro, cambioBrlPorUsd = Number(process.env.GEMINI_USD_BRL_ESTIMATE ?? '5.20'), maxOutputTokens }) {
    if (!email || !email.includes('@') || !livro || !modeloPro) {
        throw new aiBudgetLedger_1.OrcamentoIaIndisponivel('GUARDA_NAO_CONFIGURADA');
    }
    const outputCap = maximoOutput(maxOutputTokens);
    async function chamadaProtegida(modelo, payload, cap, chamar) {
        const reservaMicroBrl = custoDaReserva(modelo, payload, cap, cambioBrlPorUsd);
        const reservado = await livro.reservar({ email, operacaoId: (0, node_crypto_1.randomUUID)(), reservaMicroBrl });
        if (reservado.status !== 'reservado') {
            throw new aiBudgetLedger_1.OrcamentoIaIndisponivel('OPERACAO_JA_CONCLUIDA');
        }
        let response;
        try {
            response = await chamar();
        }
        catch (erro) {
            try {
                await livro.liquidar({ reciboId: reservado.reciboId, custoRealMicroBrl: reservaMicroBrl });
            }
            catch (contaErro) {
                console.error('[IA-BUDGET] reserva retida; acerto pendente:', contaErro.message);
            }
            throw erro;
        }
        // Sem usageMetadata confiável, não liberar saldo: manter reserva inteira como estimativa.
        const tokens = (0, geminiCost_1.extrairTokensFaturaveisGemini)(response.usageMetadata);
        const custo = tokens && (0, geminiCost_1.estimarCustoGemini)({ ...tokens, modelo, cambioBrlPorUsd });
        const custoRealMicroBrl = custo?.custoMicroBrl ?? reservaMicroBrl;
        try {
            await livro.liquidar({ reciboId: reservado.reciboId, custoRealMicroBrl });
        }
        catch (erro) {
            // A reserva continua retida e a resposta válida deve chegar ao usuário.
            console.error('[IA-BUDGET] liquidação pendente:', erro.message);
        }
        return response;
    }
    return () => {
        const cliente = clientFactory();
        return {
            models: {
                async generateContent(input) {
                    if (input.model !== modeloPro)
                        return cliente.models.generateContent(input);
                    const cap = Math.min(input.config.maxOutputTokens, outputCap);
                    const limitado = { ...input, config: { ...input.config, maxOutputTokens: cap } };
                    return chamadaProtegida(input.model, limitado, cap, () => cliente.models.generateContent(limitado));
                },
                async generateContentStream(input) {
                    if (input.model === modeloPro)
                        throw new aiBudgetLedger_1.OrcamentoIaIndisponivel('STREAM_PRO_NAO_SUPORTADO');
                    return cliente.models.generateContentStream(input);
                },
            },
            chats: {
                create({ model, config }) {
                    if (model !== modeloPro)
                        return cliente.chats.create({ model, config });
                    const cap = Math.min(config.maxOutputTokens, outputCap);
                    const limitado = { ...config, maxOutputTokens: cap };
                    const chat = cliente.chats.create({ model, config: limitado });
                    return {
                        async sendMessage({ message }) {
                            return chamadaProtegida(model, { message, config: limitado }, cap, () => chat.sendMessage({ message }));
                        },
                    };
                },
            },
        };
    };
}
