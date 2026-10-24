"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TIPOS_VALIDOS = exports.GEMINI_PECA_RESPONSE_SCHEMA = void 0;
exports.validarPeca = validarPeca;
// ============================================================
// PECA REQUEST SCHEMA — schema de geração de UMA peça de dossiê
// (hero/widget/modulo) por IA.
// ============================================================
// Espelha templateEditSchema.js: schema Gemini restrito (primeira
// camada) + validador server-side (segunda camada) que descarta
// campo inválido em vez de invalidar a peça inteira, exceto pros
// campos sem os quais a peça não é usável (tipo/css/html/js).
//
// Diferente de templateEditSchema.js (edição de manifesto, tudo
// opcional): aqui a peça precisa nascer usável. "id" e "protegida"
// NUNCA vêm da IA — id é atribuído pelo orquestrador (determinístico,
// a partir da descrição), protegida é sempre false na saída da IA
// (só humano marca uma peça como protegida contra substituição).
// ============================================================
const { Type } = require('@google/genai');
const TIPOS_VALIDOS = ['hero', 'widget', 'modulo'];
exports.TIPOS_VALIDOS = TIPOS_VALIDOS;
// ──────────────────────────────────────────────────────────────────────────
// GEMINI_PECA_RESPONSE_SCHEMA
// ──────────────────────────────────────────────────────────────────────────
const GEMINI_PECA_RESPONSE_SCHEMA = {
    type: Type.OBJECT,
    required: ['tipo', 'css', 'html', 'js', 'descricao'],
    properties: {
        tipo: {
            type: Type.STRING,
            enum: TIPOS_VALIDOS,
            description: '"hero" = seção principal única do nicho. "widget" = componente autocontido (position fixed/absolute, ex: cookie banner, botão flutuante). "modulo" = CSS/JS que estiliza/comporta elemento já existente no chassis, sem HTML próprio.',
        },
        domIds: {
            type: Type.ARRAY,
            items: { type: Type.STRING },
            description: 'IDs de elementos que o html desta peça declara (ex: ["meu-widget", "meu-widget-btn"]). Vazio se a peça não tem html próprio (tipo "modulo" estilizando elemento existente).',
        },
        css: { type: Type.STRING, description: 'CSS da peça. String vazia se não se aplica.' },
        html: { type: Type.STRING, description: 'HTML da peça. String vazia se a peça só estiliza/comporta elemento já existente (tipo "modulo").' },
        js: { type: Type.STRING, description: 'JS da peça, sem tag <script>. String vazia se não se aplica.' },
        descricao: { type: Type.STRING, description: 'Frase curta em PT-BR descrevendo o que a peça faz.' },
    },
};
exports.GEMINI_PECA_RESPONSE_SCHEMA = GEMINI_PECA_RESPONSE_SCHEMA;
// ──────────────────────────────────────────────────────────────────────────
// validarPeca — segunda linha de defesa server-side.
// tipo/css/html/js ausentes ou malformados invalidam a peça inteira (ao
// contrário de validarEdicao, aqui não existe "peça parcialmente válida"
// utilizável). domIds/descricao malformados são descartados com aviso.
// Retorna { valido, erros, peca } — peca é null quando valido=false.
// ──────────────────────────────────────────────────────────────────────────
function validarPeca(obj) {
    const erros = [];
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
        return { valido: false, erros: ['Resposta de peça não é um objeto JSON.'], peca: null };
    }
    const input = obj;
    let fatal = false;
    if (typeof input.tipo !== 'string' || !TIPOS_VALIDOS.includes(input.tipo)) {
        erros.push(`"tipo": ausente ou inválido (esperado um de ${TIPOS_VALIDOS.join('/')}) — peça inválida.`);
        fatal = true;
    }
    for (const campo of ['css', 'html', 'js']) {
        if (input[campo] !== undefined && typeof input[campo] !== 'string') {
            erros.push(`"${campo}": deve ser string — peça inválida.`);
            fatal = true;
        }
    }
    const css = typeof input.css === 'string' ? input.css : '';
    const html = typeof input.html === 'string' ? input.html : '';
    const js = typeof input.js === 'string' ? input.js : '';
    if (!css.trim() && !html.trim() && !js.trim()) {
        erros.push('peça sem css/html/js algum — nada pra persistir — peça inválida.');
        fatal = true;
    }
    if (fatal) {
        return { valido: false, erros, peca: null };
    }
    let domIds = [];
    if (input.domIds !== undefined) {
        if (Array.isArray(input.domIds) && input.domIds.every(x => typeof x === 'string' && x.trim())) {
            domIds = input.domIds;
        }
        else {
            erros.push('"domIds": formato inválido, ignorado (peça segue sem domIds declarado).');
        }
    }
    const descricao = typeof input.descricao === 'string' ? input.descricao.trim() : '';
    const peca = {
        tipo: input.tipo,
        protegida: false,
        domIds,
        css, html, js,
        descricao,
    };
    return { valido: true, erros, peca };
}
module.exports = {
    GEMINI_PECA_RESPONSE_SCHEMA,
    TIPOS_VALIDOS,
    validarPeca,
};
