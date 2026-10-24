'use strict';

// Golden regression: the TypeScript migration must not silently edit Solaris's
// live system instructions. Update the fingerprint only for an intentional
// prompt change reviewed independently from the language migration.
const assert = require('node:assert/strict');
const { SOLARIS_SYSTEM_PROMPT } = require('./systemPrompt');
const { FRAMEWORKS_VALIDOS } = require('../manifest/manifestSchema');

function fingerprint(value) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < value.length; i++) {
        hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

assert.equal(typeof SOLARIS_SYSTEM_PROMPT, 'string');
assert.equal(fingerprint(SOLARIS_SYSTEM_PROMPT), '057ab246', 'O prompt efetivo do Solaris mudou (golden UTF-16 FNV-1a).');
assert.ok(SOLARIS_SYSTEM_PROMPT.includes(FRAMEWORKS_VALIDOS.join(', ')), 'Frameworks válidos devem vir do manifesto tipado.');
assert.ok(SOLARIS_SYSTEM_PROMPT.includes('[[SOLARIS_GERAR:'), 'Gatilho de geração precisa continuar documentado.');
assert.ok(SOLARIS_SYSTEM_PROMPT.includes('Nenhum jogo existente foi importado.'), 'Limites do Forge devem continuar explícitos.');
console.log('✅ Solaris systemPrompt: contrato e fingerprint preservados');
