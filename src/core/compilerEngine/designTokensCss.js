"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.TOKENS_GLOBAIS_CHASSIS = void 0;
exports.gerarDynamicCss = gerarDynamicCss;
exports.gerarTypographyCss = gerarTypographyCss;
exports.gerarCategoryBadgesCss = gerarCategoryBadgesCss;
exports.gerarButtonCss = gerarButtonCss;
exports.gerarGridCardCss = gerarGridCardCss;
const { sanitizarCssColor, hexParaRgb } = require('./sanitize');
// ==========================================
// CSS DE DESIGN TOKENS (cor, tipografia, badges, botão)
// ==========================================
// Tokens SEMPRE disponíveis sitewide, injetados aqui (gerarDynamicCss, todo
// nicho) ou no :root de cada chassis (template_*.xml, --sl-radius-lg/-sm/
// -transition presentes em blog/magazine/portfolio/saas — não incluído
// --sl-nav-bg, que só existe em template_magazine.xml). Fonte única pra
// quem precisa saber "essa var CSS é órfã ou é global do motor?" — usado
// por pecaOrchestrator.js/templateEditAgent.js na validação de peça nova
// (cssWorker.validarTokensCss só sabe o que a gente disser que é externo).
// Achado real: peças usando var(--sl-primary-rgb) — padrão idiomático usado
// na maioria dos nichos — eram acusadas de "variável órfã" na validação,
// porque só os tokens do PRÓPRIO nicho (tokensCss) entravam na lista.
exports.TOKENS_GLOBAIS_CHASSIS = [
    '--sl-primary', '--sl-primary-rgb', '--sl-bg-body', '--sl-card-bg',
    '--sl-card-bg-rgb', '--sl-text-main', '--sl-text-muted', '--sl-border',
    '--sl-footer-bg', '--sl-btn-radius', '--sl-btn-shadow', '--sl-font-family',
    '--sl-heading-weight', '--sl-radius-lg', '--sl-radius-sm', '--sl-transition',
];
function gerarDynamicCss(tokens, { preserveNicheFooter = false } = {}) {
    const { color, button, typography } = tokens;
    return `
    /* === DESIGN TOKENS ESCOLHIDOS PELO USUÁRIO === */
    /* Este bloco sobrescreve os defaults do Blogger acima */
    :root {
      --sl-primary:        ${color.primary} !important;
      --sl-primary-rgb:    ${hexParaRgb(color.primary)};
      --sl-bg-body:        ${color.bgBody} !important;
      --sl-card-bg:        ${color.cardBg} !important;
      --sl-card-bg-rgb:    ${hexParaRgb(color.cardBg)};
      --sl-text-main:      ${color.textMain} !important;
      /* --sl-text-muted / --sl-border: derivados de textMain via color-mix()
         em vez de mais uma cor fixa por preset — funcionam automaticamente
         em qualquer preset (claro ou escuro) sem precisar de dado novo.
         Achado real: usadas em 7/14 nichos (--sl-text-muted) e em blocos de
         variante de outro nicho (--sl-border, sob o nome divergente
         --sl-border-color) mas NUNCA declaradas — var() sem fallback
         resolvia pra vazio, texto secundário e bordas sutis sumiam. Suporte
         color-mix(): Chrome 111+/Firefox 113+/Safari 16.2+, já usado em
         outro lugar do projeto (tecnologia-mag-tech color_mix_css). */
      --sl-text-muted:     color-mix(in srgb, ${color.textMain} 65%, transparent);
      --sl-border:         color-mix(in srgb, ${color.textMain} 12%, transparent);
      --sl-footer-bg:      ${color.footerBg} !important;
      --sl-btn-radius:     ${button.btnRadius};
      --sl-btn-shadow:     ${button.btnShadow};
      --sl-font-family:    ${typography.fontFamily};
      --sl-heading-weight: ${typography.headingWeight};
    }
    body {
      background-color: ${color.bgBody};
      color: ${color.textMain};
      font-family: ${typography.fontFamily};
    }
    h1, h2, h3, h4, h5, h6 { font-weight: ${typography.headingWeight}; }
    a { color: ${color.primary}; }
    .text-primary { color: ${color.primary} !important; }
    .btn-primary, .badge-primary {
      background-color: ${color.primary};
      border-color: ${color.primary};
      border-radius: ${button.btnRadius};
      box-shadow: ${button.btnShadow};
    }
    ${preserveNicheFooter ? '.sl-footer' : '.sl-footer, footer'} {
      background-color: ${color.footerBg} !important;
    }`.trim();
}
function gerarTypographyCss(typography) {
    return `
    /* === TIPOGRAFIA: ${typography.label} === */
    body,
    .post-body,
    .post-title,
    .widget-content,
    input, button, select, textarea {
      font-family: ${typography.fontFamily} !important;
    }
    h1, h2, h3, h4, h5, h6,
    .post-title a,
    .widget-title,
    .blog-title {
      font-family: ${typography.fontFamily} !important;
      font-weight: ${typography.headingWeight} !important;
      line-height: ${typography.lineHeight || '1.3'};
      letter-spacing: ${typography.letterSpacing || '0'};
    }
    p, li, td, th, blockquote {
      font-family: ${typography.fontFamily} !important;
      line-height: ${typography.lineHeight || '1.7'};
    }`.trim();
}
/**
 * Gera CSS para badges de categoria personalizados.
 * Valida cada cor hex antes de injetar — impede CSS injection.
 */
