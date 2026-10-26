
'use strict';

// ============================================================
// Converte o XML de um template Blogger em HTML renderizável para
// preview (dashboard → historico.js).
//
// Até ago/2026 este arquivo era puramente regex/substituição de
// string, com uma lista pequena e hardcoded de condições `b:if` que
// sabia resolver e um `b:loop` com só 3 posts fictícios embutidos no
// próprio regex. Achado real: isso quebrava para praticamente todo
// nicho (não só os migrados pra esqueleto próprio) — valores de
// widget-setting (true/false, números, enums) vazavam como texto
// bruto na página, e includables não-`main` com lógica real
// (postAuthor, postLabels, footerBylines, sharingButtonsMenu...)
// eram descartados inteiros em vez de resolvidos, fazendo autor,
// labels, timestamp e botões de compartilhar sumirem do preview.
//
// Correção: a resolução de b:if/b:elseif/b:else, b:loop, b:with,
// b:include, b:widget/b:widget-settings, b:includable, b:section,
// data:* e expr:* agora passa por um interpretador determinístico
// real (bloggerTemplateTree.js + bloggerTemplateEngine.js +
// bloggerMockContext.js) — ver o docstring de bloggerTemplateEngine.js
// pro levantamento que mostrou que esse é um vocabulário FECHADO (124
// expressões `cond` distintas, 14 `values` de loop, em todo o corpus
// dos 19 chassis + 13 exemplos reais), o que torna um interpretador
// real viável sem precisar reimplementar a spec inteira do Blogger.
//
// O que continua sendo tratado aqui (fora do interpretador, porque é
// específico de PREVIEW, não de template Blogger em si): resolução de
// `$(var)` do b:skin, limpeza de marcadores CDATA residuais,
// normalização de tags self-closing não-void pra HTML5 válido, e um
// fallback de injeção de mock em seções que ainda usam o chassis
// genérico antigo (`.sl-hero-wrapper` vazio) — nichos com esqueleto
// próprio não usam mais esse marcador, então essa injeção não entra
// em ação para eles (o hero real, sendo um widget de verdade, já é
// resolvido pelo interpretador).
// ============================================================

import { renderBloggerTree } from './bloggerTemplateRenderer';
import { buildBaseContext } from './bloggerMockContext';

const MOCK_NAV_ITEMS = ['Início', 'Tecnologia', 'Web Design', 'Tutoriais', 'Sobre'];

/**
 * Converte o XML de um template Blogger em HTML renderizável para preview.
 *
 * @param {string} xml  Conteúdo bruto do arquivo .xml gerado pelo compilador
 * @param {string} [blogTitle]  Título do blog
 * @returns {string}  HTML pronto para ser injetado num iframe/srcdoc
 */
