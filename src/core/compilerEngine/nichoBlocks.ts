/** Montagem de nichos Blogger: caminho legado e peças autorais em dossiês. */
export interface PecaNicho {
    id: string;
    tipo?: 'hero' | 'widget' | 'modulo' | 'secao';
    css?: string | null;
    html?: string | null;
    js?: string | null;
    protegida?: boolean;
    domIds?: string[];
    widgetNativo?: string | null;
    tituloWidget?: string | null;
    cssVariantes?: string[];
    htmlVariantes?: string[];
    jsVariantes?: string[];
}
export interface TokensCssNicho {
    light_mode?: Record<string, unknown>;
    dark_mode?: ({ seletor?: string } & Record<string, unknown>) | null;
}
export interface DossieNicho {
    nicho: string;
    pecas: PecaNicho[];
    tokensCss?: TokensCssNicho | null;
}
export interface NichoBlocosResultado {
    css: string;
    js: string;
    heroHtml: string;
    heroNativoXml?: string | null;
    widgetsHtml: string;
    extraSecoesHtml?: string;
}
declare function require(name: string): unknown;
declare const console: { log(value: string): void };

const { pickBlock, temBlocos, hashSeed } = require('../blockLibrary') as typeof import('../blockLibrary');
const { sanitizarEntidadesXml } = require('./xmlEntities') as typeof import('./xmlEntities');
const { carregarNichoImpl } = require('./nichoImpl') as typeof import('./nichoImpl');
const { gerarPaletaCss } = require('./nichoPaletas') as typeof import('./nichoPaletas');
const { carregarNichoDossie } = require('./dossieLoader') as typeof import('./dossieLoader');
const { gerarHeroDestaqueMosaico, gerarHeroDestaqueCard } = require('./widgets') as typeof import('./widgets');

// widgetNativo → gerador de b:widget FeaturedPost correspondente. Cada
// layout autoral de hero-de-posts-reais tem seu próprio HTML/CSS (ver
// widgets.js) — a chave no dossiê escolhe qual reaproveitar, sem duplicar
// lógica de widgetNativo === 'x' espalhada pelo código.
const GERADORES_HERO_NATIVO: Record<string, (title: string, id: string) => string> = {
    'featured-post':      gerarHeroDestaqueMosaico,
    'featured-post-card': gerarHeroDestaqueCard,
};

// Variedade estrutural DENTRO de uma peça protegida — achado real (usuário
// relatou "peço um template mobile 10x, sempre o mesmo, sem coerência
// visual"): peça protegida:true nunca troca por HTML genérico de OUTRO
// nicho (pickBlock, ver abaixo) — isso é correto, preserva fidelidade de
// design — mas até agora significava também nenhuma variação DENTRO do
// próprio nicho: cor muda por seed (nichoPaletas.js), estrutura nunca.
// `htmlVariantes`/`cssVariantes` (opcionais, no dossiê) são N variações
// autorais da MESMA peça (mesmo domId, mesmo papel) — escolhidas por seed
// determinístico, mesmo padrão já usado em modules.js
// (_DARK_MODE_VARIANTES/_BACK_TO_TOP_VARIANTES/PAGINATION_VARIANTES).
// peca.html/peca.css continuam populados com a 1ª variante — dossieValidator
// e dossieIntegrityChecker não precisam saber que variantes existem.
function _escolherVariantePeca<T>(seed: string | null | undefined, peca: PecaNicho, campoVariantes: 'cssVariantes' | 'htmlVariantes' | 'jsVariantes', valorPadrao: T): string | T {
    const variantes = peca[campoVariantes];
    if (!Array.isArray(variantes) || variantes.length === 0) return valorPadrao;
    if (variantes.length === 1) return variantes[0];
    const idx = hashSeed(`${seed || ''}:peca:${peca.id}`) % variantes.length;
    return variantes[idx];
}

// ==========================================
// NICHO + BLOCK LIBRARY — motor de dois canos
//
// carregarNichoImplComBlocos() é o único ponto de entrada, mesma
// assinatura e mesmo contrato de retorno de sempre (+ campo novo
// widgetsHtml). Por dentro, escolhe o cano pela presença do dossiê:
//
//   dossiê existe → CANO NOVO (montarNichoDeDossie): peças explícitas
//   já separadas em css/html/js, sem walker heurístico, respeitando
//   protegida:true (nunca troca hero/widget autoral por variante
//   genérica do block library).
//
//   dossiê não existe → CANO ANTIGO (montarNichoLegado): o mesmo
//   comportamento de sempre, walker heurístico (nichoImpl.js) +
//   paletas (nichoPaletas.js) + block library (blockLibrary.js).
//   Zero mudança de comportamento pros nichos ainda não migrados.
// ==========================================

