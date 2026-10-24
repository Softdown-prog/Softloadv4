"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.gerarPlaceholderImagemSvg = gerarPlaceholderImagemSvg;
// ============================================================
// PLACEHOLDER DE IMAGEM — card exibido no lugar da foto do post
// quando o post não tem featuredImage/thumbnailUrl.
//
// Achado (refinamento pedido pelo usuário): todo chassis usava
// https://placehold.co/WxH/HEX/HEX?text=Softload|Post|Destaque — um
// serviço externo de terceiro, com "Softload" literal escrito na imagem
// de posts de sites de CLIENTES (vazamento de marca), zero relação com
// a paleta do nicho escolhido (cores fixas hardcoded por chassis, não
// pelo colorPreset real do site) e um ponto de falha externo: se
// placehold.co cair ou for descontinuado, todo post sem imagem em todo
// site já publicado do Engine quebra de uma vez.
//
// Corrigido gerando o placeholder localmente — SVG com as cores REAIS
// do colorPreset do site (--sl-primary/--sl-bg-body), embutido como
// data URI (nenhuma requisição de rede pro visitante, funciona offline,
// nunca quebra). Um único viewBox serve qualquer proporção final — o
// <img> que usa esse placeholder já controla o tamanho real via CSS
// (object-fit/aspect-ratio), o SVG só precisa ser um retângulo limpo.
// ============================================================
/**
 * Gera um data URI de SVG pra usar como placeholder de imagem de post.
 * Ícone universal de "sem imagem" (moldura + sol + montanha), na cor
 * primária do site em baixa opacidade sobre um fundo levemente tingido —
 * nunca texto (não deixa marca nenhuma, nem do Softload nem do nicho).
 *
 * @param {string} corPrimaria — hex da cor primária do colorPreset (ex: '#0ea5e9')
 * @param {string} corFundo    — hex de fundo do card/nicho (ex: '#f8fafc')
 * @returns {string} data:image/svg+xml;base64,....
 */
function gerarPlaceholderImagemSvg(corPrimaria, corFundo) {
    const primaria = /^#[0-9a-fA-F]{3,8}$/.test(corPrimaria) ? corPrimaria : '#64748b';
    const fundo = /^#[0-9a-fA-F]{3,8}$/.test(corFundo) ? corFundo : '#f1f5f9';
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 400 300'>
<rect width='400' height='300' fill='${fundo}'/>
<g opacity='0.32'>
<circle cx='150' cy='115' r='24' fill='${primaria}'/>
<path d='M40 230 L145 140 L200 185 L255 120 L360 230 Z' fill='${primaria}'/>
</g>
</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}