export function parseBloggerXMLToHTML(xml: string, blogTitle = 'Meu Blog'): string {
    let html = xml;

    // 1. Resolver variáveis Blogger $(varName) no CSS ANTES de extrair o
    //    b:skin — o Blogger resolve essas variáveis no servidor.
    const variables: Record<string, string> = {};
    const varPattern = /<Variable\s[^>]*\bname="([^"]+)"[^>]*\bvalue="([^"]*)"/g;
    let vm;
    while ((vm = varPattern.exec(html)) !== null) {
        const val = vm[2].trim();
        const hex = val.match(/#[0-9a-fA-F]{3,8}/);
        variables[vm[1]] = hex ? hex[0] : val;
    }
    const varPatternDef = /<Variable\s[^>]*\bname="([^"]+)"[^>]*\bdefault="([^"]*)"/g;
    while ((vm = varPatternDef.exec(html)) !== null) {
        if (!variables[vm[1]]) {
            const val = vm[2].trim();
            const hex = val.match(/#[0-9a-fA-F]{3,8}/);
            variables[vm[1]] = hex ? hex[0] : val;
        }
    }
    const varPatternColor = /<Variable\s[^>]*\bname="([^"]+)"[^>]*\bcolor="(#[0-9a-fA-F]{3,8})"/g;
    while ((vm = varPatternColor.exec(html)) !== null) {
        if (!variables[vm[1]] || variables[vm[1]].startsWith('$(')) {
            variables[vm[1]] = vm[2];
        }
    }

    const skinMatch = html.match(/<b:skin>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/b:skin>/);
    if (skinMatch) {
        let css = skinMatch[1];
        css = css.replace(/\$\(([^)]+)\)/g, (_, name) => variables[name] || '#888888');
        html = html.replace(skinMatch[0], `<style id='blogger-skin'>\n${css}\n</style>`);
    }

    // 2. Interpretador determinístico: resolve b:if/b:elseif/b:else, b:loop,
    //    b:with, b:include, b:widget (settings + includables reais), b:section,
    //    data:* e expr:* contra um contexto mock.
    // O BioLink usa dois LinkLists com papéis diferentes: botões principais
    // e ícones sociais. A simulação genérica usava os MESMOS 3 links em
    // ambos e fazia o template parecer um nav de blog convencional.
    const isBiolink = /class=['"][^'"]*\bbiolink-wrapper\b/i.test(html);
    html = renderBloggerTree(html, buildBaseContext(blogTitle, isBiolink ? 'biolink-social' : null));

    // 3. Substituições globais residuais fora de qualquer b:widget (ex.: título
    //    da aba/meta tags no <head>, que ficam fora de qualquer b:section).
    html = html.replace(/<data:view\.title\.escaped\/>/g, `${blogTitle} — Prévia`);
    html = html.replace(/<data:blog\.title\.escaped\/>/g, blogTitle);
    html = html.replace(/<data:blog\.title\/>/g, blogTitle);
    html = html.replace(/<data:[A-Za-z0-9_.-]+\/>/g, ''); // qualquer data: desconhecido residual — vazio, nunca vaza texto bruto

    // 4. Atributos expr:/b: residuais (fora de qualquer nó reconhecido pelo
    //    interpretador — normalmente não deveria sobrar nada, mas é uma rede
    //    de segurança contra sintaxe não coberta pelo levantamento).
    html = html.replace(/expr:href='[^']*'/g, "href='#'");
    html = html.replace(/expr:title='[^']*'/g, "title='Preview'");
    html = html.replace(/expr:src='[^']*'/g, "src='https://placehold.co/1200x675/1e293b/64748b?text=Softload'");
    html = html.replace(/expr:[a-zA-Z-]+='[^']*'/g, '');
    html = html.replace(/<\/?b:[^>]*>/g, '');
    html = html.replace(/\s+b:[a-z-]+='[^']*'/gi, '');

    // 5. CDATA residual em scripts.
    html = html.replace(/\/\/<!\[CDATA\[/g, '');
    html = html.replace(/\/\/\]\]>/g, '');
    html = html.replace(/<!\[CDATA\[/g, '');
    html = html.replace(/\]\]>/g, '');

    // 5b. Decodificar entidades XML residuais dentro do CONTEÚDO de
    // <script>. Achado real: templates Blogger reais têm &#39; (aspas
    // simples) dentro de <script> (ex.: widget do Google Translate,
    // presente em 5 dos 19 chassis) — funciona no Blogger real porque o
    // servidor deles decodifica ao montar a página final. HTML5 trata
    // <script> como "raw text element": o navegador NUNCA decodifica
    // entidades ali dentro (diferente de atributo/texto normal, onde
    // decodificar é automático). Sem este passo, `&#39;` sobrevivia como
    // os 5 caracteres literais no JS final, quebrando o parser logo no
    // primeiro '&' (`Unexpected token '&'`, reproduzido de verdade via
    // Chromium contra gamer-playerone e culinaria-boutique-gourmet).
    // Escopo deliberadamente restrito ao CONTEÚDO (nunca a tag de
    // abertura) — atributos/texto normal fora de <script> já são
    // decodificados corretamente pelo navegador; decodificar de novo ali
    // dobraria uma entidade genuinamente dupla-escapada. &amp; é
    // decodificado por último de propósito, pela mesma razão.
    html = html.replace(/(<script\b[^>]*>)([\s\S]*?)(<\/script>)/gi, (_, abre, corpo, fecha) => {
        const decodificado = corpo
            .replace(/&#39;|&apos;/g, "'")
            .replace(/&quot;/g, '"')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&amp;/g, '&');
        return abre + decodificado + fecha;
    });

    // 6. Converter tags XML self-closing não-void para HTML5 válido.
    //    Em HTML5 APENAS os void elements (img, br, input, etc.) aceitam "/>" —
    //    em qualquer outro elemento o browser ignora o "/" e trata como tag
    //    aberta, fazendo o conteúdo seguinte tornar-se filho do elemento.
    //    Caso crítico: <script src='...'/> → o browser entra em "script data
    //    state" e absorve </body></html> como conteúdo do script.
    const HTML_VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
    html = html.replace(/<([a-z][a-z0-9]*)([^>]*)\s*\/>/gi, (m, tag, attrs) => {
        const t = tag.toLowerCase();
        if (HTML_VOID.has(t)) return `<${tag}${attrs}>`;
        return `<${tag}${attrs}></${tag}>`;
    });

    // 7. Fallback pra chassis genérico antigo (elearning-academy/portfolio-
    //    minimalista, ainda sem esqueleto próprio): se sobrar um
    //    `.sl-hero-wrapper`/nav vazio (sem widget real dentro), injeta mock
    //    visual só pra dar contexto — nichos com esqueleto próprio nunca têm
    //    esse marcador, então isso não entra em ação para eles.
    html = html.replace(
        /<div class='sl-hero-wrapper'>\s*<\/div>/,
        `<div class='sl-hero-wrapper'>
  <div class='py-5 text-center text-white' style='background:linear-gradient(135deg,var(--sl-primary,#0ea5e9) 0%,var(--sl-secondary,#2563eb) 100%);'>
    <div class='container py-3'>
      <p class='small text-uppercase fw-bold mb-2 opacity-75' style='letter-spacing:0.12em'>Preview do Template</p>
      <h1 class='display-5 fw-black mb-3'>${blogTitle}</h1>
      <p class='lead mb-4 opacity-90' style='max-width:520px;margin:0 auto'>Os melhores conteúdos, curados para si. Explore as postagens mais recentes abaixo.</p>
      <a class='btn btn-light fw-bold px-4 py-2 rounded-pill' href='#'>Explorar Agora</a>
    </div>
  </div>
</div>`
    );
    html = html.replace(
        /(<nav[^>]*>[\s\S]*?<div[^>]*>)([\s\S]*?)(<\/div>\s*<\/nav>)/,
        (_, navOpen, navContent, navClose) => {
            if (navContent.trim()) return navOpen + navContent + navClose;
            const items = MOCK_NAV_ITEMS.map(i => `<a class='nav-link fw-bold px-3' href='#'>${i}</a>`).join('');
            return `${navOpen}<div class='d-flex align-items-center gap-1'>${items}</div>${navClose}`;
        }
    );

    return html;
}