function gerarCategoryBadgesCss(badges) {
    if (!badges || badges.length === 0)
        return '';
    let css = '\n    /* === CUSTOM CATEGORY BADGES === */';
    badges.forEach((badge, idx) => {
        const bg = sanitizarCssColor(badge.bg, '#3498db');
        const text = sanitizarCssColor(badge.text, '#ffffff');
        css += `
    .sl-badge-${idx},
    [data-badge="${badge.nome}"] {
      background-color: ${bg} !important;
      color: ${text} !important;
      border-color: ${bg} !important;
    }`;
    });
    return css;
}
/**
 * Gera o tratamento visual COMPLETO do estilo de botão escolhido.
 *
 * O gerarDynamicCss() já define --sl-btn-radius / --sl-btn-shadow e aplica
 * o básico em .btn-primary. Esta função aprofunda: borda, transição, hover e
 * peso por estilo, com cobertura ampla de seletores (.btn-primary, .sl-btn,
 * .btn-cta) para que a escolha do usuário seja realmente visível.
 *
 * buttonKey ∈ flat | default | pill | neon | brutalist (fallback: default).
 * `primary` é a cor primária do preset (hex válido).
 */
function gerarButtonCss(buttonKey, primary) {
    const cor = sanitizarCssColor(primary, '#0ea5e9');
    // Tratamentos por estilo: [base extra, hover]
    const TRATAMENTOS = {
        flat: {
            base: 'border:none;box-shadow:none;transition:opacity .15s ease;',
            hover: 'opacity:.85;',
        },
        default: {
            base: 'border:none;transition:transform .15s ease,box-shadow .15s ease;',
            hover: 'transform:translateY(-2px);box-shadow:0 6px 18px rgba(0,0,0,.22);',
        },
        pill: {
            base: 'border:none;transition:transform .15s ease,box-shadow .15s ease;',
            hover: 'transform:translateY(-2px) scale(1.02);box-shadow:0 8px 22px rgba(0,0,0,.25);',
        },
        neon: {
            base: `border:1px solid ${cor};box-shadow:0 0 18px ${cor}66;transition:box-shadow .2s ease;`,
            hover: `box-shadow:0 0 28px ${cor}aa,0 0 8px ${cor};`,
        },
        brutalist: {
            base: 'border:2px solid #111;box-shadow:4px 4px 0 #111;font-weight:700;transition:transform .1s ease,box-shadow .1s ease;',
            hover: 'transform:translate(2px,2px);box-shadow:2px 2px 0 #111;',
        },
    };
    const t = TRATAMENTOS[buttonKey] || TRATAMENTOS.default;
    return `
    /* === ESTILO DE BOTÃO: ${buttonKey} === */
    .btn { border-radius: var(--sl-btn-radius, 8px); }
    .btn-primary, .sl-btn, .btn-cta {
      border-radius: var(--sl-btn-radius, 8px);
      ${t.base}
    }
    .btn-primary:hover, .sl-btn:hover, .btn-cta:hover {
      ${t.hover}
    }`.trim();
}
/**
 * CSS de todas as variantes de gridLayout (formato do card de post) — fonte
 * única aplicada aos chassis com feed de posts em .news-card (base/blog/
 * magazine). Seletores universais (.news-card > a, .news-card img,
 * .news-card > div:last-child) em vez de classes internas específicas de
 * cada chassis — achado real: a versão anterior (hardcoded, duplicada em
 * blog.xml e magazine.xml) usava seletores como .news-card-img/h3/
 * a.overflow-hidden que só batiam com a marcação de template_blog.xml; em
 * template_magazine.xml (nomes de classe internos diferentes) a maior parte
 * das regras de lista/quadrado/mural nunca surtia efeito, e template_base.xml
 * não tinha bloco nenhum (dupla/quadrado/mural lá só mudavam a densidade
 * row-cols, sem o tratamento visual). Escopado por .sl-grid-<nome> (classe
 * injetada via GRID_CLASS) — inofensivo em chassis sem feed de posts
 * (saas/portfolio/biolink usam outra estrutura de card).
 */
