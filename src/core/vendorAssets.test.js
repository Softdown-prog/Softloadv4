'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASSETS, vendorizarAssets, verificarAssetsVendorizados } = require('../../scripts/vendorAssets');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-vendor-'));
const oldLog = console.log;
const oldError = console.error;
const logs = [];
const errors = [];
console.log = (...args) => logs.push(args.join(' '));
console.error = (...args) => errors.push(args.join(' '));
try {
    assert.equal(ASSETS.length, 3, 'preservar a lista Bootstrap CSS/JS e Chart.js');
    assert.deepEqual(ASSETS.map(a => a.dest), [
        'vendor/bootstrap/css/bootstrap.min.css',
        'vendor/bootstrap/js/bootstrap.bundle.min.js',
        'vendor/chart.js/chart.umd.min.js',
    ]);
    const original = new Map();
    for (const [i, asset] of ASSETS.entries()) {
        const buffer = Buffer.from([0, 255, 42, i, 10, 13]);
        const absolute = path.join(root, asset.src);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.writeFileSync(absolute, buffer);
        original.set(asset.dest, buffer);
    }
    assert.equal(vendorizarAssets(root), true, 'as três fontes presentes devem copiar com sucesso');
    for (const asset of ASSETS) {
        const generated = fs.readFileSync(path.join(root, 'public', asset.dest));
        assert.deepEqual(generated, original.get(asset.dest), 'bytes binários devem ser preservados: ' + asset.dest);
    }
    assert.equal(logs.length, ASSETS.length, 'um log por cópia concluída');
    assert.deepEqual(errors, []);
    assert.equal(verificarAssetsVendorizados(root), true, 'public/vendor deve coincidir byte a byte com node_modules');

    // Uma alteração de mesmo tamanho não pode passar apenas por comparação de size.
    const first = ASSETS[0];
    const target = path.join(root, 'public', first.dest);
    const modified = Buffer.from(original.get(first.dest));
    modified[0] ^= 0xff;
    fs.writeFileSync(target, modified);
    assert.equal(verificarAssetsVendorizados(root), false, 'conteúdo adulterado deve falhar');
    assert.ok(errors.some(e => e.includes(first.dest)), 'erro aponta o arquivo adulterado');
    assert.deepEqual(fs.readFileSync(target), modified, 'modo --verify é somente leitura');
    fs.copyFileSync(path.join(root, first.src), target);
    assert.equal(verificarAssetsVendorizados(root), true, 'arquivo restaurado volta a passar');

    fs.rmSync(target);
    assert.equal(verificarAssetsVendorizados(root), false, 'saída ausente deve falhar');
    assert.ok(errors.some(e => e.includes('Arquivo publicado ausente')));
    assert.equal(vendorizarAssets(root), true, 'cópia permite restaurar artefato ausente');

    const last = ASSETS[2];
    fs.writeFileSync(path.join(root, last.src), Buffer.alloc(0));
    assert.equal(verificarAssetsVendorizados(root), false, 'dependência vazia deve falhar');
    fs.writeFileSync(path.join(root, last.src), original.get(last.dest));
    assert.equal(verificarAssetsVendorizados(root), true, 'recuperação após arquivo vazio');

    const missing = ASSETS[1];
    fs.rmSync(path.join(root, missing.src));
    const preserved = fs.readFileSync(path.join(root, 'public', missing.dest));
    assert.equal(vendorizarAssets(root), false, 'a ausência de uma dependência deve falhar');
    assert.ok(errors.some(e => e.includes(missing.src)), 'falha deve identificar a fonte ausente');
    assert.deepEqual(fs.readFileSync(path.join(root, 'public', missing.dest)), preserved,
        'uma cópia ausente não deve truncar arquivo anterior');
    assert.deepEqual(fs.readFileSync(path.join(root, 'public', ASSETS[0].dest)), original.get(ASSETS[0].dest),
        'outras cópias continuam ocorrendo');
    assert.equal(verificarAssetsVendorizados(root), false, 'verificação também falha sem fonte');
} finally {
    console.log = oldLog;
    console.error = oldError;
    fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ vendorAssets: cópia e integridade byte a byte, alterações, fontes vazias e ausentes');
