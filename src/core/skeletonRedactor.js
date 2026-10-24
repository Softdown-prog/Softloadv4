"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redigirDadosReais = redigirDadosReais;
// ============================================================
// Redação de dado real antes de exemplos/<nicho>.xml virar esqueleto de
// produção (template_<nicho>.xml) — ver plano "esqueleto por nicho".
//
// Achado: exemplos/*.xml são exports REAIS do Blogger, não templates
// limpos — confirmado em appstore-bulma-mobile.xml (URLs reais de imagem
// em blogger.googleusercontent.com, domínio real de terceiro
// bulma-mobile.blogspot.com). Nenhuma lógica de redação existia até esta
// migração porque o extrator sempre descartou as seções estruturais antes
// (só pegava CSS/JS de peça, nunca a estrutura física da página) — agora
// que a estrutura inteira é reaproveitada como esqueleto de produção,
// vazar essa informação exporia dado privado de um terceiro real pra todo
// usuário futuro do nicho.
//
// Passo mecânico + revisão humana obrigatória (mesmo espírito de
// reconstruirDossie.js): redigirDadosReais() nunca decide sozinho que um
// esqueleto está pronto pra produção — devolve os achados pra quem rodou
// a extração revisar antes de promover o arquivo.
// ============================================================
const PADROES_URL_IMAGEM_REAL = [
    /https?:\/\/blogger\.googleusercontent\.com\/img\/[^\s'")<]+/g,
    /https?:\/\/\d\.bp\.blogspot\.com\/[^\s'")<]+/g,
    /https?:\/\/lh\d\.googleusercontent\.com\/[^\s'")<]+/g,
];
// Domínio real do blog de origem (ex.: bulma-mobile.blogspot.com) —
// aparece em canonical/hrefs internos copiados junto com a estrutura.
const PADRAO_DOMINIO_REAL = /https?:\/\/([a-z0-9-]+)\.blogspot\.com/gi;
const PLACEHOLDER_IMG_URL = 'https://placehold.co/800x450';
const PLACEHOLDER_DOMINIO = 'seu-blog.blogspot.com';
// Settings de widget que costumam carregar identidade real do autor
// original (perfil social, handle) — não são stripados automaticamente
// (o valor pode ser estruturalmente necessário pro schema do widget), só
// sinalizados no relatório de achados pra decisão humana caso a caso.
const SETTINGS_SUSPEITOS = ['facebookPage', 'twitterUsername', 'authorProfileUrl', 'plusPageUrl'];
function redigirDadosReais(xml) {
    let redigido = xml;
    const achados = [];
    for (const padrao of PADROES_URL_IMAGEM_REAL) {
        const matches = redigido.match(padrao);
        if (matches) {
            achados.push(`${matches.length} URL(s) de imagem real do Blogger substituída(s) por placeholder (${padrao.source.slice(0, 40)}...).`);
            redigido = redigido.replace(padrao, PLACEHOLDER_IMG_URL);
        }
    }
    const dominios = redigido.match(PADRAO_DOMINIO_REAL);
    if (dominios) {
        const unicos = [...new Set(dominios.map(d => d.replace(/^https?:\/\//, '')))];
        achados.push(`domínio(s) real(is) substituído(s) por placeholder: ${unicos.join(', ')}`);
        redigido = redigido.replace(PADRAO_DOMINIO_REAL, `https://${PLACEHOLDER_DOMINIO}`);
    }
    for (const setting of SETTINGS_SUSPEITOS) {
        const re = new RegExp(`name=['"]${setting}['"][^>]*>([^<]*)<`, 'g');
        for (const m of redigido.matchAll(re)) {
            if (m[1] && m[1].trim()) {
                achados.push(`⚠️ setting "${setting}" com valor não-vazio ("${m[1].trim()}") — revisar manualmente, NÃO stripado automaticamente (valor pode ser estrutural).`);
            }
        }
    }
    return { xml: redigido, achados };
}
