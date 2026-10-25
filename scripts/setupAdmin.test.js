'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

async function runAdmin(email, exists = true) {
    const state = { read: 0, writes: [], exits: [], logs: [], collection: null };
    const document = {
        async get() { state.read++; return { exists }; },
        async update(data) { state.writes.push(data); },
    };
    const sandbox = {
        __dirname: __dirname,
        process: {
            argv: ['node', 'setupAdmin.js', email],
            exit(code) { state.exits.push(code); },
        },
        console: {
            error(...parts) { state.logs.push(parts.join(' ')); },
            log(...parts) { state.logs.push(parts.join(' ')); },
        },
        require(id) {
            if (id === 'dotenv') return { config() {} };
            if (id === 'path') return path;
            if (id === '../src/services/firebase') return {
                db: { collection(name) {
                    state.collection = name;
                    return { doc(value) { state.email = value; return document; } };
                } },
            };
            throw new Error('Unexpected require: ' + id);
        },
        exports: {},
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'setupAdmin.js'), 'utf8'), sandbox, {
        filename: 'setupAdmin.js', timeout: 2000,
    });
    await new Promise(resolve => setImmediate(resolve));
    return state;
}

test('a promoção escreve apenas a flag super_admin no registro indicado', async () => {
    const s = await runAdmin(' Admin@Exemplo.com ');
    assert.equal(s.collection, 'clientes_premium');
    assert.equal(s.email, 'admin@exemplo.com');
    assert.equal(s.read, 1);
    assert.deepEqual(JSON.parse(JSON.stringify(s.writes)), [{ is_super_admin: true }]);
    assert.deepEqual(s.exits, [0]);
});

test('usuário não encontrado não recebe atualização', async () => {
    const s = await runAdmin('inexistente@example.com', false);
    assert.equal(s.read, 1);
    assert.equal(s.writes.length, 0);
    assert.deepEqual(s.exits, [1]);
});

test('falta de argumento impede a execução', async () => {
    let loaded = false;
    const sandbox = {
        __dirname: __dirname,
        process: { argv: ['node', 'setupAdmin.js'], exit(code) {
            assert.equal(code, 1);
            throw new Error('EXPECTED_EXIT');
        } },
        console: { error() {}, log() {} },
        exports: {},
        require(id) {
            if (id === 'dotenv') return { config() {} };
            if (id === 'path') return path;
            if (id === '../src/services/firebase') {
                loaded = true;
                return { db: { collection() { throw new Error('UNEXPECTED_DB'); } } };
            }
            throw new Error('Unexpected require: ' + id);
        },
    };
    assert.throws(() => vm.runInNewContext(
        fs.readFileSync(path.join(__dirname, 'setupAdmin.js'), 'utf8'),
        sandbox, { timeout: 2000 },
    ), /EXPECTED_EXIT/);
});
