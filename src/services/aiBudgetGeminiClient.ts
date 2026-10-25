/**
 * Proteção por chamada ao Gemini Pro (não por request HTTP).
 * Integrada pela rota Solaris apenas com SOLARIS_AI_BUDGET_ENFORCE=true.
 * Falhas ambíguas do provedor consomem a reserva integral: nunca liberar
 * orçamento se uma chamada pode ter sido faturada.
 */
import { randomUUID } from 'node:crypto';
import type { SolarisClientFactory, SolarisGeminiClient, GeminiResponse, GeminiGenerationInput, GeminiChatMessage } from '../solaris/llm/modelRouter';
import type { criarLivroRazaoIa } from './aiBudgetLedger';
import { OrcamentoIaIndisponivel } from './aiBudgetLedger';
import { estimarCustoGemini, extrairTokensFaturaveisGemini } from './geminiCost';

type LivroRazao = ReturnType<typeof criarLivroRazaoIa>;
export interface GuardarProOpcoes {
    email: string;
    livro: LivroRazao;
    modeloPro: string;
    cambioBrlPorUsd?: number;
    maxOutputTokens?: number;
}
type GenInput = GeminiGenerationInput;
type ChatConfig = Parameters<SolarisGeminiClient['chats']['create']>[0]['config'];

/** Valor deliberadamente pequeno enquanto calibramos os planos baratos. */
const MAX_OUTPUT_PADRAO = 8192;
function maximoOutput(valor: number | undefined): number {
    return Number.isSafeInteger(valor) && valor! >= 1024 && valor! <= 16384 ? valor! : MAX_OUTPUT_PADRAO;
}
function custoDaReserva(modelo: string, payload: unknown, tokensOutput: number, cambio: number): number {
    // Bytes UTF-8 incluem instruções, schemas, tools e functionResponse.
    // É uma aproximação conservadora, NÃO garantia de teto físico de tokens.
    const bytes = Buffer.byteLength(JSON.stringify(payload), 'utf8');
    if (!Number.isSafeInteger(bytes) || bytes > 1_000_000) {
        throw new OrcamentoIaIndisponivel('PROMPT_MUITO_GRANDE');
    }
    const entrada = bytes + 4096; // margem para serialização e tokens implícitos
    const custo = estimarCustoGemini({ modelo, entrada, saida: tokensOutput, cambioBrlPorUsd: cambio });
    if (!custo) throw new OrcamentoIaIndisponivel('MODELO_NAO_PRECIFICADO');
    return custo.custoMicroBrl;
}
export function criarClienteGeminiComOrcamento(
    clientFactory: SolarisClientFactory,
    { email, livro, modeloPro, cambioBrlPorUsd = Number(process.env.GEMINI_USD_BRL_ESTIMATE ?? '5.20'), maxOutputTokens }: GuardarProOpcoes,
): SolarisClientFactory {
    if (!email || !email.includes('@') || !livro || !modeloPro) {
        throw new OrcamentoIaIndisponivel('GUARDA_NAO_CONFIGURADA');
    }
    const outputCap = maximoOutput(maxOutputTokens);

    async function chamadaProtegida(
        modelo: string, payload: unknown, cap: number, chamar: () => Promise<GeminiResponse>,
    ): Promise<GeminiResponse> {
        const reservaMicroBrl = custoDaReserva(modelo, payload, cap, cambioBrlPorUsd);
        const reservado = await livro.reservar({ email, operacaoId: randomUUID(), reservaMicroBrl });
        if (reservado.status !== 'reservado') {
            throw new OrcamentoIaIndisponivel('OPERACAO_JA_CONCLUIDA');
        }
        let response: GeminiResponse;
        try {
            response = await chamar();
        } catch (erro) {
            try {
                await livro.liquidar({ reciboId: reservado.reciboId, custoRealMicroBrl: reservaMicroBrl });
            } catch (contaErro) {
                console.error('[IA-BUDGET] reserva retida; acerto pendente:', (contaErro as Error).message);
            }
            throw erro;
        }
        // Sem usageMetadata confiável, não liberar saldo: manter reserva inteira como estimativa.
        const tokens = extrairTokensFaturaveisGemini(response.usageMetadata);
        const custo = tokens && estimarCustoGemini({ ...tokens, modelo, cambioBrlPorUsd });
        const custoRealMicroBrl = custo?.custoMicroBrl ?? reservaMicroBrl;
        try {
            await livro.liquidar({ reciboId: reservado.reciboId, custoRealMicroBrl });
        } catch (erro) {
            // A reserva continua retida e a resposta válida deve chegar ao usuário.
            console.error('[IA-BUDGET] liquidação pendente:', (erro as Error).message);
        }
        return response;
    }

    return () => {
        const cliente = clientFactory();
        return {
            models: {
                async generateContent(input: GenInput): Promise<GeminiResponse> {
                    if (input.model !== modeloPro) return cliente.models.generateContent(input);
                    const cap = Math.min(input.config.maxOutputTokens, outputCap);
                    const limitado = { ...input, config: { ...input.config, maxOutputTokens: cap } };
                    return chamadaProtegida(input.model, limitado, cap, () => cliente.models.generateContent(limitado));
                },
                async generateContentStream(input: GenInput): Promise<AsyncIterable<GeminiResponse>> {
                    if (input.model === modeloPro) throw new OrcamentoIaIndisponivel('STREAM_PRO_NAO_SUPORTADO');
                    return cliente.models.generateContentStream(input);
                },
            },
            chats: {
                create({ model, config }: { model: string; config: ChatConfig }) {
                    if (model !== modeloPro) return cliente.chats.create({ model, config });
                    const cap = Math.min(config.maxOutputTokens, outputCap);
                    const limitado = { ...config, maxOutputTokens: cap };
                    const chat = cliente.chats.create({ model, config: limitado });
                    return {
                        async sendMessage({ message }: { message: GeminiChatMessage }): Promise<GeminiResponse> {
                            return chamadaProtegida(model, { message, config: limitado }, cap, () => chat.sendMessage({ message }));
                        },
                    };
                },
            },
        };
    };
}
