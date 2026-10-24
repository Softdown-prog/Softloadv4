"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RAG_ENTRY_RESPONSE_SCHEMA = void 0;
exports.gerarEntradaCatalogo = gerarEntradaCatalogo;
// ============================================================
// SOLARIS RAG ENTRY GENERATOR — Etapa 3 do pipeline de geração
// (o único estágio onde IA entra)
// ============================================================
// Recebe UM tópico (ex.: grupo "bootstrap5", tópico "accordion") e
// devolve UM objeto pronto pro formato de catálogo — nunca gera lote,
// nunca decide sozinho quais tópicos existem (isso é ragTopicMatrix.js,
// determinístico). `responseSchema` (Gemini structured output) força o
// formato de saída na 1ª camada, mesmo padrão de manifestSchema.js/
// pecaRequestSchema.js — a 2ª camada de verificação real continua
// sendo `ragKebabWorker.validarEntradaGerada` (nunca confia que o
// schema sozinho garante qualidade de conteúdo).
// ============================================================
const { Type } = require('@google/genai');
const { idParaTopico } = require('./ragTopicMatrix');
exports.RAG_ENTRY_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    required: ['slug', 'categoria', 'descricao', 'componentes', 'keywords'],
    properties: {
        slug: {
            type: Type.STRING,
            description: 'Sempre igual ao id fornecido no prompt (grupo-topico), kebab-case.',
        },
        categoria: {
            type: Type.STRING,
            description: 'Tipo de referência: "framework", "backend", "linguagem" ou "topico" (recurso específico dentro de um framework/linguagem maior).',
        },
        descricao: {
            type: Type.STRING,
            description: 'Resumo técnico de 2-4 frases do que é este recurso e quando usá-lo — nunca vazio, nunca genérico ao ponto de servir pra qualquer tópico.',
        },
        componentes: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Classes/elementos/funções/atributos concretos associados a este tópico (ex. pro Accordion do Bootstrap: "accordion-item", "accordion-button", "data-bs-toggle").',
        },
        exemplos: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Trechos de código curtos e reais ilustrando o uso — cada item é um snippet, não um tutorial inteiro.',
        },
        boas_praticas: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Recomendações práticas específicas deste tópico (acessibilidade, performance, convenção) — opcional.',
        },
        keywords: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'Termos que um usuário digitaria pra pedir isso num brainstorm (sinônimos, nome popular, variações em português/inglês).',
        },
    },
};
function _montarPrompt(grupo, topico) {
    const id = idParaTopico(grupo, topico);
    return [
        `Você é uma fonte de referência técnica precisa sobre "${grupo}".`,
        `Tópico específico: "${topico}".`,
        '',
        `Gere UMA entrada de catálogo de conhecimento técnico sobre esse tópico específico, pra ser consumida por um sistema de geração de sites (Solaris Code).`,
        `O campo "slug" da resposta deve ser exatamente "${id}".`,
        `Nunca invente API/classe/atributo que não existe de verdade em ${grupo} — se não tiver certeza de um exemplo, prefira omitir a listar algo incorreto.`,
        `Responda só com o conteúdo técnico do tópico "${topico}" — não descreva ${grupo} inteiro, não fuja do escopo.`,
    ].join('\n');
}
/**
 * Gera uma entrada de catálogo pra um tópico via Gemini (Flash, JSON
 * mode). Puro wrapper — não valida conteúdo (ver
 * ragKebabWorker.validarEntradaGerada), não grava em disco (ver
 * scripts/ragGenerate.js).
 *
 * @returns {Promise<object>} entrada com id/slug preenchidos, pronta
 *   pra passar pelo Validador.
 */
async function gerarEntradaCatalogo({ grupo, topico, modelRouter }) {
    if (!grupo || typeof grupo !== 'string')
        throw new Error('[SOLARIS-RAG-GEN] grupo é obrigatório.');
    if (!topico || typeof topico !== 'string')
        throw new Error('[SOLARIS-RAG-GEN] topico é obrigatório.');
    if (!modelRouter)
        throw new Error('[SOLARIS-RAG-GEN] modelRouter é obrigatório.');
    const id = idParaTopico(grupo, topico);
    const prompt = _montarPrompt(grupo, topico);
    const bruto = await modelRouter.executarTriagem({
        prompt,
        responseSchema: exports.RAG_ENTRY_RESPONSE_SCHEMA,
    });
    let entrada;
    try {
        entrada = JSON.parse(bruto);
    }
    catch (err) {
        throw new Error(`[SOLARIS-RAG-GEN] resposta do Gemini não é JSON válido pra "${id}": ${err.message}`);
    }
    // Spread primeiro, override por último — garante que id/slug finais
    // sejam sempre o valor computado aqui, nunca o que o modelo (ou um
    // "slug" divergente devolvido por engano) tenha colocado na resposta.
    return { titulo: `${grupo} — ${topico}`, ...entrada, id, slug: id };
}