function gerarGridCardCss() {
    return `
    /* === VARIANTES DE FORMATO DE CARD (gridLayout) === */

    /* lista: card horizontal — thumb à esquerda, texto à direita */
    .sl-grid-lista .news-card { flex-direction: row !important; height: auto !important; }
    .sl-grid-lista .news-card > a:first-child {
      width: 38%; flex-shrink: 0; overflow: hidden;
      border-radius: var(--sl-radius-lg) 0 0 var(--sl-radius-lg) !important;
    }
    .sl-grid-lista .news-card > a:first-child img {
      width: 100%; height: 100%; min-height: 150px;
      aspect-ratio: unset !important; object-fit: cover;
    }
    @media (max-width: 575.98px) {
      .sl-grid-lista .news-card { flex-direction: column !important; }
      .sl-grid-lista .news-card > a:first-child {
        width: 100%; border-radius: var(--sl-radius-lg) var(--sl-radius-lg) 0 0 !important;
      }
    }

    /* dupla: imagens widescreen, 2 colunas */
    .sl-grid-dupla .news-card img { aspect-ratio: 21/9 !important; }
    .sl-grid-dupla .news-card > div:last-child { padding: 1.25rem !important; }
    .sl-grid-dupla .news-card h2, .sl-grid-dupla .news-card h3 { font-size: .95rem !important; }

    /* quadrado: thumbnails 1:1, cards compactos */
    .sl-grid-quadrado .news-card img { aspect-ratio: 1/1 !important; }
    .sl-grid-quadrado .news-card > div:last-child { padding: .7rem !important; }
    .sl-grid-quadrado .news-card h2, .sl-grid-quadrado .news-card h3 { font-size: .78rem !important; -webkit-line-clamp: 2; }
    .sl-grid-quadrado .news-card p { -webkit-line-clamp: 2; }
    @media (min-width: 768px) { .sl-grid-quadrado .blog-featured { display: none; } }

    /* mural: mini cards (4 colunas), só thumbnail + título */
    .sl-grid-mural .news-card img { aspect-ratio: 4/3 !important; }
    .sl-grid-mural .news-card > div:last-child { padding: .5rem !important; }
    .sl-grid-mural .news-card h2, .sl-grid-mural .news-card h3 { font-size: .7rem !important; margin-bottom: 0 !important; -webkit-line-clamp: 2; }
    .sl-grid-mural .news-card p,
    .sl-grid-mural .news-card .mt-auto { display: none !important; }

    /* coluna-unica: lista minimalista centralizada, sem chrome de card (estilo Medium) */
    .sl-grid-coluna-unica { max-width: 720px; margin-left: auto; margin-right: auto; }
    .sl-grid-coluna-unica .news-card {
      flex-direction: row-reverse !important; align-items: flex-start; gap: 1.25rem;
      background: transparent !important; box-shadow: none !important; border: none !important; border-radius: 0 !important;
      border-bottom: 1px solid var(--sl-border); padding-bottom: 1.75rem; margin-bottom: 1.75rem;
    }
    .sl-grid-coluna-unica .news-card:hover { transform: none !important; box-shadow: none !important; }
    .sl-grid-coluna-unica .news-card > a:first-child {
      width: 112px; flex-shrink: 0; overflow: hidden; border-radius: 8px !important;
    }
    .sl-grid-coluna-unica .news-card > a:first-child img { aspect-ratio: 1/1 !important; object-fit: cover; }
    .sl-grid-coluna-unica .news-card > div:last-child { padding: 0 !important; border: none !important; }
    .sl-grid-coluna-unica .news-card h2, .sl-grid-coluna-unica .news-card h3 { font-size: 1.25rem !important; }
    [data-bs-theme="dark"] .sl-grid-coluna-unica .news-card { border-bottom-color: rgba(255,255,255,.1); }
    @media (max-width: 575.98px) {
      .sl-grid-coluna-unica .news-card > a:first-child { width: 84px; }
    }

    /* zigzag: alterna o lado da imagem a cada post (mostruário assimétrico) */
    .sl-grid-zigzag .news-card { flex-direction: row !important; height: auto !important; }
    .sl-grid-zigzag .news-card > a:first-child { width: 45%; flex-shrink: 0; overflow: hidden; }
    .sl-grid-zigzag .news-card > a:first-child img {
      width: 100%; height: 100%; min-height: 220px;
      aspect-ratio: unset !important; object-fit: cover;
    }
    .sl-grid-zigzag .col:nth-child(even) .news-card { flex-direction: row-reverse !important; }
    @media (max-width: 767.98px) {
      .sl-grid-zigzag .news-card,
      .sl-grid-zigzag .col:nth-child(even) .news-card { flex-direction: column !important; }
      .sl-grid-zigzag .news-card > a:first-child { width: 100%; }
    }`.trim();
}
