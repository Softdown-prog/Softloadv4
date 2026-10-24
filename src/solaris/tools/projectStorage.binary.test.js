'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Module = require('node:module');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

test('GCS save/reload and quota preserve image/audio bytes exactly', async () => {
    const objects = new Map();
    let reserved, tracked;
    const original = Module._load;
    Module._load = function(name, ...args) {
        if (name === '../../services/firebase') return {
            bucket: {
                file(key) { return {
                    async save(bytes) { objects.set(key, Buffer.from(bytes)); },
                    async download() {
                        if (!objects.has(key)) throw Object.assign(Error('No such object'), { code: 404 });
                        return [objects.get(key)];
                    },
                }; },
                async deleteFiles({ prefix }) {
                    for (const key of objects.keys()) if (key.startsWith(prefix)) objects.delete(key);
                },
            },
            db: { collection() { return { doc() { return {
                async get() { return { exists: false, data() { return null; } }; },
                async set(value) { tracked = value; },
                async delete() { tracked = null; },
            }; } }; } },
        };
        if (name === '../../services/storageService') return { async reservarCota(email, plan, bytes) { reserved = bytes; return { async confirmarUso(actual) { assert.equal(actual, bytes); } }; } };
        return original.call(this, name, ...args);
    };
    let storage;
    try { storage = require('./projectStorage'); } finally { Module._load = original; }
    const { lerProjetoParaPersistir, lerArquivo, criarZip } = require('./fileTools');
    const base = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-storage-'));
    const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'forge-storage-'));
    const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 255, 128]);
    const audio = Buffer.from([79, 103, 103, 83, 0, 255, 254, 1]);
    try {
        fs.writeFileSync(path.join(base, 'sprite.png'), png); fs.writeFileSync(path.join(base, 'click.ogg'), audio); fs.writeFileSync(path.join(base, 'index.html'), '<canvas></canvas>');
        const saved = await storage.salvarProjeto({ uid: 'user', email: 'x@example.test', plano: 'free', sessionId: 'test', framework: 'html5', arquivos: lerProjetoParaPersistir(base) });
        assert.equal(saved.tamanhoBytes, reserved); assert.equal(tracked.tamanhoBytes, reserved);
        assert.equal(reserved, [...objects.values()].reduce((sum, b) => sum + b.length, 0));
        await storage.carregarProjeto('user', 'test', dest);
        assert.deepEqual(fs.readFileSync(path.join(dest, 'sprite.png')), png);
        assert.deepEqual(fs.readFileSync(path.join(dest, 'click.ogg')), audio);
        assert.equal(lerArquivo(dest, 'sprite.png').binario, true);
        assert.equal(lerArquivo(dest, 'index.html').conteudo, '<canvas></canvas>');
        assert.ok((await criarZip(dest)).length > png.length + audio.length);
    } finally { fs.rmSync(base, { recursive: true, force: true }); fs.rmSync(dest, { recursive: true, force: true }); }
});
