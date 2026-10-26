'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');
const realForge = require('./index.cjs');

test('recipe validation preserves command, contract, provider and complexity limits', () => {
    assert.throws(() => realForge.validateTask({ id: '../bad', command: 'html5-runtime' }), /id inválido/);
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'exec' }), /não permitido/);
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'draw-graph', recipeId: 'x', recipe: {} }), /recipeId OU/);
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'draw-graph', recipe: { contract: 'bad' } }), /Contrato incompatível/);
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'draw-graph', recipe: { contract: 'CH_2D_GRAPH_RECIPE_V1', canvas: [2048, 1] } }), /1024/);
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'audio-synth', recipe: { contract: 'CH_AUDIO_GENERATION_V1', provider: { type: 'external' } } }), /não habilitado/);
    const recipe = { contract: 'CH_2D_GRAPH_RECIPE_V1', canvas: [64, 64] };
    const validated = realForge.validateTask({ id: 'a', command: 'draw-graph', recipe });
    assert.notEqual(validated.recipe, recipe); assert.deepEqual(validated.recipe.canvas, [64, 64]);
    assert.equal(realForge.validateTask({ id: 'runtime', command: 'html5-runtime' }).command, 'html5-runtime');
    let deep = {}, cursor = deep; for (let i = 0; i < 45; i++) cursor = cursor.child = {};
    assert.throws(() => realForge.validateTask({ id: 'a', command: 'draw-graph', recipe: { contract: 'CH_2D_GRAPH_RECIPE_V1', deep } }), /complexidade/);
});

test('paths reject traversal, absolute paths, separators, symlink escapes and exported symlinks', () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-path-test-'));
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-outside-test-'));
    try {
        for (const relative of ['../outside', '/tmp/outside', 'x\\y', 'x\0y']) assert.throws(() => realForge.safePath(base, relative));
        fs.symlinkSync(outside, path.join(base, 'escape'));
        assert.throws(() => realForge.safePath(base, 'escape/x'), /Symlink/);
        assert.throws(() => realForge.filesIn(base), /symlinks/);
    } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true }); }
});

test('runtime publishes an immutable bundle with hashes and provenance and cleans temporary jobs', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-runtime-test-'));
    const jobs = [], fakeFs = { ...fs, mkdtempSync(prefix) { const dir = fs.mkdtempSync(prefix); if (prefix.includes('solaris-forge-')) jobs.push(dir); return dir; } };
    const source = fs.readFileSync(path.join(__dirname, 'index.cjs'), 'utf8'), mod = { exports: {} };
    vm.runInNewContext(source, { module: mod, exports: mod.exports, Buffer, process: { env: {} }, structuredClone, setTimeout, clearTimeout,
        require(id) {
            if (id === 'node:fs') return fakeFs;
            if (id === 'node:path') return path;
            if (id === 'node:os') return os;
            if (id === 'node:crypto') return crypto;
            if (id === 'node:child_process') return { spawn() { throw Error('Python forbidden in runtime-copy test'); } };
            if (id === './catalog.cjs') return require('./catalog.cjs');
            throw Error(id);
        },
    });
    try {
        const result = await mod.exports.render({ id: 'runtime-test', command: 'html5-runtime' }, { baseDir: base });
        assert.equal(result.ok, true); assert.equal(result.reviewRequired, true); assert.ok(result.api.includes('runtime'));
        const provenance = JSON.parse(fs.readFileSync(path.join(base, 'assets/runtime-test/solaris-asset.json'), 'utf8'));
        assert.equal(provenance.artApproved, false); assert.equal(provenance.runtimePromotion, false);
        for (const file of provenance.files) assert.equal(file.sha256, crypto.createHash('sha256').update(fs.readFileSync(path.join(base, file.caminho))).digest('hex'));
        await assert.rejects(() => mod.exports.render({ id: 'runtime-test', command: 'html5-runtime' }, { baseDir: base }), /já existe/);
        assert.ok(jobs.every(dir => !fs.existsSync(dir)));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('renderer passes only allowlisted environment and JSON over stdin, reports errors and cleans jobs', async () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-child-test-')), jobs = [], calls = [];
    const fakeFs = { ...fs, mkdtempSync(prefix) { const dir = fs.mkdtempSync(prefix); if (prefix.includes('solaris-forge-')) jobs.push(dir); return dir; } };
    const mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'index.cjs'), 'utf8'), { module: mod, exports: mod.exports, Buffer, structuredClone, setTimeout, clearTimeout,
        process: { env: { PATH: '/fake-bin', SOLARIS_FORGE_PYTHON: 'fake-python', PRIVATE_KEY: 'must-not-forward' } },
        require(id) {
            if (id === 'node:fs') return fakeFs;
            if (id === 'node:path') return path;
            if (id === 'node:os') return os;
            if (id === 'node:crypto') return crypto;
            if (id === './catalog.cjs') return require('./catalog.cjs');
            if (id === 'node:child_process') return { spawn(binary, args, options) {
                calls.push({ binary, args, options });
                const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter(); child.kill = () => {};
                child.stdin.end = content => { calls[0].input = JSON.parse(content); queueMicrotask(() => { child.stderr.emit('data', Buffer.from('fake rendering error')); child.emit('close', 2); }); };
                return child;
            } };
            throw Error(id);
        },
    });
    try {
        await assert.rejects(() => mod.exports.render({ id: 'x', command: 'draw-graph', recipe: { contract: 'CH_2D_GRAPH_RECIPE_V1' } }, { baseDir: base }), /Forge falhou \(2\)/);
        assert.equal(calls[0].binary, 'fake-python'); assert.equal(calls[0].options.shell, false);
        assert.equal(calls[0].options.env.PRIVATE_KEY, undefined); assert.equal(calls[0].input.command, 'draw-graph');
        assert.ok(jobs.every(dir => !fs.existsSync(dir)));
    } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('CommonJS API stays compatible with the agent ESM default import', async () => {
    const imported = await import('./index.cjs');
    assert.equal(imported.default, realForge);
    assert.deepEqual(Object.keys(realForge).sort(), ['catalog', 'filesIn', 'readRecipe', 'render', 'safePath', 'validateTask']);
});