/**
 * CANO ANTIGO — comportamento inalterado. Combina impl.json com blocos
 * gerados pelo Block Worker.
 *
 * Prioridade:
 *   css      → bloco gerado (se existir) + impl CSS (base)
 *   heroHtml → bloco gerado (se existir) OU impl hero (fallback)
 *   js       → sempre do impl.json (JS é template-specific)
 *
 * O seed garante que o mesmo siteName+nicho sempre receba a
 * mesma variante — determinístico, não aleatório.
 */
function montarNichoLegado(nichoTema: string | null | undefined, siteName: string): NichoBlocosResultado {
    const base = carregarNichoImpl(nichoTema);
    const seed = (siteName || '') + String(nichoTema);

    // Paleta de cor determinística (ver nichoPaletas.js) — retorna '' pra
    // nichos sem paleta documentada, então não altera nada fora do escopo.
    const paletaCss = gerarPaletaCss(nichoTema, seed);
    const comPaleta = paletaCss
        ? { ...base, css: paletaCss + '\n\n    ' + base.css }
        : base;

    if (!nichoTema || !temBlocos(nichoTema)) return { ...comPaleta, widgetsHtml: '' };

    const cssBloco  = pickBlock(nichoTema, 'card_css',  seed);
    const heroBloco = pickBlock(nichoTema, 'hero_html', seed);

    const css = cssBloco
        ? comPaleta.css + '\n\n    /* === VARIANTE GERADA === */\n    ' + cssBloco
        : comPaleta.css;

    const heroHtml = sanitizarEntidadesXml(heroBloco || comPaleta.heroHtml);

    console.log(`[NICHO-BLOCKS] ${nichoTema}: css_bloco=${!!cssBloco} hero_bloco=${!!heroBloco}`);

    return { css, js: comPaleta.js, heroHtml, widgetsHtml: '' };
}

// Gera o bloco :root{}/[data-bs-theme='dark']{} a partir de tokensCss —
// SEM aliasing heurístico tipo tokenVar() (regex sobre nome de chave).
// O dossiê já declara o valor final (literal ou var(--sl-*)) — quem
// escreve o dossiê decide explicitamente, não o compilador por adivinhação.
function _tokensCssParaBloco(tokensCss: TokensCssNicho | null | undefined): string {
    if (!tokensCss || !tokensCss.light_mode) return '';

    const luzEntries = Object.entries(tokensCss.light_mode).filter(([k]) => k.startsWith('--'));
    if (luzEntries.length === 0) return '';

    let bloco = `:root {\n${luzEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;

    if (tokensCss.dark_mode) {
        const seletor    = tokensCss.dark_mode.seletor || "[data-bs-theme='dark']";
        const trevaEntries = Object.entries(tokensCss.dark_mode).filter(([k]) => k.startsWith('--'));
        if (trevaEntries.length > 0) {
            bloco += `\n${seletor} {\n${trevaEntries.map(([k, v]) => `  ${k}: ${v};`).join('\n')}\n}`;
        }
    }

    return bloco;
}

// Embrulha o html/css/js de uma peça "widget"/"modulo" pra injeção direta
// no <body> (fora de qualquer <b:section>) — mesmo formato usado hoje
// pelos módulos raw como COOKIE_BANNER/BACK_TO_TOP em modules.js: <style>
// próprio (não está dentro do <b:skin>, então precisa da tag) + html +
// <script> próprio (mesmo padrão CDATA de nichoImpl.js).
//
// Suporta htmlVariantes/cssVariantes/jsVariantes (mesmo mecanismo de
// _escolherVariantePeca usado em hero/modulo) — achado real: peças tipo
// 'widget' (ex: cookie-banner autoral de culinaria-boutique-gourmet e
// viral-magazine) ficavam de fora da variedade estrutural porque este
// caminho nunca olhava pros campos *Variantes. Os 3 campos usam a MESMA
// chave de hash (seed:peca:peca.id), então ficam sincronizados — se o
// html de uma variante usa ids diferentes, o js daquela MESMA variante
// (jsVariantes no mesmo índice) sempre bate junto.
function _montarWidgetPeca(peca: PecaNicho, seed: string): string {
    const cssEscolhido  = _escolherVariantePeca(seed, peca, 'cssVariantes', peca.css);
    const htmlEscolhido = _escolherVariantePeca(seed, peca, 'htmlVariantes', peca.html);
    const jsEscolhido   = _escolherVariantePeca(seed, peca, 'jsVariantes', peca.js);

    const css  = typeof cssEscolhido  === 'string' ? cssEscolhido.trim()  : '';
    const html = typeof htmlEscolhido === 'string' ? htmlEscolhido.trim() : '';
    const js   = typeof jsEscolhido   === 'string' ? jsEscolhido.trim()   : '';

    const partes: string[] = [];
    if (css)  partes.push(`<style>\n${css}\n</style>`);
    if (html) partes.push(html);
    if (js)   partes.push(`<script>\n//<![CDATA[\n${js}\n//]]>\n</script>`);

    return partes.join('\n');
}

