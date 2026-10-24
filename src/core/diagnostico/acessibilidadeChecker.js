"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.checarAcessibilidade = checarAcessibilidade;
// ──────────────────────────────────────────────────────────────────────────
// ACESSIBILIDADE CHECKER — análise estática do XML compilado, sem chamada
// de rede. Parte do "Diagnóstico Inteligente" (ver src/core/diagnostico/index.js).
// ──────────────────────────────────────────────────────────────────────────
// As regex de <img>/<button> abaixo rodam sobre texto solto — sem isso,
// JS/CSS embutido que contenha literalmente "<img" ou "<button" (comum em
// regex de extração de imagem tipo /<img.+?src="([^"]+)"/ dentro de
// <script>) engana o "sem fechamento >" e gera um match gigante e falso
// (achado real: viral-magazine acusava <img> sem alt vindo de uma regex JS
// de match, não de HTML de verdade). Remove o CONTEÚDO de <script>/<style>
// antes de auditar — a tag em si não muda de posição, então não afeta
// _checarLangNoHtml nem a contagem de linhas.
function _semScriptEStyle(xml) {
    return xml
        .replace(/(<script\b[^>]*>)[\s\S]*?(<\/script>)/gi, '$1$2')
        .replace(/(<style\b[^>]*>)[\s\S]*?(<\/style>)/gi, '$1$2');
}
function _checarImagensSemAlt(xml, achados) {
    const semAlt = xml.match(/<img(?![^>]*\balt=)[^>]*\/?>/g) || [];
    if (semAlt.length > 0) {
        achados.push({
            nivel: 'aviso',
            mensagem: `${semAlt.length} tag(s) <img> sem atributo alt — leitores de tela não conseguem descrever a imagem para quem não a vê.`,
        });
    }
}
function _checarLangNoHtml(xml, achados) {
    if (!/<html[^>]*(\blang=|expr:lang=)/.test(xml)) {
        achados.push({
            nivel: 'aviso',
            mensagem: 'Atributo lang ausente na tag <html> — leitores de tela não sabem em qual idioma pronunciar o conteúdo.',
        });
    }
}
// Botão sem texto visível (só ícone) e sem aria-label/expr:aria-label —
// comum em toggles de dark mode, busca, menu mobile.
function _checarBotoesSemLabel(xml, achados) {
    const re = /<button\b([^>]*)>([\s\S]*?)<\/button>/g;
    let m;
    let semLabel = 0;
    while ((m = re.exec(xml)) !== null) {
        const [, attrs, inner] = m;
        if (/aria-label=/.test(attrs))
            continue; // cobre expr:aria-label= também
        const textoPuro = inner.replace(/<[^>]*>/g, '').replace(/\s+/g, '');
        if (textoPuro === '')
            semLabel++;
    }
    if (semLabel > 0) {
        achados.push({
            nivel: 'aviso',
            mensagem: `${semLabel} <button> só com ícone (sem texto) e sem aria-label — leitores de tela anunciam "botão" sem dizer pra que serve.`,
        });
    }
}
/**
 * Audita acessibilidade estrutural de um XML Blogger já compilado.
 * @param {string} xml
 * @returns {{ nivel: 'erro'|'aviso', mensagem: string }[]}
 */
function checarAcessibilidade(xml) {
    const achados = [];
    const xmlSemScriptEStyle = _semScriptEStyle(xml);
    _checarImagensSemAlt(xmlSemScriptEStyle, achados);
    _checarLangNoHtml(xml, achados);
    _checarBotoesSemLabel(xmlSemScriptEStyle, achados);
    return achados;
}
