'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Importar o executor nao deve disparar o npm test nem finalizar o processo.
const { encontrarTestes } = require('../../scripts/runTests');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-test-runner-'));
function file(relative) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, '// fixture\n');
    return target;
}
try {
    const normal = file('foo.test.js');
    const nested = file('nested/deep/bar.test.js');
    file('other.js');
    file('nested/not-a-test.jsx');
    file('.hidden/ignore.test.js');
    file('node_modules/ignore.test.js');
    file('nested/node_modules/ignore.test.js');
    file('nested/.cache/ignore.test.js');
    assert.deepEqual(
        encontrarTestes(root).sort(),
        [normal, nested].sort(),
        'coletar somente *.test.js, inclusive nested; ignorar node_modules e dirs ocultos'
    );
    const collected = ['sentinel'];
    assert.strictEqual(encontrarTestes(root, collected), collected,
        'preservar array de saida recebido (contrato de recursao)');
    assert.equal(collected.length, 3);
    assert.equal(encontrarTestes(path.join(root, 'nested')).length, 1);
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ testRunner: import sem efeitos, recursao, exclusoes e arquivos corretos');