// tipo:'secao' = <b:widget type='...'> Blogger REGISTRADO de verdade
// (BlogSearch, HTML com destaque de posts) — schema do Blogger só aceita
// b:widget como filho direto de b:section (upload rejeitado com "is not
// within a section" senão). peca.html já é o CONTEÚDO interno de uma
// <b:section> (extraído por templateExtractor.js:extrairSecoesXml, que
// tira as tags <b:section>...</b:section> da fonte original) — aqui a
// gente devolve o wrapper. css/js NÃO entram aqui (b:section só aceita
// b:widget como filho — ver achado real no PR do piloto culinaria-
// boutique-gourmet): vão pro blob geral (NICHO_CSS/NICHO_JS), igual peça
// tipo:'modulo' — montarNichoDeDossie já inclui 'secao' em pecasBlobGeral
// por não ser 'widget'.
function _montarSecaoPeca(peca: PecaNicho): string | null {
    const html = typeof peca.html === 'string' ? peca.html.trim() : '';
    if (!html) return null;
    return `<b:section id='${peca.id}' maxwidgets='1' showaddelement='yes'>\n${html}\n</b:section>`;
}

/**
 * CANO NOVO — monta {css, js, heroHtml, widgetsHtml, extraSecoesHtml} a
 * partir de um dossiê já validado. Sem walker heurístico: cada peça já
 * vem com css/html/js separados por quem escreveu o dossiê.
 */
