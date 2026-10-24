import type { AchadoDiagnostico, CategoriaDiagnostico, DiagnosticoResultado } from '../../contracts/diagnostico';

declare function require(path: string): unknown;

interface ResultadosXml { erros: string[]; avisos: string[] }
interface ValidadoresXml {
    validarXmlCompilado(xml: string): string[];
    validarXmlEstrutura(xml: string): ResultadosXml;
    validarSemanticaBlogger(xml: string): ResultadosXml;
}

const { validarXmlCompilado, validarXmlEstrutura, validarSemanticaBlogger } = require('../xmlValidator') as ValidadoresXml;
const { repararXml } = require('../repairEngine') as typeof import('../repairEngine');
const { checarSeo } = require('./seoChecker') as { checarSeo(xml: string): AchadoDiagnostico[] };
const { checarAcessibilidade } = require('./acessibilidadeChecker') as typeof import('./acessibilidadeChecker');
const { checarResponsividade } = require('./responsividadeChecker') as typeof import('./responsividadeChecker');
const { calcularScore } = require('./score') as typeof import('./score');

// ──────────────────────────────────────────────────────────────────────────
// DIAGNÓSTICO INTELIGENTE — v1
//
// Roda um XML Blogger já compilado por TODAS as checagens estáticas que o
// sistema já tem (nenhuma chamada de rede, nenhuma chamada de IA):
//
//   1. XML — Sintaxe            → xmlValidator.validarXmlCompilado
//   2. Estrutura Blogger        → xmlValidator.validarXmlEstrutura
//   3. Semântica de Runtime     → xmlValidator.validarSemanticaBlogger
//   4. SEO                      → seoChecker
//   5. Acessibilidade           → acessibilidadeChecker
//   6. Responsividade           → responsividadeChecker
//
// v1 é restrito a templates GERADOS PELA SOFTLOAD (o XML vem do GCS, salvo
// no momento da compilação) — não busca nem audita o blog "ao vivo" no
// Blogger (exigiria integração com a Blogger API real, ausente hoje).
//
// "Corrigir Tudo" reaproveita repairEngine.repararXml() — o mesmo motor já
// usado no pipeline de compilação — em vez de reinventar correções. Não
// sobrescreve nada: devolve o XML corrigido pro caller decidir o que fazer
// (ex: oferecer download).
// ──────────────────────────────────────────────────────────────────────────

function _paraAchados(mensagens: readonly string[] | null | undefined, nivel: AchadoDiagnostico['nivel']): AchadoDiagnostico[] {
    return (mensagens || []).map(mensagem => ({ nivel, mensagem }));
}

/**
 * @param {string} xml — XML Blogger já compilado
 * @returns {{
 *   score: number,
 *   totalErros: number,
 *   totalAvisos: number,
 *   categorias: { id: string, nome: string, achados: { nivel: 'erro'|'aviso', mensagem: string }[] }[],
 *   corrigivelAutomaticamente: boolean,
 *   xmlCorrigido: string|null,
 *   reparosAplicados: object[],
 * }}
 */
export function gerarDiagnostico(xml: string): DiagnosticoResultado {
    const estrutura = validarXmlEstrutura(xml);
    const semantica = validarSemanticaBlogger(xml);

    const categorias: CategoriaDiagnostico[] = [
        {
            id: 'xml',
            nome: 'XML — Sintaxe',
            achados: _paraAchados(validarXmlCompilado(xml), 'erro'),
        },
        {
            id: 'estrutura',
            nome: 'Estrutura Blogger',
            achados: [..._paraAchados(estrutura.erros, 'erro'), ..._paraAchados(estrutura.avisos, 'aviso')],
        },
        {
            id: 'semantica',
            nome: 'Semântica de Runtime Blogger',
            achados: [..._paraAchados(semantica.erros, 'erro'), ..._paraAchados(semantica.avisos, 'aviso')],
        },
        { id: 'seo', nome: 'SEO', achados: checarSeo(xml) },
        { id: 'acessibilidade', nome: 'Acessibilidade', achados: checarAcessibilidade(xml) },
        { id: 'responsividade', nome: 'Responsividade', achados: checarResponsividade(xml) },
    ];

    const { score, totalErros, totalAvisos } = calcularScore(categorias);

    // "Corrigir Tudo" — mesmas 8 regras já usadas na compilação (& cru,
    // atributo booleano, whitespace unicode, b:loop="loop" corrompido...).
    // Não corrige achados de SEO/Acessibilidade/Responsividade (são
    // recomendações de conteúdo/design, não sintaxe quebrada) nem os erros
    // estruturais/semânticos mais profundos (Blog1 sem widget-settings etc.
    // exigem decisão de qual chassis usar, não um patch textual seguro).
    const { xml: xmlCorrigido, reparos, total } = repararXml(xml);

    return {
        score,
        totalErros,
        totalAvisos,
        categorias,
        corrigivelAutomaticamente: total > 0,
        xmlCorrigido: total > 0 ? xmlCorrigido : null,
        reparosAplicados: reparos,
    };
}

