'use strict';

/**
 * Testes para src/core/diagnostico/index.js (gerarDiagnostico) e score.js
 * Execute: node src/core/diagnostico/index.test.js
 */

const { gerarDiagnostico } = require('./index');
const { calcularScore }    = require('./score');
const { executarCompilacao } = require('../compilerWorker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// ── calcularScore — matemática pura ─────────────────────────────────────
{
    const limpo = calcularScore([{ id: 'x', nome: 'X', achados: [] }]);
    assert('sem achados = score 100', limpo.score === 100);
    assert('sem achados = 0 erros e 0 avisos', limpo.totalErros === 0 && limpo.totalAvisos === 0);
}
{
    const r = calcularScore([
        { id: 'a', nome: 'A', achados: [{ nivel: 'erro', mensagem: 'x' }] },
        { id: 'b', nome: 'B', achados: [{ nivel: 'aviso', mensagem: 'y' }, { nivel: 'aviso', mensagem: 'z' }] },
    ]);
    assert('1 erro (-15) + 2 avisos (-4 cada) = 100-15-8 = 77', r.score === 77, `score=${r.score}`);
    assert('totalErros=1', r.totalErros === 1);
    assert('totalAvisos=2', r.totalAvisos === 2);
}
{
    const muitosErros = calcularScore([
        { id: 'a', nome: 'A', achados: Array.from({ length: 10 }, () => ({ nivel: 'erro', mensagem: 'x' })) },
    ]);
    assert('score nunca fica negativo (cap em 0)', muitosErros.score === 0);
}

// ── gerarDiagnostico — fim a fim com um template real compilado ────────────
(() => {
    const r = executarCompilacao({
        siteName: 'Diagnóstico Teste', nichoTema: 'gamer-playerone', colorPreset: 'tech-blue',
        typography: 'inter', buttonStyle: 'default', gridLayout: 'revista',
        enableSeo: true, lazyLoad: true, categoryBadges: [],
        modules: { darkMode: true, mobileMenuType: 'offcanvas' },
    });

    const diag = gerarDiagnostico(r.xmlFinal);

    assert('score é um número entre 0 e 100', typeof diag.score === 'number' && diag.score >= 0 && diag.score <= 100);
    assert('retorna as 6 categorias esperadas',
        diag.categorias.length === 6 && diag.categorias.every(c => c.id && c.nome && Array.isArray(c.achados)));
    assert('categorias na ordem: xml, estrutura, semantica, seo, acessibilidade, responsividade',
        diag.categorias.map(c => c.id).join(',') === 'xml,estrutura,semantica,seo,acessibilidade,responsividade');
    assert('totalErros/totalAvisos batem com a soma das categorias',
        diag.totalErros === diag.categorias.flatMap(c => c.achados).filter(a => a.nivel === 'erro').length &&
        diag.totalAvisos === diag.categorias.flatMap(c => c.achados).filter(a => a.nivel === 'aviso').length);

    assert('corrigivelAutomaticamente é boolean', typeof diag.corrigivelAutomaticamente === 'boolean');
    assert('xmlCorrigido é null quando não há nada pra reparar, ou string quando há',
        diag.xmlCorrigido === null || typeof diag.xmlCorrigido === 'string');
    if (diag.corrigivelAutomaticamente) {
        assert('quando corrigivel, xmlCorrigido não é null', diag.xmlCorrigido !== null);
    } else {
        assert('quando NÃO corrigivel, xmlCorrigido é null', diag.xmlCorrigido === null);
    }
    assert('reparosAplicados é array', Array.isArray(diag.reparosAplicados));
})();

// ── XML propositalmente quebrado dispara a categoria xml/estrutura ─────────
{
    const quebrado = "<html><body><b:loop=\"loop\" var='p' values='data:posts'></b:loop></body></html>";
    const diag = gerarDiagnostico(quebrado);
    const catXml = diag.categorias.find(c => c.id === 'xml');
    assert('XML com b:loop="loop" corrompido aparece na categoria xml', catXml.achados.length > 0);
    assert('score cai bem abaixo de 100 com erro bloqueante', diag.score < 100);
}

// ── achado de SEO/Acessibilidade/Responsividade chega intacto no relatório ──
{
    const semNada = '<html><head></head><body></body></html>'; // sem title, viewport, alt (n/a), lang
    const diag = gerarDiagnostico(semNada);
    assert('categoria seo recebe o achado de <title> ausente',
        diag.categorias.find(c => c.id === 'seo').achados.some(a => a.mensagem.includes('title')));
    assert('categoria acessibilidade recebe o achado de lang ausente',
        diag.categorias.find(c => c.id === 'acessibilidade').achados.some(a => a.mensagem.includes('lang')));
    assert('categoria responsividade recebe o achado de viewport ausente',
        diag.categorias.find(c => c.id === 'responsividade').achados.some(a => a.mensagem.includes('viewport')));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} diagnostico/index: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
