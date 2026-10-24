"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarDossie = validarDossie;
const { chassisParaNicho, pageTypeParaNicho } = require('../nichoTaxonomy');
// 'secao': widget Blogger REGISTRADO de verdade (<b:widget type='...'>,
// ex: BlogSearch, um HTML com destaque de posts) que precisa da própria
// <b:section> — diferente de 'widget' (HTML solto + script, tipo cookie-
// banner/scroll-to-top, que cabe em qualquer lugar da página via
// [[NICHO_WIDGETS_HTML]]). Ver nichoBlocks.js:_montarSecaoPeca e o slot
// [[NICHO_EXTRA_SECTIONS]] nos chassis.
const TIPOS_PECA_VALIDOS = new Set(['hero', 'widget', 'modulo', 'secao']);
function _validarTokensCss(tokensCss, erros, avisos) {
    if (!tokensCss || typeof tokensCss !== 'object') {
        erros.push('tokensCss é obrigatório e deve ser um objeto.');
        return;
    }
    const { light_mode: light, dark_mode: dark } = tokensCss;
    if (!light || typeof light !== 'object' || Array.isArray(light)) {
        erros.push('tokensCss.light_mode é obrigatório e deve ser um objeto — formato canônico exigido.');
    }
    else {
        for (const chave of Object.keys(light)) {
            if (!chave.startsWith('--')) {
                erros.push(`tokensCss.light_mode tem chave "${chave}" que não é uma variável CSS (deve começar com --).`);
            }
        }
        if (Object.keys(light).length === 0) {
            avisos.push('tokensCss.light_mode está vazio.');
        }
    }
    if (dark !== undefined) {
        if (typeof dark !== 'object' || Array.isArray(dark)) {
            erros.push('tokensCss.dark_mode, quando presente, deve ser um objeto.');
        }
        else {
            for (const chave of Object.keys(dark)) {
                if (chave === 'seletor')
                    continue;
                if (!chave.startsWith('--')) {
                    erros.push(`tokensCss.dark_mode tem chave "${chave}" que não é uma variável CSS nem "seletor".`);
                }
            }
        }
    }
}
function _validarPecas(pecas, erros, avisos) {
    if (!Array.isArray(pecas)) {
        erros.push('pecas é obrigatório e deve ser um array.');
        return;
    }
    if (pecas.length === 0) {
        avisos.push('pecas está vazio — nicho sem nenhum conteúdo próprio.');
    }
    const idsVistos = new Set();
    pecas.forEach((peca, idx) => {
        const ref = peca && peca.id ? `peça "${peca.id}"` : `pecas[${idx}]`;
        if (!peca || typeof peca !== 'object') {
            erros.push(`${ref}: deve ser um objeto.`);
            return;
        }
        if (!peca.id || typeof peca.id !== 'string') {
            erros.push(`${ref}: campo "id" é obrigatório e deve ser string.`);
        }
        else if (idsVistos.has(peca.id)) {
            erros.push(`peça "${peca.id}": id duplicado — pecas[].id devem ser únicos.`);
        }
        else {
            idsVistos.add(peca.id);
        }
        if (!TIPOS_PECA_VALIDOS.has(peca.tipo)) {
            erros.push(`${ref}: "tipo" deve ser um de ${[...TIPOS_PECA_VALIDOS].join('|')}, veio "${peca.tipo}".`);
        }
        if (typeof peca.protegida !== 'boolean') {
            erros.push(`${ref}: campo "protegida" é obrigatório e deve ser boolean.`);
        }
        const html = typeof peca.html === 'string' ? peca.html.trim() : '';
        // widgetNativo (ex: 'featured-post'): HTML novo introduzido por um
        // widget NATIVO do Blogger gerado em código (widgets.js), não pelo
        // campo "html" estático — mesma exigência de domIds do caso normal,
        // só que a fonte do HTML é outra (ver gerarHeroDestaqueMosaico).
        const introduzHtmlNovo = html.length > 0 || typeof peca.widgetNativo === 'string';
        // domIds só é exigido quando a peça introduz HTML novo — é o que
        // precisa de verificação mecânica pós-compilação (o HTML chegou no
        // output?). Peça "modulo" que só estiliza elementos JÁ existentes
        // no chassis (navbar, cards, post-body) tem css/js sem introduzir
        // nenhum elemento novo — não há o que verificar por domId.
        if (introduzHtmlNovo) {
            if (!Array.isArray(peca.domIds) || peca.domIds.length === 0) {
                erros.push(`${ref}: introduz HTML novo (html ou widgetNativo) mas "domIds" está ausente ou vazio — sem domIds não dá pra verificar mecanicamente que esse HTML chegou no output.`);
            }
        }
        else if (Array.isArray(peca.domIds) && peca.domIds.length > 0) {
            avisos.push(`${ref}: declara domIds mas não tem css nem js — nada a verificar.`);
        }
    });
}
// ──────────────────────────────────────────────────────────────
// validarDossie — valida o schema completo de um dossiê.
// Retorna { erros: string[], avisos: string[] }. Nunca lança.
// ──────────────────────────────────────────────────────────────
function validarDossie(dossie) {
    const erros = [];
    const avisos = [];
    if (!dossie || typeof dossie !== 'object') {
        return { erros: ['dossiê deve ser um objeto.'], avisos: [] };
    }
    const contrato = dossie;
    if (!contrato.nicho || typeof contrato.nicho !== 'string') {
        erros.push('campo "nicho" é obrigatório e deve ser string.');
    }
    if (typeof contrato.versaoDossie !== 'number') {
        erros.push('campo "versaoDossie" é obrigatório e deve ser number.');
    }
    if (contrato.nicho) {
        const chassisEsperado = chassisParaNicho(contrato.nicho);
        const pageTypeEsperado = pageTypeParaNicho(contrato.nicho);
        if (!chassisEsperado) {
            erros.push(`nicho "${contrato.nicho}" não existe em nichoTaxonomy.NICHO_CHASSIS_MAP.`);
        }
        else if (contrato.chassis !== chassisEsperado) {
            erros.push(`chassis "${contrato.chassis}" diverge de nichoTaxonomy.js (esperado "${chassisEsperado}") — fontes de verdade dessincronizadas.`);
        }
        if (!pageTypeEsperado) {
            erros.push(`nicho "${contrato.nicho}" não existe em nichoTaxonomy.NICHO_PAGE_TYPE_MAP.`);
        }
        else if (contrato.pageType !== pageTypeEsperado) {
            erros.push(`pageType "${contrato.pageType}" diverge de nichoTaxonomy.js (esperado "${pageTypeEsperado}") — fontes de verdade dessincronizadas.`);
        }
    }
    _validarTokensCss(contrato.tokensCss, erros, avisos);
    _validarPecas(contrato.pecas, erros, avisos);
    return { erros, avisos };
}
