'use strict';

/**
 * Testes de solarisGenerationTrigger.js — puro parsing de string, sem
 * mocks nem I/O.
 *
 * Execute: node src/solaris/chat/solarisGenerationTrigger.test.js
 */

const { detectarMarcador, removerMarcadorTruncado } = require('./solarisGenerationTrigger');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. texto sem marcador nenhum retorna null.
    {
        const r = detectarMarcador('Perfeito, vamos montar sua landing page! Qual framework você prefere?');
        assert('sem marcador: retorna null', r === null);
    }

    // B. marcador bem formado no fim do texto — extrai objetivo/framework,
    // remove o marcador do texto visível.
    {
        const texto = 'Perfeito! Gerando seu projeto agora... [[SOLARIS_GERAR:{"objetivo":"Landing page de SaaS com hero, pricing e FAQ, estilo glassmorphism","framework":"flask"}]]';
        const r = detectarMarcador(texto);
        assert('marcador bem formado: não é null', r !== null);
        assert('marcador bem formado: sem erro', r && r.erro === null);
        assert('marcador bem formado: objetivo extraído', r && r.objetivo === 'Landing page de SaaS com hero, pricing e FAQ, estilo glassmorphism');
        assert('marcador bem formado: framework extraído', r && r.framework === 'flask');
        assert('marcador bem formado: textoVisivel não contém o marcador', r && !r.textoVisivel.includes('SOLARIS_GERAR'));
        assert('marcador bem formado: textoVisivel preserva o texto de confirmação', r && r.textoVisivel === 'Perfeito! Gerando seu projeto agora...');
    }

    // C. marcador com JSON inválido — erro explícito, não lança.
    {
        const texto = 'Confirmado! [[SOLARIS_GERAR:{objetivo sem aspas}]]';
        let lancou = false;
        let r = null;
        try { r = detectarMarcador(texto); } catch (_) { lancou = true; }
        assert('JSON inválido: não lança', !lancou);
        assert('JSON inválido: erro preenchido', r && typeof r.erro === 'string' && r.erro.length > 0);
        assert('JSON inválido: objetivo/framework null', r && r.objetivo === null && r.framework === null);
    }

    // D. marcador com campo faltando (framework ausente) — erro explícito.
    {
        const texto = 'Confirmado! [[SOLARIS_GERAR:{"objetivo":"um blog qualquer"}]]';
        const r = detectarMarcador(texto);
        assert('framework ausente: erro preenchido', r && r.erro && r.erro.includes('objetivo'));
    }

    // E. marcador com objetivo/framework vazios (string em branco) — erro explícito.
    {
        const texto = '[[SOLARIS_GERAR:{"objetivo":"   ","framework":"flask"}]]';
        const r = detectarMarcador(texto);
        assert('objetivo em branco: erro preenchido', r && r.erro !== null);
    }

    // F. entrada vazia/inválida não lança, retorna null.
    {
        assert('detectarMarcador("") retorna null', detectarMarcador('') === null);
        assert('detectarMarcador(null) retorna null', detectarMarcador(null) === null);
        assert('detectarMarcador(undefined) retorna null', detectarMarcador(undefined) === null);
    }

    // G. removerMarcadorTruncado — marcador nunca fechado (streaming cortado
    // no meio) some do texto, sem lançar.
    {
        const texto = 'Perfeito! Gerando... [[SOLARIS_GERAR:{"objetivo":"um saas qualqu';
        const r = removerMarcadorTruncado(texto);
        assert('marcador truncado removido', r === 'Perfeito! Gerando...');
        assert('marcador truncado: nada de SOLARIS_GERAR sobra', !r.includes('SOLARIS_GERAR'));
    }

    // H. removerMarcadorTruncado — texto sem nenhum marcador não é alterado.
    {
        const texto = 'Qual framework você prefere: HTML5, Bootstrap 5 ou Flask?';
        assert('sem marcador: texto intacto', removerMarcadorTruncado(texto) === texto);
    }

    // I. removerMarcadorTruncado — marcador bem fechado também é removido
    // (mesmo comportamento — só o "truncado" é o caso extra que ele cobre).
    {
        const texto = 'Confirmado! [[SOLARIS_GERAR:{"objetivo":"x","framework":"php"}]]';
        assert('marcador fechado também é removido', removerMarcadorTruncado(texto) === 'Confirmado!');
    }

    // J. removerMarcadorTruncado com entrada vazia/inválida não lança.
    {
        assert('removerMarcadorTruncado("") não lança', removerMarcadorTruncado('') === '');
        assert('removerMarcadorTruncado(null) não lança', removerMarcadorTruncado(null) === null);
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} solarisGenerationTrigger: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
