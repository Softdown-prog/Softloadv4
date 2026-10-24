"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checarResponsividade = checarResponsividade;
// ──────────────────────────────────────────────────────────────────────────
// RESPONSIVIDADE CHECKER — análise estática do XML compilado, sem chamada
// de rede. Parte do "Diagnóstico Inteligente" (ver src/core/diagnostico/index.js).
// ──────────────────────────────────────────────────────────────────────────
/**
 * Audita responsividade estrutural de um XML Blogger já compilado.
 * @param {string} xml
 * @returns {{ nivel: 'erro'|'aviso', mensagem: string }[]}
 */
function checarResponsividade(xml) {
    const achados = [];
    const viewportMatch = xml.match(/<meta[^>]*name=['"]viewport['"][^>]*>/);
    if (!viewportMatch) {
        achados.push({
            nivel: 'erro',
            mensagem: 'Meta viewport ausente — o site não se adapta a telas de celular; o Google usa indexação mobile-first e penaliza isso diretamente.',
        });
    }
    else if (!/width=device-width/.test(viewportMatch[0])) {
        achados.push({
            nivel: 'aviso',
            mensagem: "Meta viewport presente mas sem 'width=device-width' — pode não escalar corretamente em telas pequenas.",
        });
    }
    const totalMediaQueries = (xml.match(/@media/g) || []).length;
    if (totalMediaQueries === 0) {
        achados.push({
            nivel: 'aviso',
            mensagem: 'Nenhuma media query (@media) encontrada no CSS — o layout provavelmente não se adapta por tamanho de tela.',
        });
    }
    return achados;
}
