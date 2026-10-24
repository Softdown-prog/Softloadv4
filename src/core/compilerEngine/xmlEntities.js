"use strict";
// ==========================================
// SANITIZAÇÃO XML — hero HTML → XML válido para Blogger
// ==========================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.sanitizarEntidadesXml = sanitizarEntidadesXml;
exports.escaparTextoXml = escaparTextoXml;
exports.injetarHeroTexto = injetarHeroTexto;
// Entidades HTML nomeadas que são inválidas no XML do Blogger.
// CSS/JS ficam em CDATA (& é literal lá) — só hero HTML precisa disto.
const _HTML_ENTITIES = {
    '&bull;': '•', '&middot;': '·', '&hellip;': '…',
    '&rarr;': '→', '&larr;': '←', '&uarr;': '↑', '&darr;': '↓',
    '&harr;': '↔', '&rArr;': '⇒', '&lArr;': '⇐', '&hArr;': '⇔',
    '&copy;': '©', '&trade;': '™', '&reg;': '®',
    '&nbsp;': ' ', '&ensp;': ' ', '&emsp;': ' ', '&thinsp;': ' ',
    '&mdash;': '—', '&ndash;': '–',
    '&ldquo;': '“', '&rdquo;': '”', '&lsquo;': '‘', '&rsquo;': '’',
    '&laquo;': '«', '&raquo;': '»',
    '&euro;': '€', '&pound;': '£', '&yen;': '¥', '&cent;': '¢',
    '&deg;': '°', '&plusmn;': '±', '&times;': '×', '&divide;': '÷',
    '&frac12;': '½', '&frac14;': '¼', '&frac34;': '¾',
    '&sup1;': '¹', '&sup2;': '²', '&sup3;': '³',
    '&micro;': 'µ', '&para;': '¶', '&sect;': '§',
    '&dagger;': '†', '&Dagger;': '‡', '&permil;': '‰',
    '&prime;': '′', '&Prime;': '″',
    '&infin;': '∞', '&le;': '≤', '&ge;': '≥', '&ne;': '≠',
    '&equiv;': '≡', '&asymp;': '≈', '&minus;': '−',
    '&iexcl;': '¡', '&iquest;': '¿',
    '&loz;': '◊', '&spades;': '♠', '&clubs;': '♣', '&hearts;': '♥', '&diams;': '♦',
};
// Void elements HTML que precisam de auto-fechamento no XML do Blogger.
// HTML aceita <img src="..."> mas XML exige <img src="..." />
const _VOID_TAGS_RE = /^(img|br|hr|input|link|meta|col|area|base|embed|param|source|track|wbr)$/i;
function sanitizarEntidadesXml(html) {
    if (!html || typeof html !== 'string')
        return html;
    let s = html;
    for (const [entity, char] of Object.entries(_HTML_ENTITIES)) {
        if (s.includes(entity))
            s = s.split(entity).join(char);
    }
    // & residual que não é &amp; &lt; &gt; &quot; &apos; &#NNN; &#xHH;
    s = s.replace(/&(?!amp;|lt;|gt;|quot;|apos;|#\d+;|#x[0-9a-fA-F]+;)/g, '&amp;');
    // — Passo 2: void elements HTML → XML self-closing —
    // <img ...> → <img ... />   |   <br> → <br/>
    // Lookbehind (?<!/) preserva elementos já fechados (<img ... />)
    // Void elements: <img ...> → <img .../>  |  <br> → <br/>
    // Two-pass: (a) already self-closed (ends in /) → skip;
    //           (b) void tag not closed → add /
    s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)? *\/>/g, m => m); // keep closed ones
    s = s.replace(/<([a-zA-Z][a-zA-Z0-9]*)(\s[^>]*)?>/g, (match, tag, attrs) => {
        if (match.endsWith('/>'))
            return match; // already self-closed — skip to avoid <tag ...//>
        if (_VOID_TAGS_RE.test(tag))
            return '<' + tag + (attrs || '') + '/>';
        return match;
    });
    return s;
}
/**
 * Escapa & < > para conteúdo de texto XML (não escapa aspas — uso em texto, não atributo).
 */
function escaparTextoXml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
function injetarHeroTexto(html, titulo, subtitulo) {
    if (!html || typeof html !== 'string')
        return html;
    let s = html;
    if (titulo && String(titulo).trim()) {
        const t = escaparTextoXml(String(titulo).trim());
        s = s.replace(/(<(h[1-3])\b[^>]*>)([\s\S]*?)(<\/\2>)/i, (m, abre, _tag, _inner, fecha) => abre + t + fecha);
    }
    if (subtitulo && String(subtitulo).trim()) {
        const sub = escaparTextoXml(String(subtitulo).trim());
        if (/<p\b[^>]*>[\s\S]*?<\/p>/i.test(s)) {
            s = s.replace(/(<p\b[^>]*>)([\s\S]*?)(<\/p>)/i, (m, abre, _inner, fecha) => abre + sub + fecha);
        }
    }
    return s;
}