function montarNichoDeDossie(dossie: DossieNicho, siteName: string): NichoBlocosResultado {
    const seed = (siteName || '') + dossie.nicho;

    // "widget" é autocontido (<style>+html+<script> próprios, ver
    // _montarWidgetPeca) e injetado só em widgetsHtml — NUNCA também no
    // blob geral de css/js, senão duplica (achado real, culinaria-
    // boutique-gourmet: cada peça widget aparecia 2x no XML final,
    // colidindo em escopo global — "Identifier already declared").
    // "modulo" não tem html próprio (estiliza elemento já existente no
    // chassis), então seu css/js só faz sentido no blob geral.
    // "hero" tem html embrulhado à parte (heroHtml → NICHO_HERO via
    // montarWidgetHtml, que só aceita html — não tem <style>/<script>
    // próprios), então seu css/js também precisa ir pro blob geral.
    // "secao" é <b:widget> Blogger REGISTRADO de verdade — schema só
    // aceita b:widget como filho direto de b:section (_montarSecaoPeca
    // devolve só a b:section+b:widget, sem <style>/<script> dentro), então
    // igual hero/modulo, seu css/js vai pro blob geral (fica de fora só o
    // 'widget' simples, que já é autocontido).
    const pecasBlobGeral = dossie.pecas.filter(p => p.tipo !== 'widget');

    const tokensBloco = _tokensCssParaBloco(dossie.tokensCss);
    // Achado real: templateExtractor.js só separa CSS em peças granulares
    // achando comentários `/* ── TÍTULO ── */` no nível raiz do stylesheet
    // (extrairPecasCssModulo) — convenção que só existe em exemplos/*.xml
    // escritos à mão. O CSS que O PRÓPRIO COMPILADOR monta aqui nunca teve
    // esse marcador, então extrair um XML compilado sempre colapsava TODO
    // o stylesheet numa peça só (geralmente absorvida inteira pelo hero,
    // por correlação de token) — 70 dos 75 templates derivados desta sessão
    // saíram assim, inutilizáveis como fonte granular de variantes. Emitir
    // `/* ── <id> ── */` antes do css de cada peça fecha o ciclo: qualquer
    // XML compilado depois disso vira pecas.json corretamente granular ao
    // ser re-extraído, sem precisar tocar em extrairPecasCssModulo.
    const cssPecas = pecasBlobGeral
        .map(p => {
            const cssEscolhido = _escolherVariantePeca(seed, p, 'cssVariantes', p.css);
            const css = typeof cssEscolhido === 'string' ? cssEscolhido.trim() : '';
            return css ? `/* ── ${p.id.replace(/^modulo-/, '')} ── */\n${css}` : '';
        })
        .filter(Boolean)
        .join('\n\n    ');
    const css = [tokensBloco, cssPecas].filter(Boolean).join('\n\n    ');

    const js = pecasBlobGeral
        .map(p => (typeof p.js === 'string' ? p.js.trim() : ''))
        .filter(Boolean)
        .map(codigo => `<script>\n//<![CDATA[\n${codigo}\n//]]>\n</script>`)
        .join('\n  ');

    const pecaHero = dossie.pecas.find(p => p.tipo === 'hero');
    let heroHtml = '';
    let heroNativoXml: string | null = null;
    if (pecaHero) {
        // widgetNativo: hero cujo conteúdo real (imagem/título/link de post)
        // não existe até o site ter posts — HTML estático "protegido" só
        // teria como simular isso com placeholder tipo "[TITULO]"/
        // "[URL_POST_0]", que nunca são preenchidos (achado real,
        // noticias-mag-news: vazavam literalmente pro XML compilado). Rota
        // separada: widget NATIVO do Blogger com data: binding de verdade,
        // nunca passa por pickBlock/protegida (não é HTML estático).
        const geradorHeroNativo = GERADORES_HERO_NATIVO[pecaHero.widgetNativo as string];
        if (geradorHeroNativo) {
            heroNativoXml = geradorHeroNativo(pecaHero.tituloWidget || 'Destaque', pecaHero.domIds?.[0] || 'heroDestaque');
        } else {
            // protegida:true nunca é trocada por variante GENÉRICA de OUTRO
            // nicho (pickBlock) — isso continua valendo, preserva fidelidade
            // de design. htmlVariantes é diferente: variação AUTORAL dentro
            // do próprio nicho (mesmo domId, mesmo papel), escolhida por seed
            // — não passa por pickBlock, não tem nada a ver com esse guard.
            const htmlEscolhido = _escolherVariantePeca(seed, pecaHero, 'htmlVariantes', pecaHero.html);
            const variante = pecaHero.protegida ? null : pickBlock(dossie.nicho, 'hero_html', seed);
            heroHtml = sanitizarEntidadesXml(variante || htmlEscolhido || '');
        }
    }

    const widgetsHtml = dossie.pecas
        .filter(p => p.tipo === 'widget')
        .map(p => _montarWidgetPeca(p, seed))
        .filter(Boolean)
        .join('\n\n');

    const extraSecoesHtml = dossie.pecas
        .filter(p => p.tipo === 'secao')
        .map(_montarSecaoPeca)
        .filter(Boolean)
        .join('\n\n');

    return { css, js, heroHtml, heroNativoXml, widgetsHtml, extraSecoesHtml };
}

/**
 * Ponto de entrada único — escolhe o cano (dossiê novo ou legado
 * heurístico) pela presença de tema-{nicho}-dossie.json. Mesma
 * assinatura e mesmo contrato de retorno de sempre, mais os campos
 * widgetsHtml/extraSecoesHtml (sempre '' no cano legado).
 */
function carregarNichoImplComBlocos(nichoTema: string | null | undefined, siteName: string): NichoBlocosResultado {
    const dossie = carregarNichoDossie(nichoTema) as unknown as DossieNicho | null;
    if (dossie) return montarNichoDeDossie(dossie, siteName);
    return montarNichoLegado(nichoTema, siteName);
}

export { carregarNichoImplComBlocos, montarNichoLegado, montarNichoDeDossie, _escolherVariantePeca };
