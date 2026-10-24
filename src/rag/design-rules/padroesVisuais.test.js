'use strict';

/**
 * Teste do loader de padrões visuais consultado por gerarPeca()
 * (geminiService.js) — garante que o digest carrega, não fica vazio, e
 * que cada regra do JSON aparece no texto formatado (nenhuma silenciosamente
 * cai fora por erro de campo).
 *
 * Execute: node src/rag/design-rules/padroesVisuais.test.js
 */

const { padroesVisuaisParaPrompt } = require('./padroesVisuais');
const dados = require('./padroes-visuais-comprovados.json');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

const digest = padroesVisuaisParaPrompt();

assert('digest não é vazio', typeof digest === 'string' && digest.length > 0);
assert('JSON tem pelo menos 1 regra', Array.isArray(dados.regras) && dados.regras.length > 0);

for (const regra of dados.regras) {
    assert(`regra "${regra.id}": título aparece no digest`, digest.includes(regra.titulo), regra.id);
    assert(`regra "${regra.id}": tem campo "evidencia" (nada é invenção sem origem)`,
        typeof regra.evidencia === 'string' && regra.evidencia.length > 0, regra.id);
}

assert('digest é 1 linha por regra (mesma contagem de "- ")',
    (digest.match(/^- /gm) || []).length === dados.regras.length);

console.log(`\n${failed === 0 ? '✅' : '❌'} padroesVisuais: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
