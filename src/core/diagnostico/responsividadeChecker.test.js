'use strict';

/**
 * Testes para responsividadeChecker.js
 * Execute: node src/core/diagnostico/responsividadeChecker.test.js
 */

const { checarResponsividade } = require('./responsividadeChecker');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function tem(achados, trecho) {
    return achados.some(a => a.mensagem.includes(trecho));
}

{
    const semViewport = '<html><head></head></html>';
    const r = checarResponsividade(semViewport);
    assert('sem meta viewport é erro', r.some(a => a.nivel === 'erro' && a.mensagem.includes('viewport')));
}
{
    const viewportSemDeviceWidth = "<meta content='initial-scale=1.0' name='viewport'/>";
    const r = checarResponsividade(viewportSemDeviceWidth);
    assert('viewport presente mas sem width=device-width é aviso',
        r.some(a => a.nivel === 'aviso' && a.mensagem.includes('device-width')));
}
{
    const viewportOk = "<meta content='width=device-width, initial-scale=1.0' name='viewport'/>";
    assert('viewport completo não gera achado de viewport',
        !tem(checarResponsividade(viewportOk), 'viewport'));
}
{
    const semMediaQuery = "<meta content='width=device-width' name='viewport'/><style>.a{color:red;}</style>";
    assert('CSS sem nenhuma @media é aviso', tem(checarResponsividade(semMediaQuery), '@media'));
}
{
    const comMediaQuery = "<meta content='width=device-width' name='viewport'/><style>@media (max-width:768px){.a{color:red;}}</style>";
    assert('CSS com @media não gera achado de media query', !tem(checarResponsividade(comMediaQuery), '@media'));
}

console.log(`\n${failed === 0 ? '✅' : '❌'} responsividadeChecker: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
