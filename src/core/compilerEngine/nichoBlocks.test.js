'use strict';

/**
 * Testes de nichoBlocks — foco em _escolherVariantePeca() e sua integração
 * em montarNichoDeDossie() (mecanismo htmlVariantes/cssVariantes).
 *
 * Execute: node src/core/compilerEngine/nichoBlocks.test.js
 */

const { _escolherVariantePeca, montarNichoDeDossie } = require('./nichoBlocks');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

// A. Sem campo de variantes → cai no valorPadrao.
{
    const peca = { id: 'p1' };
    const r = _escolherVariantePeca('seed-x', peca, 'cssVariantes', '.padrao{}');
    assert('sem variantes: retorna valorPadrao', r === '.padrao{}');
}

// B. Campo de variantes vazio → cai no valorPadrao.
{
    const peca = { id: 'p1', cssVariantes: [] };
    const r = _escolherVariantePeca('seed-x', peca, 'cssVariantes', '.padrao{}');
    assert('variantes vazio: retorna valorPadrao', r === '.padrao{}');
}

// C. Array com 1 item → retorna esse item direto (sem hashSeed).
{
    const peca = { id: 'p1', cssVariantes: ['.unica{}'] };
    const r = _escolherVariantePeca('seed-x', peca, 'cssVariantes', '.padrao{}');
    assert('1 variante: retorna a única variante', r === '.unica{}');
}

// D. Mesmo seed + mesma peça → mesma variante escolhida sempre (determinístico).
{
    const peca = { id: 'p1', cssVariantes: ['.a{}', '.b{}', '.c{}', '.d{}', '.e{}'] };
    const r1 = _escolherVariantePeca('Site Alpha', peca, 'cssVariantes', '.padrao{}');
    const r2 = _escolherVariantePeca('Site Alpha', peca, 'cssVariantes', '.padrao{}');
    assert('mesmo seed: resultado idêntico', r1 === r2, `${r1} !== ${r2}`);
}

// E. Seeds diferentes tendem a escolher variantes diferentes (varredura ampla).
{
    const peca = { id: 'p1', cssVariantes: ['.a{}', '.b{}', '.c{}', '.d{}', '.e{}'] };
    const escolhidas = new Set();
    for (let i = 0; i < 30; i++) {
        escolhidas.add(_escolherVariantePeca(`Site Teste ${i}`, peca, 'cssVariantes', '.padrao{}'));
    }
    assert('seeds diferentes: mais de 1 variante distinta em 30 amostras', escolhidas.size > 1, `só viu ${escolhidas.size}`);
}

// F. peca.id diferente muda o hash mesmo com o mesmo seed (não colide entre peças).
{
    const pecaA = { id: 'peca-a', cssVariantes: ['.a0{}', '.a1{}', '.a2{}', '.a3{}', '.a4{}', '.a5{}', '.a6{}', '.a7{}'] };
    const pecaB = { id: 'peca-b', cssVariantes: ['.b0{}', '.b1{}', '.b2{}', '.b3{}', '.b4{}', '.b5{}', '.b6{}', '.b7{}'] };
    const rA = _escolherVariantePeca('mesmo-seed', pecaA, 'cssVariantes', null);
    const rB = _escolherVariantePeca('mesmo-seed', pecaB, 'cssVariantes', null);
    assert('id da peça entra no hash', rA.startsWith('.a') && rB.startsWith('.b'));
}

// G. htmlVariantes e cssVariantes da MESMA peça, mesmo seed → mesmo índice
//    (ambos usam peca.id na chave do hash, então ficam sincronizados).
{
    const peca = {
        id: 'hero-x',
        htmlVariantes: ['<div>H0</div>', '<div>H1</div>', '<div>H2</div>'],
        cssVariantes: ['.c0{}', '.c1{}', '.c2{}'],
    };
    for (const seed of ['Loja A', 'Loja B', 'App C', 'X']) {
        const html = _escolherVariantePeca(seed, peca, 'htmlVariantes', '');
        const css = _escolherVariantePeca(seed, peca, 'cssVariantes', '');
        const idxHtml = peca.htmlVariantes.indexOf(html);
        const idxCss = peca.cssVariantes.indexOf(css);
        assert(`html/css sincronizados p/ seed "${seed}"`, idxHtml === idxCss, `html=${idxHtml} css=${idxCss}`);
    }
}

// H. Integração real via montarNichoDeDossie: peça com cssVariantes é
//    escolhida (não é sempre a variante 0), e o css final contém exatamente
//    uma das variantes (nunca a concatenação de todas).
{
    const dossie = {
        nicho: 'nicho-teste-variantes',
        versaoDossie: 1,
        chassis: 'blog',
        pageType: 'blog-padrao',
        tokensCss: { light_mode: {}, dark_mode: {} },
        pecas: [
            {
                id: 'modulo-variavel',
                tipo: 'modulo',
                protegida: false,
                domIds: [],
                css: '.v0{cor:red}',
                cssVariantes: ['.v0{cor:red}', '.v1{cor:blue}', '.v2{cor:green}', '.v3{cor:pink}', '.v4{cor:purple}'],
                html: '',
                js: '',
            },
        ],
    };

    const vistos = new Set();
    for (let i = 0; i < 20; i++) {
        const { css } = montarNichoDeDossie(dossie, `Loja Numero ${i}`);
        const variante = dossie.pecas[0].cssVariantes.find(v => css.includes(v));
        assert(`montarNichoDeDossie inclui exatamente 1 variante (iter ${i})`, !!variante);
        const outras = dossie.pecas[0].cssVariantes.filter(v => v !== variante && css.includes(v));
        assert(`montarNichoDeDossie não concatena outras variantes (iter ${i})`, outras.length === 0);
        if (variante) vistos.add(variante);
    }
    assert('montarNichoDeDossie: mais de 1 variante vista em 20 seeds', vistos.size > 1, `só viu ${vistos.size}`);
}

// I. Peça SEM campo de variantes continua usando peca.css/peca.html direto
//    (compatibilidade — os outros 14 nichos não têm htmlVariantes/cssVariantes).
{
    const dossie = {
        nicho: 'nicho-teste-sem-variantes',
        versaoDossie: 1,
        chassis: 'blog',
        pageType: 'blog-padrao',
        tokensCss: { light_mode: {}, dark_mode: {} },
        pecas: [
            { id: 'modulo-fixo', tipo: 'modulo', protegida: false, domIds: [], css: '.fixo{cor:black}', html: '', js: '' },
        ],
    };
    const { css: css1 } = montarNichoDeDossie(dossie, 'Seed Um');
    const { css: css2 } = montarNichoDeDossie(dossie, 'Seed Dois Completamente Diferente');
    assert('sem variantes: css idêntico entre seeds diferentes', css1 === css2);
    assert('sem variantes: css contém a peça original', css1.includes('.fixo{cor:black}'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} nichoBlocks: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
