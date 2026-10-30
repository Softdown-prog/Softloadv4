"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validarEscopoGlobal = validarEscopoGlobal;
const vm = require('vm');
// ============================================================
// JS WORKER — validação determinística de colisão de escopo
// global.
//
// Formaliza o padrão `new vm.Script(blocos.join('\n;\n'))` que
// era copiado em cada nichoDossie.*.test.js. Todo JS compilado no
// output final roda no mesmo escopo global (múltiplos <script> na
// mesma página) — duas peças declarando `const btnScroll` cada uma
// colidem em runtime (`Identifier 'x' has already been declared`)
// mesmo que cada bloco isolado seja sintaticamente válido. vm.Script
// compila no escopo de topo e detecta a colisão em tempo de parse,
// sem precisar executar o código.
// ============================================================
// ──────────────────────────────────────────────────────────────
// validarEscopoGlobal — recebe um bloco de JS ou array de blocos
// (peças distintas destinadas ao mesmo output) e confirma que,
// concatenados, não colidem em escopo global. Nunca lança —
// retorna { ok, erro }.
// ──────────────────────────────────────────────────────────────
function validarEscopoGlobal(blocosJs) {
    const blocos = (Array.isArray(blocosJs) ? blocosJs : [blocosJs]);
    const codigo = blocos.filter(b => typeof b === 'string' && b.trim()).join('\n;\n');
    if (!codigo.trim())
        return { ok: true, erro: '' };
    try {
        new vm.Script(codigo);
        return { ok: true, erro: '' };
    }
    catch (e) {
        return { ok: false, erro: e.message };
    }
}
