"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarSeoModule = gerarSeoModule;
const sanitize_1 = require("./sanitize");
/**
 * Escapa texto dentro de literal JSON-LD, não via entidades HTML.
 * Mantém exatamente a estratégia legada (JSON.stringify + escapes Unicode).
 */
function paraJsonLd(texto) {
    return JSON.stringify(String(texto || ''))
        .replace(/&/g, '\\u0026')
        .replace(/</g, '\\u003c')
        .replace(/>/g, '\\u003e');
}
/**
 * Gera SEO do Blogger preservando prioridade da metaDescription da plataforma,
 * descrição de até 160 caracteres e fallback para nome do site.
 */
function gerarSeoModule(siteName, description) {
    const safeSiteName = (0, sanitize_1.sanitizarInput)(siteName);
    const descricaoLimpa = (0, sanitize_1.sanitizarInput)(description || '').slice(0, 160);
    const descricaoFallback = descricaoLimpa || safeSiteName;
    return `
    <!-- SEO Premium - Gerado pelo Softload Engine -->
    <b:if cond='data:blog.metaDescription'>
      <meta expr:content='data:blog.metaDescription' name='description'/>
    <b:else/>
      <meta content='${descricaoFallback}' name='description'/>
    </b:if>
    <link expr:href='data:blog.homepageUrl' rel='canonical'/>
    <b:if cond='data:view.isHomepage'>
      <meta content='index, follow' name='robots'/>
    <b:else/>
      <meta content='index, follow, max-snippet:-1, max-image-preview:large' name='robots'/>
    </b:if>
    <script type='application/ld+json'>
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "name": ${paraJsonLd(siteName)}${descricaoLimpa ? `,\n      "description": ${paraJsonLd(descricaoLimpa)}` : ''},
      "url": "<data:blog.homepageUrl/>"
    }
    </script>`.trim();
}
