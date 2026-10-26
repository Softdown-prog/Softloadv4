'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const root = path.join(__dirname, '..');
function run(args) { return spawnSync(process.execPath, [path.join(root, 'cli.js'), ...args], { encoding: 'utf8', timeout: 10000, env: { PATH: process.env.PATH, NODE_ENV: 'test' } }); }

test('help remains executable and ping speaks real worker JSON without production services', () => {
    const help = run(['--help']); assert.equal(help.status, 0); assert.match(help.stdout, /Softload Engine CLI/);
    const ping = run(['worker:ping', '--json']); assert.equal(ping.status, 0);
    const data = JSON.parse(ping.stdout); assert.equal(data.status, 'alive'); assert.equal(data.comando, 'worker:ping'); assert.equal(data.flags.json, true); assert.equal(data.alvo, null);
});

test('unknown worker commands fail and a real memory diagnostic remains valid JSON', () => {
    const unknown = run(['unknown:command', '--json']); assert.equal(unknown.status, 1); assert.match(unknown.stderr, /Comando desconhecido/);
    const memory = run(['memoria:status', '--json']); assert.ok([0, 1].includes(memory.status));
    const data = JSON.parse(memory.stdout); assert.equal(typeof data.heap.percentual, 'number'); assert.equal(typeof data.ok, 'boolean'); assert.ok(data.heap.limiteMb > 0);
});

test('CLI preserves worker flags and reports fatal worker failures', () => {
    const writes = [], errors = [], workers = [];
    const processMock = { argv: ['node', 'cli.js', 'cliente:info', 'fake@example.test', '--n=3', '--json'], env: {}, stdout: { write: x => writes.push(x) },
        exit(code) { throw Object.assign(Error('fake exit'), { exitCode: code }); } };
    const worker = new EventEmitter();
    const context = { exports: {}, module: { exports: {} }, __dirname: root, process: processMock, console: { log() {}, error: x => errors.push(x) },
        require(id) {
            if (id === 'path') return path;
            if (id === 'fs') return { existsSync: () => true };
            if (id === 'dotenv') return { config() {} };
            if (id === 'worker_threads') return { Worker: class { constructor(filename, options) { workers.push({ filename, options }); return worker; } } };
            throw Error('Unexpected service: ' + id);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(root, 'cli.js'), 'utf8'), context);
    assert.equal(workers[0].options.workerData.alvo, 'fake@example.test'); assert.equal(workers[0].options.workerData.flags.n, '3'); assert.equal(workers[0].options.workerData.flags.json, true);
    worker.emit('message', { tipo: 'ok', json: true, dados: { ok: true } }); assert.equal(JSON.parse(writes[0]).ok, true);
    assert.throws(() => worker.emit('error', Error('fake worker crash')), error => error.exitCode === 1);
    assert.match(errors[0], /fake worker crash/);
});

test('retired root agent is absent and active agent/package entry points still exist', () => {
    assert.equal(fs.existsSync(path.join(root, 'agent.js')), false);
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'agent/package.json'), 'utf8'));
    assert.equal(pkg.main, 'src/index.js'); assert.equal(fs.existsSync(path.join(root, 'agent', pkg.main)), true);
    assert.ok(fs.readFileSync(path.join(root, 'agent/src/agent.ts'), 'utf8').includes('class Agent'));
    const rootPkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')); assert.equal(rootPkg.main, 'server.js');
});
