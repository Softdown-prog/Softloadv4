'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const { COLOR_PRESETS } = require('../../../core/presets');
// Constrói contexto rico do template para injeção permanente no system prompt.
// Chamado quando o chat é aberto a partir de uma sessão de workspace.
function montarContextoWorkspace(snapshot) {
    const cor = COLOR_PRESETS[snapshot.colorPreset] || COLOR_PRESETS['tech-blue'];
    const linhas = [
        `\n\n---`,
        `## TEMPLATE DO USUÁRIO — CONTEXTO PERMANENTE`,
        `O usuário abriu este chat a partir do Workspace do Softload Engine.`,
        `Você JÁ CONHECE o template dele. Não pergunte sobre cores, tipografia ou layout — essas informações estão abaixo.`,
        `ESCOPO: este contexto serve para personalizar o código do template existente (CSS, JS, widgets). Em respostas educacionais (esqueletos, exemplos, "como funciona o XML") — NÃO mencione o nome do blog do usuário nem use as cores abaixo como referência; responda de forma genérica.`,
        ``,
        `**Blog/Site:** ${snapshot.siteName || 'Sem nome'}`,
        `**Preset de cores:** ${snapshot.colorPreset} — ${cor.label || ''}`,
        `  • --sl-primary:   ${cor.primary   || '?'}`,
        `  • --sl-bg-body:   ${cor.bgBody    || '?'}`,
        `  • --sl-card-bg:   ${cor.cardBg    || '?'}`,
        `  • --sl-text-main: ${cor.textMain  || '?'}`,
        `  • --sl-footer-bg: ${cor.footerBg  || '?'}`,
        `**Tipografia:** ${snapshot.typography || 'inter'}`,
        `**Layout grid:** ${snapshot.gridLayout || 'mural'}`,
        ``,
        `Ao gerar qualquer CSS ou JS para este usuário, use EXATAMENTE essas variáveis CSS.`,
        `Ao sugerir melhorias, leve em conta o estilo visual e a tipografia do template deles.`,
    ].filter(l => l !== null);
    return linhas.join('\n');
}
module.exports = {
    montarContextoWorkspace,
};
