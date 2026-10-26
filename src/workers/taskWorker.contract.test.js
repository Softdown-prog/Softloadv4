'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const path = require('node:path');

// Run the real CommonJS worker in a separate thread. Any attempt to load
// production Firebase services fails locally before a network connection.
function runWorker(data) {
    return new Promise((resolve, reject) => {
        const worker = new Worker(`
            const { parentPort } = require('node:worker_threads');
            const send = parentPort.postMessage.bind(parentPort);
            parentPort.postMessage = message => send({ ...message, observedEnvironment: {
                text: process.env.SOFTLOAD_WORKER_TEST,
                number: process.env.SOFTLOAD_WORKER_NUMBER,
                ignored: process.env.SOFTLOAD_WORKER_IGNORED,
            } });
            const Module = require('node:module');
            const original = Module.prototype.require;
            Module.prototype.require = function(id) {
                if (id === '../services/firebase') throw Error('Production services forbidden in worker smoke');
                return original.call(this, id);
            };
            require(${JSON.stringify(path.join(__dirname, 'taskWorker.js'))});
        `, { eval: true, workerData: data });
        const messages = [];
        const timer = setTimeout(() => { worker.terminate(); reject(Error('Worker timeout')); }, 5000);
        worker.on('message', message => messages.push(message));
        worker.once('error', error => { clearTimeout(timer); reject(error); });
        worker.once('exit', code => { clearTimeout(timer); resolve({ code, messages }); });
    });
}

test('CLI ping returns serializable JSON and leaves credentials/services unloaded', async () => {
    const result = await runWorker({ comando: 'worker:ping', flags: { n: '2' }, modoJson: true,
        env: { SOFTLOAD_WORKER_TEST: 'smoke', SOFTLOAD_WORKER_NUMBER: 3, SOFTLOAD_WORKER_IGNORED: { nested: true } } });
    assert.equal(result.code, 0);
    assert.equal(result.messages.length, 1);
    assert.equal(result.messages[0].json, true);
    assert.equal(result.messages[0].dados.status, 'alive');
    assert.deepEqual(result.messages[0].dados.flags, { n: '2' });
    assert.equal(result.messages[0].dados.alvo, null);
    assert.equal(result.messages[0].observedEnvironment.text, 'smoke');
    assert.equal(result.messages[0].observedEnvironment.number, '3');
    assert.equal(result.messages[0].observedEnvironment.ignored, undefined);
});

test('destructive command without --force exits before loading Firebase', async () => {
    const result = await runWorker({ comando: 'cliente:deletar', alvo: 'fake@example.test', flags: {} });
    assert.equal(result.code, 1);
    assert.equal(result.messages[0].tipo, 'erro');
    assert.match(result.messages[0].texto, /--force/);
    assert.equal(result.messages.length, 1);
});

test('invalid email and unknown command preserve CLI error messages and nonzero exits', async () => {
    for (const [data, pattern] of [
        [{ comando: 'cliente:info', alvo: 'invalid', flags: {} }, /E-mail inválido/],
        [{ comando: 'unrecognized:command', flags: {} }, /Comando desconhecido/],
    ]) {
        const result = await runWorker(data);
        assert.equal(result.code, 1);
        assert.equal(result.messages[0].tipo, 'erro');
        assert.match(result.messages[0].texto, pattern);
    }
});
