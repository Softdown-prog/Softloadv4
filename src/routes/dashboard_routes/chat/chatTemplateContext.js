'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { db } = require('../../../services/firebase');
const { COLOR_PRESETS } = require('../../../core/presets');
// ──────────────────────────────────────────────────────────────────────────
// Busca o template mais recente do usuário no Firestore.
// Retorna { siteName, colorPreset } ou null se não houver compilação.
// ──────────────────────────────────────────────────────────────────────────
async function buscarContextoTemplate(email) {
    try {
        const snap = await db.collection('clientes_premium')
            .doc(email.toLowerCase())
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(1)
            .get();
        if (snap.empty)
            return null;
        const d = snap.docs[0].data();
        return {
            siteName: d.siteName || null,
            colorPreset: d.colorPreset || 'tech-blue',
        };
    }
    catch (err) {
        console.warn('[ESPECIALISTA] buscarContextoTemplate err:', err.message);
        return null;
    }
}
// Formata os tokens de design do template para injeção no system prompt.
function montarContextoTemplate(data) {
    const cor = COLOR_PRESETS[data.colorPreset] || COLOR_PRESETS['tech-blue'];
    return `
## CONTEXTO DO TEMPLATE ATIVO DO USUÁRIO
Blog: ${data.siteName || 'sem nome'}
Paleta: ${data.colorPreset} (${cor.label})
  - Cor primária: ${cor.primary}
  - Fundo do body: ${cor.bgBody}
  - Fundo do card: ${cor.cardBg}
  - Texto principal: ${cor.textMain}
  - Rodapé: ${cor.footerBg}
Ao gerar CSS ou JS, use estas cores exatas. Adapte bordas e sombras ao estilo visual do template.`;
}
// Detecta se a mensagem pede geração de código ou personalização visual.
function precisaContextoTemplate(msg) {
    // cor(es)? — antes era "cores?", que exige "core"/"cores" e nunca batia
    // com "cor" no singular (ex: "muda a cor"), o caso mais comum de edição.
    // tipografia/hero/título/layout/logo/rodapé/sidebar/menu/grid/escuro/categoria
    // — termos de campos editáveis pelo worker de edição (ver templateEditSchema.js)
    // que ainda não estavam cobertos aqui.
    return /\bcss\b|\bjavascript\b|\bjs\b|widget|banner|snippet|personaliz|adapt|cor(es)?|fontes?|tipografia|\bhero\b|t[íi]tulo|layout|logo|rodap[ée]|sidebar|menu|\bgrid\b|escuro|categoria|botão|estilo|código|gerar um|criar um|copiar|colar/i.test(msg);
}
module.exports = {
    buscarContextoTemplate,
    montarContextoTemplate,
    precisaContextoTemplate,
};
