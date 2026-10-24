"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extrairTemplate = extrairTemplate;
/**
 * templateExtractor.js — Extrai dados estruturados de um template Blogger compilado.
 *
 * Saída JSON:
 *   id, siteName, nichoTema (inferido), darkTheme, cssVars,
 *   customCss, svgLogo, heroHtml, staticSections, config (pronto para executarCompilacao),
 *   pecas (granular: hero/modulo/widget — ver seção 9 abaixo)
 *
 * Marcadores de injeção no XML (adicionados pelo compilador):
 *   <!-- DP:CSS:START -->  ...  <!-- DP:CSS:END -->
 *   <!-- DP:LOGO:START --> ...  <!-- DP:LOGO:END -->
 *   <!-- DP:HERO:START --> ...  <!-- DP:HERO:END -->
 *   <!-- DP:SECTIONS:START --> ... <!-- DP:SECTIONS:END -->
 *
 * Fallback sem marcadores: usa heurísticas de posição/classe.
 */
const fs = require('fs');
const path = require('path');
const postcss = require('postcss');
const { NICHO_PAGE_TYPE_MAP } = require('./nichoTaxonomy');
const NICHOS_VALIDOS = new Set(Object.keys(NICHO_PAGE_TYPE_MAP));
// ── Helpers ────────────────────────────────────────────────────────────────
function between(str, start, end) {
    const si = str.indexOf(start);
    if (si === -1)
        return null;
    const ei = str.indexOf(end, si + start.length);
    if (ei === -1)
        return null;
    return str.slice(si + start.length, ei).trim();
}
function betweenLast(str, start, end) {
    const si = str.lastIndexOf(start);
    if (si === -1)
        return null;
    const ei = str.indexOf(end, si + start.length);
    if (ei === -1)
        return null;
    return str.slice(si + start.length, ei).trim();
}
function slugify(str) {
    return String(str || '')
        .toLowerCase()
        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 60) || 'peca';
}
// ── 1. Custom CSS ──────────────────────────────────────────────────────────
function extrairCss(xml) {
    // Prioridade 1: marcador explícito do compilador
    const comMarcador = between(xml, '<!-- DP:CSS:START -->', '<!-- DP:CSS:END -->');
    if (comMarcador)
        return comMarcador;
    // Prioridade 2: comentário de identificação /* ── [NOME] CUSTOM ── */
    const skinMatch = xml.match(/<b:skin[^>]*><!\[CDATA\[([\s\S]*?)\]\]><\/b:skin>/);
    if (!skinMatch)
        return null;
    const css = skinMatch[1];
    const customIdx = css.search(/\/\* ── .+? CUSTOM/);
    if (customIdx !== -1)
        return css.slice(customIdx).trim();
    // Prioridade 3: tudo após o último /* ── */ comentário de seção base
    const lastSection = css.search(/\/\* ──[^C]/g);
    if (lastSection !== -1) {
        // Pega o bloco de :root com CSS vars próprias
        const rootMatch = css.match(/:root\s*\{[^}]*--[a-z]+-[a-z]+[^}]*\}/g);
        if (rootMatch)
            return rootMatch.join('\n');
    }
    // Prioridade 4: sem marcador nem nenhuma convenção de comentário
    // conhecida (── ── / CUSTOM) — típico de um export bruto do Blogger
    // (Theme Designer), sem nenhuma marca deixada pelo compilador. Usa o
    // b:skin inteiro, removendo só a declaração <Group>/<Variable> — é
    // metadado do editor de temas do Blogger (o servidor do Blogger
    // interpreta e remove isso antes de servir CSS de verdade ao
    // navegador); sem remover aqui, sobraria marcação XML dentro de um
    // campo que deveria ser CSS puro. Última prioridade: perder CSS de
    // verdade (ficar em null) é pior que um pouco de ruído residual, mas
    // as 3 prioridades anteriores captam melhor quando a convenção existe.
    const semGroup = css.replace(/<Group\b[^>]*>[\s\S]*?<\/Group>/g, '').trim();
    if (semGroup)
        return semGroup;
    return null;
}
// ── 2. CSS Variables ───────────────────────────────────────────────────────
// Blogger Theme Designer: <Variable name='cor.primaria' default='#6f42c1' .../>
// dentro de <Group>...</Group>, no próprio <b:skin>. CSS hand-authored que
// referencia a variável do painel do Blogger (não uma CSS var nativa) usa a
// sintaxe $(nome) — ex: --sd-primary: $(cor.primaria);. extrairCss() já
// descarta o <Group>/<Variable> inteiro do customCss (é metadado do editor,
// não CSS de verdade) — sem resolver aqui contra o "default" declarado,
// --sd-primary ficaria literalmente "$(cor.primaria)" no tokensCss, um
// valor de cor inválido (perderia a cor real do design do usuário).
function extrairVariaveisBlogger(xml) {
    const vars = {};
    const tagRe = /<Variable\b[^>]*\/>/g;
    let m;
    while ((m = tagRe.exec(xml)) !== null) {
        const tag = m[0];
        const nomeM = tag.match(/\bname=['"]([^'"]+)['"]/);
        const defaultM = tag.match(/\bdefault=['"]([^'"]*)['"]/);
        if (nomeM && defaultM)
            vars[nomeM[1]] = defaultM[1];
    }
    return vars;
}
function resolverPlaceholderBlogger(valor, variaveisBlogger) {
    return valor.replace(/\$\(([a-zA-Z0-9_.]+)\)/g, (match, nome) => (Object.prototype.hasOwnProperty.call(variaveisBlogger, nome) ? variaveisBlogger[nome] : match));
}
// Varre TODO :root{} do customCss (global, não só o primeiro) — um arquivo
// hand-authored pode ter mais de um bloco :root{} pra propósitos distintos
// (ex: 1 com os tokens de marca do site inteiro, outro com variáveis locais
// de 1 componente específico, tipo busca) — pegar só o primeiro descartaria
// tokens reais declarados nos blocos seguintes.
function extrairCssVars(css, xml = '') {
    if (!css)
        return {};
    const variaveisBlogger = extrairVariaveisBlogger(xml);
    const vars = {};
    const re = /:root\s*\{([^}]*)\}/gs;
    let rootMatch;
    while ((rootMatch = re.exec(css)) !== null) {
        const lines = rootMatch[1].split('\n');
        for (const line of lines) {
            const m = line.match(/--([a-zA-Z0-9-]+)\s*:\s*([^;]+);/);
            if (m)
                vars['--' + m[1].trim()] = resolverPlaceholderBlogger(m[2].trim(), variaveisBlogger);
        }
    }
    return vars;
}
// ── 3. Dark Theme ──────────────────────────────────────────────────────────
function detectarDarkTheme(xml) {
    return xml.includes("setAttribute('data-bs-theme','dark')") ||
        xml.includes('data-bs-theme="dark"');
}
// ── 4. SVG Logo ────────────────────────────────────────────────────────────
function extrairSvgLogo(xml) {
    // Prioridade 1: marcador explícito
    const comMarcador = between(xml, '<!-- DP:LOGO:START -->', '<!-- DP:LOGO:END -->');
    if (comMarcador)
        return comMarcador;
    // Prioridade 2: <svg> antes do header-logo section
    const headerLogoIdx = xml.indexOf("<b:section id='header-logo'");
    if (headerLogoIdx !== -1) {
        const antes = xml.slice(Math.max(0, headerLogoIdx - 2000), headerLogoIdx);
        const svgMatch = antes.match(/<svg[\s\S]*?<\/svg>/g);
        if (svgMatch)
            return svgMatch[svgMatch.length - 1].trim();
    }
    return null;
}
// ── 5. Hero HTML + Static Sections ────────────────────────────────────────
// Desfaz o embrulho de widget HTML criado por montarWidgetHtml() no compiler.
// Templates novos guardam hero/seções como <b:widget type='HTML'> com conteúdo
// em CDATA dentro de b:widget-setting — aqui extraímos de volta para HTML cru,
// mantendo o round-trip extração→recompilação sem dupla embalagem.
function desembrulharWidgetHtml(trecho) {
    if (!trecho || !trecho.includes('<b:widget'))
        return trecho;
    const cdata = trecho.match(/<b:widget-setting name='content'><!\[CDATA\[([\s\S]*?)\]\]><\/b:widget-setting>/);
    if (cdata)
        return cdata[1].replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
    // Fallback: templates gerados antes da migração para CDATA (entity-escaped).
    const legado = trecho.match(/<b:widget-setting name='content'>([\s\S]*?)<\/b:widget-setting>/);
    if (!legado)
        return trecho;
    return legado[1]
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&amp;/g, '&');
}
function extrairHeroESecoes(xml) {
    // Prioridade 1: marcadores explícitos
    const heroMarcado = desembrulharWidgetHtml(between(xml, '<!-- DP:HERO:START -->', '<!-- DP:HERO:END -->'));
    const secoesMarcadas = desembrulharWidgetHtml(between(xml, '<!-- DP:SECTIONS:START -->', '<!-- DP:SECTIONS:END -->'));
    if (heroMarcado !== null) {
        return { heroHtml: heroMarcado, staticSections: secoesMarcadas };
    }
    // Prioridade 2: heurística — conteúdo entre último encerramento de b:section
    // e o marcador <b:section id='main'
    const mainIdx = xml.indexOf("<b:section id='main'");
    if (mainIdx === -1)
        return { heroHtml: null, staticSections: null };
    // Acha o bloco injetado: vai do último elemento Blogger antes de main
    // até o próprio main
    const antesDaMain = xml.slice(0, mainIdx);
    // Encontra o fim do wrapper de hero do template base
    // Marcadores conhecidos por chassis:
    const marcadoresBase = [
        "<!-- MAIN -->", // blog/magazine chassis
        "<section class='blog-section'>", // saas chassis
        "</b:if>", // se o último elemento antes da injeção é um b:if fechado
    ];
    let inicioInjetado = -1;
    for (const m of marcadoresBase) {
        const idx = antesDaMain.lastIndexOf(m);
        if (idx !== -1) {
            // Avança para depois do marcador base (e da abertura de <main> ou <section>)
            let apos = idx + m.length;
            // Pula a linha do marcador base e possível tag de abertura
            const proxLinha = antesDaMain.indexOf('\n', apos);
            const proxAbertura = antesDaMain.indexOf('\n', proxLinha + 1);
            if (m === '<!-- MAIN -->') {
                // Pula também a linha <main class=...>
                const fimMain = antesDaMain.indexOf('\n', proxAbertura + 1);
                apos = fimMain + 1;
            }
            else {
                apos = proxLinha + 1;
            }
            inicioInjetado = apos;
            break;
        }
    }
    if (inicioInjetado === -1) {
        // Fallback: pega o último bloco HTML sem tags Blogger
        const ultimoBlocoB = Math.max(antesDaMain.lastIndexOf('</b:if>'), antesDaMain.lastIndexOf('</b:widget>'), antesDaMain.lastIndexOf('/>'));
        if (ultimoBlocoB !== -1) {
            inicioInjetado = antesDaMain.indexOf('\n', ultimoBlocoB) + 1;
        }
    }
    if (inicioInjetado === -1)
        return { heroHtml: null, staticSections: null };
    let blocoInjetado = antesDaMain.slice(inicioInjetado).trim();
    if (!blocoInjetado)
        return { heroHtml: null, staticSections: null };
    // Comentários de desenvolvedor (notas explicativas sobre o XML) não são
    // conteúdo injetado de verdade — descarta-os antes de decidir se há
    // hero/seções. Sem isso, um trecho como este nicho terminando em
    // "<b:section id='main'" com só um comentário explicativo pelo meio
    // vira heroHtml literalmente igual ao texto do comentário.
    blocoInjetado = blocoInjetado.replace(/^(?:\s*<!--[\s\S]*?-->\s*)+/, '').trim();
    if (!blocoInjetado)
        return { heroHtml: null, staticSections: null };
    // Separa heroHtml de staticSections:
    // O hero é a primeira <section> ou <div> de alto nível
    // Static sections são o resto
    const splitIdx = _encontrarFimHero(blocoInjetado);
    if (splitIdx === -1 || splitIdx >= blocoInjetado.length - 10) {
        return { heroHtml: blocoInjetado, staticSections: null };
    }
    return {
        heroHtml: blocoInjetado.slice(0, splitIdx).trim(),
        staticSections: blocoInjetado.slice(splitIdx).trim() || null,
    };
}
function _encontrarFimHero(bloco) {
    // Procura o fechamento da primeira <section> ou <div> de alto nível
    // que contenha palavras-chave de hero
    const heroKeywords = ['hero', 'banner', 'jumbotron', 'cover'];
    const primeiraLinha = bloco.slice(0, 200).toLowerCase();
    const temHero = heroKeywords.some(k => primeiraLinha.includes(k));
    if (!temHero)
        return -1;
    // Conta abertura/fechamento de tags para achar o fechamento da primeira seção
    let depth = 0;
    let i = 0;
    let emSection = false;
    const tagRe = /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g;
    let m;
    while ((m = tagRe.exec(bloco)) !== null) {
        const full = m[0];
        const tag = m[1].toLowerCase();
        const auto = full.endsWith('/>') || ['br', 'hr', 'img', 'input', 'meta', 'link'].includes(tag);
        if (full.startsWith('</')) {
            depth--;
            if (depth === 0 && emSection) {
                return tagRe.lastIndex; // posição após o fechamento
            }
        }
        else if (!auto) {
            if (depth === 0)
                emSection = true;
            depth++;
        }
    }
    return -1;
}
// ── 6. Site Name ───────────────────────────────────────────────────────────
function extrairSiteName(xml) {
    const m = xml.match(/<meta[^>]+name=['"]description['"][^>]+content=['"]([^'"]+)['"]/);
    if (m)
        return m[1];
    const m2 = xml.match(/<meta[^>]+content=['"]([^'"]+)['"][^>]+name=['"]description['"]/);
    if (m2)
        return m2[1];
    return null;
}
// ── 7. NichoTema (inferência) ──────────────────────────────────────────────
const NICHO_SINAIS = {
    'gamer-playerone': ['gamer', 'player', 'gaming', 'streamer', 'game-'],
    'natureza-bulma-vegan': ['vegan', 'natureza', 'bee', 'honey', 'apiari', 'mel', 'planta'],
    'culinaria-boutique-gourmet': ['culinaria', 'gourmet', 'receita', 'chef', 'food', 'doce', 'confeit'],
    'saas-nexus': ['saas', 'nexus', 'pricing', 'feature-section', 'testimonials'],
    'elearning-academy': ['academy', 'curso', 'aula', 'ead', 'elearning', 'lesson'],
    'tecnologia-techwind': ['tech', 'wind', 'techwind', 'dev', 'codigo'],
    'tecnologia-mag-tech': ['mag-tech', 'tecnologia', 'inovacao'],
    'noticias-mag-news': ['mag-news', 'noticias', 'news'],
    'viral-magazine': ['viral', 'magazine', 'trending'],
    'portfolio-minimalista': ['portfolio', 'portfólio', 'curriculo', 'cv'],
    'biolink-social': ['biolink', 'linktree', 'social-link'],
    'brutalista-appcraft': ['brutalista', 'brutalist', 'appcraft'],
    'pop-retro-pixel': ['retro', 'pixel', 'pop'],
    'appstore-bulma-mobile': ['appstore', 'app-store', 'mobile-app'],
};
// Achado real: rodar `--all` reprocessa TODO exemplos/*.xml, inclusive os
// templates derivados diretamente de um nicho já conhecido (theme-<nicho>-
// derivado-N.xml, gerados por executarCompilacao() com nichoTema explícito)
// — cada re-execução sobrescrevia o nichoTema correto pela heurística de
// keyword-score (NICHO_SINAIS), que erra sistematicamente em texto
// compilado extenso (o chassis inteiro dilui o sinal das poucas palavras
// realmente específicas do nicho). Sem isso, qualquer correção manual de
// nichoTema feita depois de uma extração tinha que ser refeita a cada
// `--all` novo — trabalho manual repetido à toa. Extraído do próprio id
// do arquivo (fonte de verdade real, não uma heurística) sempre que o
// nome segue esse padrão; cai pra inferirNicho() em qualquer outro caso
// (upload real de terceiro, sem esse padrão de nome).
const RE_ID_DERIVADO = /^theme-(.+)-derivado-\d+$/;
function nichoDoId(id, nichosValidos) {
    const m = RE_ID_DERIVADO.exec(id || '');
    if (!m)
        return null;
    return nichosValidos.has(m[1]) ? m[1] : null;
}
function inferirNicho(xml, css) {
    const texto = (xml + ' ' + (css || '')).toLowerCase();
    let melhor = null;
    let maxScore = 0;
    for (const [nicho, sinais] of Object.entries(NICHO_SINAIS)) {
        const score = sinais.filter(s => texto.includes(s)).length;
        if (score > maxScore) {
            maxScore = score;
            melhor = nicho;
        }
    }
    return maxScore > 0 ? melhor : null;
}
// ── 8. Config ──────────────────────────────────────────────────────────────
function montarConfig(id, siteName, nichoTema, darkTheme, cssVars) {
    // Inferir colorPreset a partir das CSS vars
    const cor = Object.values(cssVars)[0] || '#4F46E5';
    let colorPreset = 'tech-blue';
    if (cor.match(/#F97316|#e8590c|#ea580c/i))
        colorPreset = 'neon-orange';
    else if (cor.match(/#D4AF37|#b8960c|#FFD700/i))
        colorPreset = 'warm-amber';
    else if (cor.match(/#4F46E5|#818CF8|#6366f1/i))
        colorPreset = 'indigo-violet';
    else if (cor.match(/#2563EB|#1d4ed8/i))
        colorPreset = 'tech-blue';
    else if (cor.match(/#6f42c1|#7c3aed/i))
        colorPreset = 'luxury-purple';
    else if (cor.match(/#140a04|#1a1a1a|#0d0d0d/i))
        colorPreset = 'carbon-dark';
    // Inferir typography a partir de @import
    let typography = 'inter';
    if (cssVars['--conf-font'] || Object.keys(cssVars).some(k => k.includes('playfair')))
        typography = 'playfair';
    else if (Object.values(cssVars).some(v => v.toLowerCase().includes('space grotesk')))
        typography = 'space-grotesk';
    return {
        id,
        siteName: siteName || id,
        nichoTema: nichoTema || null,
        colorPreset,
        typography,
        buttonStyle: 'default',
        gridLayout: 'revista',
        darkTheme: darkTheme || false,
        enableSeo: true,
        lazyLoad: true,
        modules: { header: true, hero: true, posts: true, sidebar: true, footer: true },
        categoryBadges: [],
    };
}
// ── 9. Peças granulares (hero / modulo / widget / secao) ────────────────────
//
// O extrator acima gera "blobs" grandes (customCss inteiro, hero+seções como
// 1 bloco cada). Isso é insuficiente pra servir de fonte de verdade de
// qualidade: o compilador raciocina em "peças" ({tipo, domIds, css, html,
// js, descricao} — ver src/ai/pecaRequestSchema.js), não em blobs. Sem
// segmentar os templates hand-authored de exemplos/ nesse mesmo grão, a
// biblioteca RAG de peças (src/core/compilerEngine/pecaOrchestrator.js)
// nunca aprende com eles de verdade.
//
// Estratégia (heurística, best-effort — sem marcador explícito no XML pra
// isso, ao contrário de CSS/HERO/SECTIONS):
//   1. CSS customizado é fatiado por comentário de seção via PostCSS (AST
//      real, não regex) — cada `/* Título */` até o próximo vira 1 peça
//      tipo:'modulo'. Blocos só de `:root{}` (design tokens) são descartados
//      (já capturados em cssVars).
//   2. Hero (heroHtml já extraído) vira 1 peça tipo:'hero'.
//   3. Toda <b:section id='X'> cujo id NÃO pertença ao vocabulário estrutural
//      conhecido dos chassis, nem contenha uma palavra estrutural (ver
//      PALAVRAS_ESTRUTURAIS — cobre convenções de nomenclatura diferentes
//      entre lotes de exemplos/, incl. export bruto do Blogger), é tratada
//      como widget autônomo — mas o "tipo" depende do que tem dentro:
//      HTML solto (+ script opcional, ex: botão flutuante de WhatsApp)
//      vira tipo:'widget' (cabe em qualquer lugar via [[NICHO_WIDGETS_HTML]]);
//      já um <b:widget> Blogger REGISTRADO de verdade (BlogSearch, HTML
//      com destaque de posts) vira tipo:'secao' — schema do Blogger só
//      aceita <b:widget> como filho direto de <b:section>, não cabe no
//      slot solto (ver [[NICHO_EXTRA_SECTIONS]] em nichoBlocks.js).
//   4. CSS/JS relacionados a hero/widget são correlacionados por interseção
//      de classes/ids (heurística de nome, não AST) e MOVIDOS pra dentro da
//      peça correspondente — nunca duplicados entre a peça e os módulos CSS
//      genéricos.
//
// Isso é heurística sobre markup free-form: pode errar, especialmente em
// templates com convenções não vistas antes. Ver resposta ao usuário sobre
// esse risco — extração incorreta aqui não quebra a extração dos blobs
// (customCss/heroHtml/staticSections), que continuam sendo a fonte usada
// pelo `executarCompilacao()`; `pecas` é aditivo.
const SECOES_ESTRUTURAIS = new Set([
    'attr-section', 'blog-section-inner', 'footer-1', 'footer-2', 'footer-3',
    'footer-about', 'footer-brand', 'footer-categories', 'footer-contact',
    'footer-cta', 'footer-extra', 'footer-links', 'footer-social',
    'header-banner', 'header-bio', 'header-logo', 'header-right',
    'hero-area', 'hero-extra', 'hero-media', 'hero-text',
    'landing-hero', 'landing-sections', 'links-section', 'main', 'main-nav',
    'menu-links', 'mobile-nav-collapse', 'mobile-nav-offcanvas', 'nav-cta',
    'post-sidebar', 'post-sidebar-top', 'pricing-cards', 'saas-cards',
    'sidebar', 'sidebar-author', 'sidebar-bottom', 'sidebar-top',
    'skills-section', 'social-section', 'testimonials', 'top-bar',
]);
// Cada lote novo de exemplos/*.xml (hand-authored por gente diferente, ou
// exportado bruto do Blogger) traz sua própria convenção de nome de seção
// — 'header-logo'/'main-nav' (softload) vs 'HeaderLogo'/'main-blog'/
// 'sidebar-right'/'footer-left' (export bruto do Blogger), por exemplo.
// Uma lista exata (SECOES_ESTRUTURAIS acima) não escala pra toda
// nomenclatura que ainda vai chegar — por isso, além da lista exata,
// qualquer id que CONTENHA uma destas palavras (case-insensitive,
// substring) também é tratado como estrutural, mesmo fora da lista.
// Falso-negativo aqui (perder um widget genuíno) é um resultado muito
// mais seguro que falso-positivo (tratar uma seção de layout inteira,
// tipo o sidebar todo, como se fosse 1 widget autônomo).
const PALAVRAS_ESTRUTURAIS = ['header', 'nav', 'menu', 'hero', 'main', 'sidebar', 'footer', 'content', 'post', 'blog'];
function _pareceEstrutural(id) {
    if (SECOES_ESTRUTURAIS.has(id))
        return true;
    const idMinusculo = id.toLowerCase();
    return PALAVRAS_ESTRUTURAIS.some(p => idMinusculo.includes(p));
}
// Remove tags b:* (b:widget/b:includable/b:if/b:section...) de um HTML —
// não são elementos de DOM, e seus atributos id=/class= não são id/class
// de elemento nenhum (ex: <b:widget id='HTML99'>, <b:includable id='main'>).
// Compartilhado por domIdsDeHtml e classesEIdsDeHtml.
function semTagsBlogger(html) {
    return html.replace(/<\/?b:[a-zA-Z-]+[^>]*>/g, ' ');
}
// Ids de elemento DOM reais (não widget id do Blogger, ex: <b:widget id='HTML99'>,
// que não é um id de elemento HTML). Remove tags b:* antes de procurar id=.
function domIdsDeHtml(html) {
    if (!html)
        return [];
    const ids = new Set();
    const re = /\bid=['"]([a-zA-Z][a-zA-Z0-9_:.-]*)['"]/g;
    let m;
    while ((m = re.exec(semTagsBlogger(html))) !== null)
        ids.add(m[1]);
    return [...ids];
}
// Injeta um id real na tag-raiz de um HTML de peça (hero/widget) que não
// tem nenhum id próprio — HTML hand-authored raramente usa id em elementos
// visuais (usa só class), mas o contrato de dossiê (dossieValidator.js)
// EXIGE domIds não-vazio pra qualquer peça que introduza HTML, pra permitir
// a verificação mecânica pós-compilação (dossieIntegrityChecker.js: "esse
// domId realmente aparece no XML compilado?"). Sem isso, toda peça
// hero/widget extraída de exemplos/ ficaria com domIds:[] e seria
// REJEITADA por adicionarPeca() ao tentar reaproveitá-la numa geração real
// — o extrator produziria dado tecnicamente correto mas inutilizável.
//
// Acha a primeira tag HTML literal (pula tags b:* — b:widget/b:includable/
// b:if não são elementos de DOM, e o id='HTML99' de um <b:widget> é um
// identificador de widget do Blogger, não um id de elemento) e injeta
// id='<id>' nela, só se ainda não tiver id próprio (nunca sobrescreve).
function injetarIdRaiz(html, id) {
    if (!html)
        return html;
    const re = /<([a-zA-Z][\w:-]*)\b([^>]*)>/g;
    let m;
    while ((m = re.exec(html)) !== null) {
        const tag = m[1];
        if (tag.startsWith('b:'))
            continue;
        if (/\bid=['"][^'"]*['"]/.test(m[2]))
            return html; // já tem id — não mexe
        const tagCompleta = m[0];
        const novaTag = tagCompleta.replace(/^<([a-zA-Z][\w:-]*)/, `<$1 id='${id}'`);
        return html.slice(0, m.index) + novaTag + html.slice(m.index + tagCompleta.length);
    }
    return html; // nenhuma tag HTML literal encontrada (ex: peça só com b:* por dentro)
}
// Extrai os tokens de seletor (.classe / #id) referenciados dentro de um
// bloco de CSS — usado pra achar quais chunks de CSS "pertencem" a um
// widget/hero específico.
function tokensDeSeletor(css) {
    const tokens = new Set();
    if (!css)
        return tokens;
    const re = /[.#][a-zA-Z][\w-]*/g;
    let m;
    while ((m = re.exec(css)) !== null)
        tokens.add(m[0]);
    return tokens;
}
// Extrai as classes/ids usados dentro de um HTML — o "lado HTML" da mesma
// correlação acima. Remove tags b:* primeiro (mesmo motivo de domIdsDeHtml)
// e ignora atributos expr:id=/expr:class= (expressão dinâmica do Blogger,
// não é um id/class literal — ex: expr:id='data:widget.instanceId + "_form"'
// não é um seletor CSS válido, é código; sem o (?<![\w:]) a regra \bid=
// batia mesmo depois de "expr:" porque ':' já é fim de palavra pro \b).
function classesEIdsDeHtml(html) {
    const tokens = new Set();
    if (!html)
        return tokens;
    const semB = semTagsBlogger(html);
    let m;
    const classRe = /(?<![\w:])class=['"]([^'"]+)['"]/g;
    while ((m = classRe.exec(semB)) !== null) {
        m[1].split(/\s+/).filter(Boolean).forEach(c => tokens.add('.' + c));
    }
    const idRe = /(?<![\w:])id=['"]([^'"]+)['"]/g;
    while ((m = idRe.exec(semB)) !== null)
        tokens.add('#' + m[1]);
    return tokens;
}
// Um token (.classe ou #id) só é confiável como sinal de correlação
// CSS↔HTML se for específico o bastante — nomes compostos (kebab-case,
// ex: .gsc-search-box, #gourmet-slider-hd) são deliberadamente cunhados
// pra 1 componente. Palavra única genérica (.title, .container, #main)
// é reaproveitada em dezenas de blocos não relacionados no mesmo
// stylesheet — correlacionar por ela varre CSS de outras peças pra
// dentro da peça errada (achado real: modulo-* completamente alheios —
// contador de posts, nuvem de tags, dark-mode de tag — grudavam em
// secao-top-search só por causa de ".title" aparecer em ambos os lados).
// Mesmo princípio que já regia a correlação de JS (só por id, nunca por
// classe) — aqui estendido: token de correlação de CSS só conta se tiver
// hífen (nome composto), não só se for id.
function _tokenEspecifico(token) {
    return token.slice(1).includes('-');
}
// Blogger XML embrulha JS inline em CDATA (//<![CDATA[ ... //]]>) pra
// blindar contra caracteres especiais no parser XML — não é JS de verdade,
// é boilerplate do formato. Sem remover aqui, esse boilerplate viraria
// parte do campo "js" da peça, e o compilador (nichoBlocks.js) já embrulha
// o "js" de cada peça no PRÓPRIO <script>//<![CDATA[...//]]></script> ao
// montar o XML final — o resultado seria CDATA duplicado (quebra o JS).
// ]]]]><![CDATA[> é o escape padrão de um "]]>" que apareceria dentro do
// próprio CDATA (ex: comparação com array vazio); desfaz de volta pra "]]>"
// (mesmo padrão já usado em desembrulharWidgetHtml pro HTML).
function desembrulharCData(js) {
    return js
        .replace(/^\s*\/\/\s*<!\[CDATA\[\s*/, '')
        .replace(/\s*\/\/\s*\]\]>\s*$/, '')
        .replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>')
        .trim();
}
// Scripts inline (exclui <script src='...'> externos e blocos vazios).
function extrairScriptsInline(xml) {
    const scripts = [];
    const re = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(xml)) !== null) {
        if (m[1].includes('src='))
            continue;
        const conteudo = desembrulharCData(m[2]);
        if (conteudo)
            scripts.push(conteudo);
    }
    return scripts;
}
// Varre todo <b:section id='X'>...</b:section> do XML (contando profundidade
// pra lidar com aninhamento, mesmo que raro nesses chassis).
function extrairSecoesXml(xml) {
    const secoes = [];
    const aberturaRe = /<b:section\b([^>]*?)(\/>|>)/g;
    let m;
    while ((m = aberturaRe.exec(xml)) !== null) {
        const idMatch = m[1].match(/\bid=['"]([^'"]+)['"]/);
        if (!idMatch)
            continue;
        const id = idMatch[1];
        if (m[2] === '/>') {
            secoes.push({ id, conteudo: '', selfClose: true });
            continue;
        }
        let depth = 1;
        let cursor = aberturaRe.lastIndex;
        let fimConteudo = -1;
        while (depth > 0) {
            const proxAbre = xml.indexOf('<b:section', cursor);
            const proxFecha = xml.indexOf('</b:section>', cursor);
            if (proxFecha === -1) {
                fimConteudo = xml.length;
                cursor = xml.length;
                break;
            }
            if (proxAbre !== -1 && proxAbre < proxFecha) {
                depth++;
                cursor = proxAbre + '<b:section'.length;
            }
            else {
                depth--;
                if (depth === 0)
                    fimConteudo = proxFecha;
                cursor = proxFecha + '</b:section>'.length;
            }
        }
        secoes.push({
            id,
            conteudo: xml.slice(aberturaRe.lastIndex, fimConteudo).trim(),
            selfClose: false,
        });
        aberturaRe.lastIndex = cursor;
    }
    return secoes;
}
// Fatia o customCss em peças tipo:'modulo' usando os comentários de seção
// (`/* Título */`) como delimitador — via AST real do PostCSS, não regex.
function extrairPecasCssModulo(customCss) {
    if (!customCss)
        return [];
    let root;
    try {
        root = postcss.parse(customCss);
    }
    catch (e) {
        // CSS malformado não deve quebrar a extração do resto do template.
        return [];
    }
    const chunks = [];
    let atual = null;
    root.nodes.forEach((node) => {
        if (node.type === 'comment') {
            const titulo = node.text.trim();
            // Comentários puramente decorativos (só traços/underscores) não
            // abrem um chunk novo — continuam dentro do chunk corrente.
            if (titulo.replace(/[─—-]/g, '').trim().length > 0) {
                atual = { titulo, nodes: [] };
                chunks.push(atual);
                return;
            }
        }
        if (!atual) {
            atual = { titulo: null, nodes: [] };
            chunks.push(atual);
        }
        atual.nodes.push(node);
    });
    const idsUsados = new Set();
    const pecas = [];
    for (const chunk of chunks) {
        if (chunk.nodes.length === 0)
            continue;
        // Bloco só de :root (design tokens) já está em cssVars — não é peça.
        const apenasRoot = chunk.nodes.every(n => n.type === 'rule' && n.selector === ':root');
        if (apenasRoot)
            continue;
        const css = chunk.nodes.map(n => n.toString()).join('\n\n').trim();
        if (!css)
            continue;
        const base = slugify(chunk.titulo || 'estilo-geral');
        let id = 'modulo-' + base;
        let sufixo = 2;
        while (idsUsados.has(id)) {
            id = 'modulo-' + base + '-' + sufixo;
            sufixo++;
        }
        idsUsados.add(id);
        pecas.push({
            id,
            css,
            descricao: chunk.titulo ? `Estilo: ${chunk.titulo}` : 'Bloco de estilos customizados',
        });
    }
    return pecas;
}
/**
 * Extrai o array granular de peças (hero / modulo / widget) de um template.
 *
 * @param {string} xml       — Conteúdo do arquivo XML
 * @param {string|null} customCss — CSS já extraído por extrairCss()
 * @param {string|null} heroHtml  — HTML de hero já extraído por extrairHeroESecoes()
 * @returns {Array<object>} — Peças no formato {id, tipo, protegida, domIds, css, html, js, descricao}
 */
function extrairPecas(xml, customCss, heroHtml) {
    const modulos = extrairPecasCssModulo(customCss); // mutável: itens são removidos ao serem correlacionados
    const scripts = extrairScriptsInline(xml);
    const candidatos = [];
    if (heroHtml) {
        candidatos.push({
            id: 'hero-principal',
            tipo: 'hero',
            html: heroHtml,
            descricao: 'Seção hero principal do template',
        });
    }
    const secoesCustom = extrairSecoesXml(xml)
        .filter(s => !s.selfClose && s.conteudo && !_pareceEstrutural(s.id));
    for (const s of secoesCustom) {
        // <b:widget> é um elemento com REGRA DE SCHEMA do Blogger: só é
        // válido como filho direto de <b:section> (upload rejeitado com
        // "is not within a section" senão). tipo:'widget' vai pro slot
        // [[NICHO_WIDGETS_HTML]] solto no meio da página — serve pra HTML
        // simples tipo cookie-banner/scroll-to-top, mas quebraria qualquer
        // conteúdo que já venha com seu próprio <b:widget> real (busca via
        // BlogSearch, destaque de posts). tipo:'secao' recebe de volta a
        // própria <b:section> (ver injetarSecaoDeVolta/[[NICHO_EXTRA_SECTIONS]]
        // em nichoBlocks.js) em vez de ir pro slot solto.
        const temWidgetReal = /<b:widget\b/.test(s.conteudo);
        candidatos.push({
            id: (temWidgetReal ? 'secao-' : 'widget-') + slugify(s.id),
            tipo: temWidgetReal ? 'secao' : 'widget',
            html: s.conteudo,
            descricao: `${temWidgetReal ? 'Seção' : 'Widget'} customizada: ${s.id}`,
        });
    }
    const pecas = [];
    for (const cand of candidatos) {
        // Sem id próprio no HTML hand-authored, a peça ficaria com domIds:[]
        // e seria rejeitada por dossieValidator.js ao tentar reaproveitá-la
        // numa geração real — injeta o id da própria peça na tag-raiz antes
        // de qualquer correlação (ver injetarIdRaiz).
        if (domIdsDeHtml(cand.html).length === 0) {
            cand.html = injetarIdRaiz(cand.html, cand.id);
        }
        const tokens = new Set([...classesEIdsDeHtml(cand.html)].filter(_tokenEspecifico));
        const cssRelacionado = [];
        for (let i = modulos.length - 1; i >= 0; i--) {
            const bate = [...tokensDeSeletor(modulos[i].css)].some(t => _tokenEspecifico(t) && tokens.has(t));
            if (bate) {
                cssRelacionado.unshift(modulos[i].css);
                modulos.splice(i, 1);
            }
        }
        // JS só é correlacionado por id de DOM, nunca por classe: classes utilitárias
        // (ex: 'container', 'btn', 'row') são comuns demais e geram falso-positivo
        // por substring em qualquer script grande do documento. Ids são específicos
        // o bastante (ex: document.getElementById('sl-post-url')) pra serem um sinal
        // confiável de que aquele script pertence a esta peça.
        //
        // !cand.html.includes(js) exclui script já embutido literalmente dentro
        // do próprio HTML da peça (achado real, culinaria-boutique-gourmet:
        // widget com <script> inline dentro do <b:widget-setting> — o texto do
        // script sobrevive intacto em cand.html porque tipo:'secao' preserva
        // o b:section inteiro sem desembrulhar; sem esse filtro, o MESMO script
        // aparecia 2x no XML final — 1x embutido no HTML da seção, 1x de novo
        // no blob geral de JS via correlação por domId — colidindo em escopo
        // global igual o bug de peça 'widget' duplicada já fechado antes).
        const domIds = domIdsDeHtml(cand.html);
        // Compara contra o HTML já sem o escape de CDATA aninhado
        // (]]]]><![CDATA[> -> ]]>) — cand.html é a fatia crua do XML (nunca
        // passa por desembrulharCData), enquanto os "scripts" já vêm limpos;
        // sem essa normalização aqui, a comparação nunca bate por causa só
        // do escape, e a peça acaba com o MESMO script embutido duas vezes.
        const htmlSemEscapeCData = cand.html.replace(/\]\]\]\]><!\[CDATA\[>/g, ']]>');
        const jsRelacionado = scripts.filter(js => domIds.some(id => js.includes(id)) && !htmlSemEscapeCData.includes(js));
        pecas.push({
            id: cand.id,
            tipo: cand.tipo,
            protegida: false,
            domIds,
            css: cssRelacionado.join('\n\n'),
            html: cand.html,
            js: jsRelacionado.join('\n\n'),
            descricao: cand.descricao,
        });
    }
    // O que sobrou em `modulos` não foi correlacionado a nenhum hero/widget —
    // vira peça tipo:'modulo' pura (só CSS, sem HTML própria).
    for (const chunk of modulos) {
        pecas.push({
            id: chunk.id,
            tipo: 'modulo',
            protegida: false,
            domIds: [],
            css: chunk.css,
            html: '',
            js: '',
            descricao: chunk.descricao,
        });
    }
    return pecas;
}
// ── API pública ────────────────────────────────────────────────────────────
/**
 * Extrai dados estruturados de um template Blogger XML.
 *
 * @param {string} xml     — Conteúdo do arquivo XML
 * @param {string} [id]    — ID do pacote (usa nome do arquivo se omitido)
 * @returns {object}       — Dados extraídos
 */
function extrairTemplate(xml, id = 'template') {
    const customCss = extrairCss(xml);
    const cssVars = extrairCssVars(customCss, xml);
    const darkTheme = detectarDarkTheme(xml);
    const svgLogo = extrairSvgLogo(xml);
    const siteName = extrairSiteName(xml);
    const nichoTema = nichoDoId(id, NICHOS_VALIDOS) || inferirNicho(xml, customCss);
    const { heroHtml, staticSections } = extrairHeroESecoes(xml);
    const config = montarConfig(id, siteName, nichoTema, darkTheme, cssVars);
    const pecas = extrairPecas(xml, customCss, heroHtml);
    const pecasPorTipo = pecas.reduce((acc, p) => {
        acc[p.tipo] = (acc[p.tipo] || 0) + 1;
        return acc;
    }, {});
    return {
        id,
        siteName,
        nichoTema,
        darkTheme,
        cssVars,
        customCss,
        svgLogo,
        heroHtml,
        staticSections,
        pecas,
        config,
        // Estatísticas de extração
        _meta: {
            cssBytes: customCss ? Buffer.byteLength(customCss, 'utf8') : 0,
            heroBytes: heroHtml ? Buffer.byteLength(heroHtml, 'utf8') : 0,
            staticBytes: staticSections ? Buffer.byteLength(staticSections, 'utf8') : 0,
            temSvg: !!svgLogo,
            temDarkTheme: darkTheme,
            cssVarsEncontradas: Object.keys(cssVars).length,
            usouMarcadores: xml.includes('<!-- DP:CSS:START -->'),
            pecasEncontradas: pecas.length,
            pecasPorTipo,
        },
    };
}
