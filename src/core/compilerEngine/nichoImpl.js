"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.carregarNichoImpl = carregarNichoImpl;
const fs = require('fs');
const path = require('path');
const { sanitizarEntidadesXml } = require('./xmlEntities');
const TEMAS_DIR = path.join(__dirname, '../../../src/rag/rag-ia-compiler/pipeline/temas');
// ==========================================
// NICHO CSS + JS (carregado do impl.json)
// ==========================================
/**
 * Carrega o impl.json do nicho e extrai CSS, JS e HTML do hero.
 * Retorna { css, js, heroHtml } — strings prontas para os placeholders.
 *
 * Os impl.json têm schemas heterogéneos entre os 14 temas:
 *   - { css_componentes: { game_card: "..." } }   → dict de blocos CSS
 *   - { css_navbar: "..." }                        → string CSS plana
 *   - { dark_mode: { override_css: "..." } }       → CSS aninhado sem prefixo no topo
 *   - { mag_card_sistema: { css_base: "..." } }    → CSS ainda mais aninhado
 *
 * Solução: walker recursivo que propaga parentIsCss/parentIsJs.
 * Quando a chave pai já é marcada como CSS, todos os filhos string são CSS
 * — independente do nome da chave filha.
 */
function carregarNichoImpl(nichoTema) {
    if (!nichoTema || typeof nichoTema !== 'string')
        return { css: '', js: '', heroHtml: '' };
    const base = nichoTema.replace(/^tema-/, '');
    const implPath = path.join(TEMAS_DIR, `tema-${base}-impl.json`);
    const metaPath = path.join(TEMAS_DIR, `tema-${base}-meta.json`);
    let impl;
    try {
        impl = JSON.parse(fs.readFileSync(implPath, 'utf-8'));
    }
    catch (e) {
        console.warn(`[NICHO] impl.json não encontrado para "${nichoTema}": ${e.message}`);
        return { css: '', js: '', heroHtml: '' };
    }
    const cssBlocos = [];
    const jsBlocos = [];
    const heroBlocos = [];
    // Dedup por conteúdo — achado real (viral-magazine): a seção hero
    // (hero_grid_json_feed) tem seu JS extraído diretamente pelo bloco
    // isHeroSection E DE NOVO pelo walk() recursivo que roda logo depois
    // (linha "walk(v, depth+1, ...)"), porque os mesmos filhos batem
    // também na regra genérica looksLikeJs() do nível seguinte. Resultado:
    // getHighResImage/fetchMagazinePosts declaradas 2x em <script> tags
    // separadas — cada uma sintaticamente válida sozinha (por isso o
    // syntax-check por bloco nunca pegou), mas colidem no MESMO escopo
    // global da página real ("Identifier ... has already been declared").
    // Sets abaixo garantem que o mesmo texto nunca entra duas vezes,
    // não importa qual caminho do walker o extraiu.
    const jsVistos = new Set();
    const cssVistos = new Set();
    const heroVistos = new Set();
    function pushJs(v) { if (!jsVistos.has(v)) {
        jsVistos.add(v);
        jsBlocos.push(v);
    } }
    function pushCss(v) { if (!cssVistos.has(v)) {
        cssVistos.add(v);
        cssBlocos.push(v);
    } }
    function pushHero(v) { if (!heroVistos.has(v)) {
        heroVistos.add(v);
        heroBlocos.push(v);
    } }
    // Walker recursivo (profundidade máx 6).
    // parentIsCss / parentIsJs propagam contexto para sub-objectos (ex: css_componentes.game_card).
    // Para STRINGS: filtra pelo conteúdo com looksLikeCss() para não extrair
    // descricao/nota/html_widget/unicode_icone que ficam em chaves filhas de css_*.
    // CSS real sempre tem { } — textos descritivos/notas nunca têm.
    // Também aceita blocos que começam com /* (comentário CSS) ou @-rules.
    function looksLikeCss(s) {
        const t = s.trim();
        return ((t.includes('{') && t.includes('}'))
            || /^(\/\*|@media\b|@keyframes\b|:root\s*\{)/.test(t)) && !/<[a-zA-Z][\s\/>]/.test(t.substring(0, 120));
    }
    // JS real só se o conteúdo (depois de remover um eventual comentário de
    // cabeçalho "// [n] caminho: ...") COMEÇA com uma palavra-chave de
    // statement — nunca "contém em algum lugar". Achado real
    // (viral-magazine): hero_grid_json_feed.dados_feed e .snippet_strip_html
    // são DOCUMENTAÇÃO que cita fragmentos JS inline (ex: "post.title.$t —
    // título", "post.link.find(l => l.rel === 'alternate').href — URL") —
    // uma regex de "contém =>" ou "contém ." pegaria essas linhas de prosa e
    // injetaria texto quebrado num <script> real.
    // O comentário "// [n] caminho: arquivo.ext" é usado como breadcrumb
    // TANTO em blocos CSS quanto JS neste dataset — não é sinal confiável de
    // qual dos dois é sozinho. Achado real (noticias-mag-news):
    // css_componentes.animate_up.css (CSS de verdade, ".animate-up { ... }")
    // também começa com "// [7] caminho: animate_up.css" e seria classificado
    // errado como JS se um "//" no início bastasse. Por isso o comentário é
    // removido ANTES de checar a palavra-chave — decide pelo código real, não
    // pelo comentário.
    function looksLikeJs(s) {
        const semCabecalho = s.replace(/^(\s*\/\/[^\n]*\n)+/, '').trim();
        return /^(function\b|const\s|let\s|var\s|if\s*\(|async\s|\(function|document\.|window\.)/.test(semCabecalho);
    }
    function walk(obj, depth, parentIsCss, parentIsJs) {
        if (depth > 6 || !obj || typeof obj !== 'object' || Array.isArray(obj))
            return;
        const entries = Object.entries(obj);
        // Sinal AMPLIADO, mas só usado pra classificar strings DESTE nível —
        // nunca propagado pra baixo (ver walk(v, depth+1, isCss, isJs) no
        // fim: usa a propagação ORIGINAL por chave, não este sinal). Se
        // propagasse, um match de "css"/"js" num irmão vazava indefinidamente
        // pela subárvore inteira e contaminava texto solto sem filtro — foi
        // exatamente o que quebrou o JS em 13/14 nichos numa tentativa
        // anterior desta correção (detectado via checagem de sintaxe antes
        // de commitar, não em produção).
        // Achado real (viral-magazine): mag_card_sistema.css_base sozinho
        // marcava isCss, mas overlay/badge_flutuante/
        // titulo_com_sublinhado_magico (mesmo nível, sem "css" no nome)
        // ficavam de fora e eram descartados por inteiro — 27% de
        // aproveitamento do impl.json bruto, em média entre 31%-69% perdido
        // nos 14 nichos.
        const siblingCss = entries.some(([k]) => /css/.test(k.toLowerCase()));
        const siblingJs = entries.some(([k]) => {
            const kl = k.toLowerCase();
            return /javascript/.test(kl) || kl === 'js' || /_js$/.test(kl) || /^js_/.test(kl);
        });
        for (const [k, v] of entries) {
            const kl = k.toLowerCase();
            const isCss = parentIsCss || /css/.test(kl);
            const isJs = parentIsJs || /javascript/.test(kl) || kl === 'js'
                || /_js$/.test(kl) || /^js_/.test(kl);
            if (typeof v === 'string' && v.trim().length > 10) {
                // isJs (chave exata) agora também exige looksLikeJs() —
                // achado real: 3 nichos (appstore-bulma-mobile,
                // culinaria-boutique-gourmet, saas-nexus) já tinham, em
                // produção, notas de documentação em português (ex: "Mesmo
                // padrao do Bulma Vegan/NAT: itens com prefixo '_' viram
                // filhos...") vazando pra dentro de <script> reais só porque
                // herdavam isJs de um ancestral cuja chave batia no regex —
                // gerava JS quebrado (SyntaxError) na página ao vivo, sem
                // relação com a extração ampliada abaixo. Confirmado via
                // `git stash` que o bug já existia antes desta correção.
                //
                // JS-shaped checado ANTES de CSS quando há qualquer contexto
                // de JS (exato ou irmão) — achado real e também pré-existente
                // (noticias-mag-news): css_componentes.animate_up.
                // js_intersection_observer herda isCss=true do ancestral
                // 'css_componentes', e looksLikeCss() (heurística de chaves
                // { }) é frouxa o bastante pra bater em QUALQUER JS real (que
                // quase sempre tem chaves) — o IntersectionObserver inteiro
                // ia parar dentro do <b:skin> como "CSS" em vez de <script>,
                // recurso de scroll-reveal silenciosamente morto em produção.
                // looksLikeJs() é o sniffer mais específico dos dois (exige
                // início por palavra-chave de statement); ele decide primeiro.
                if ((isJs || siblingJs) && looksLikeJs(v))
                    pushJs(v);
                else if (isCss && looksLikeCss(v))
                    pushCss(v);
                else if (siblingCss && looksLikeCss(v))
                    pushCss(v);
                else if (looksLikeJs(v))
                    pushJs(v);
            }
            else if (v && typeof v === 'object') {
                // Verifica se este nó é uma secção hero — extrai HTML estático dos filhos
                const isHeroSection = !isCss && !isJs
                    && /hero|slider|featured|cyber|carousel|destaque/.test(kl);
                if (isHeroSection) {
                    for (const [sk, sv] of Object.entries(v)) {
                        if (typeof sv !== 'string')
                            continue;
                        // HTML estrutural real:
                        //  - sem tags Blogger (b:, data:, expr:)
                        //  - sem placeholders mock do tipo [TITULO], [URL_POST_0]
                        if (/html/.test(sk.toLowerCase())
                            && /^[\s\n]*<[a-z]/i.test(sv)
                            && !sv.includes('data:') && !sv.includes('b:')
                            && !sv.includes('expr:')
                            && !/\[[A-Za-z][A-Za-z0-9_ :.-]*\]/.test(sv)) {
                            pushHero(sv);
                        }
                        else if (looksLikeJs(sv)) {
                            // JS real dentro de uma secção "hero" cuja própria
                            // chave não bate no regex de JS (ex:
                            // hero_grid_json_feed — "json" não casa com
                            // /^js_|_js$|javascript|^js$/). Achado real: o
                            // hero grid via feed inteiro
                            // (fetchMagazinePosts/getHighResImage) era
                            // descartado por inteiro por isso. Filtrado por
                            // looksLikeJs — não extrai dados_feed/
                            // snippet_strip_html (documentação com
                            // fragmentos JS citados inline, começam com
                            // "post." e não com palavra-chave de statement).
                            pushJs(sv);
                        }
                    }
                }
                walk(v, depth + 1, isCss, isJs);
            }
        }
    }
    walk(impl, 0, false, false);
    // Injeta tokens CSS do meta.json antes do CSS do impl.json.
    // Os tokens (--nicho-primary, --font-title, etc.) são definidos no meta.json
    // mas nunca foram adicionados ao :root{} do template compilado — variáveis
    // ficavam undefined causando broken styles.
    // Tokens de cor mapeiam para as variáveis --sl-* do colorPreset escolhido
    // (primary → --sl-primary, bg → --sl-bg-body, etc.) para que a paleta do
    // usuário seja respeitada automaticamente.
    let cssTokens = '';
    try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf-8'));
        const tokens = meta?.tokens_css;
        if (tokens) {
            const darkSeletor = tokens.dark_mode?.seletor || "[data-bs-theme='dark']";
            // isDark=true SEMPRE retorna o valor literal documentado — os
            // tokens --sl-* não têm variante escura própria (são estáticos
            // por site), então aliasar um valor de dark_mode para --sl-bg-body
            // faz a variável do nicho resolver pro MESMO valor em claro e
            // escuro, e o dark mode do nicho vira um no-op silencioso.
            // Achado real: --mag-bg/--mag-surface/--mag-text do
            // noticias-mag-news estavam assim (bug já em produção).
            function tokenVar(key, val, isDark) {
                if (isDark)
                    return val;
                if (/footer.*(bg|background)/i.test(key))
                    return `var(--sl-footer-bg)`;
                // exclui "-hover": --x-primary-hover aliasado igual a --x-primary
                // deixaria o estado hover idêntico ao normal (sem feedback visual).
                if (/primary/.test(key) && !/hover/i.test(key))
                    return `var(--sl-primary)`;
                // só "-bg$" — "-body$"/"-background$" soltos colidiam com
                // chaves não relacionadas a cor de fundo, ex: --font-body
                // (fonte do corpo de texto) virava var(--sl-bg-body) por engano.
                if (/\-bg$/.test(key))
                    return `var(--sl-bg-body)`;
                if (/surface|card\-bg|card_bg/.test(key))
                    return `var(--sl-card-bg)`;
                if (/\-text$/.test(key) && !/title|heading/.test(key))
                    return `var(--sl-text-main)`;
                return val;
            }
            const lightVars = Object.entries(tokens.light_mode || {})
                .filter(([k]) => k.startsWith('--'))
                .map(([k, v]) => `  ${k}: ${tokenVar(k, v, false)};`);
            const darkVars = Object.entries(tokens.dark_mode || {})
                .filter(([k]) => k.startsWith('--'))
                .map(([k, v]) => `  ${k}: ${tokenVar(k, v, true)};`);
            if (lightVars.length)
                cssTokens += `:root {\n${lightVars.join('\n')}\n}`;
            if (darkVars.length)
                cssTokens += `\n${darkSeletor} {\n${darkVars.join('\n')}\n}`;
        }
    }
    catch (_) { /* meta.json ausente ou inválido — sem tokens */ }
    const cssPartes = [cssTokens, cssBlocos.join('\n\n    ')].filter(Boolean);
    const cssImpl = cssPartes.join('\n\n    ');
    const js = jsBlocos
        .map(code => `<script>\n//<![CDATA[\n${code.trim()}\n//]]>\n</script>`)
        .join('\n  ');
    const heroImpl = sanitizarEntidadesXml(heroBlocos.join('\n'));
    return { css: cssImpl, js, heroHtml: heroImpl };
}
