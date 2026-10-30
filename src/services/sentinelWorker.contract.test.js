'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function fixture() {
    const state = { failDb: false, timeout: false, destroyed: 0, memoryRatio: 0.1, interval: null, cleared: null };
    const calls = [], mod = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'sentinelWorker.js'), 'utf8'), {
        module: mod, exports: mod.exports, console: { log() {} },
        process: { env: { PORT: '9090' }, pid: 10, version: 'v22.fixture', uptime: () => 7200,
            memoryUsage: () => ({ heapUsed: 1000 * state.memoryRatio, heapTotal: 1000, rss: 2000, external: 0 }),
            cpuUsage: () => ({ user: 1000, system: 1000 }) },
        setInterval(callback, ms) { state.interval = { callback, ms }; return state.interval; },
        clearInterval(handle) { state.cleared = handle; },
        require(id) {
            if (id === 'v8') return { getHeapStatistics: () => ({ heap_size_limit: 1000 }) };
            if (id === 'http') return { request(options, callback) {
                calls.push(options);
                const req = new EventEmitter();
                req.end = () => { queueMicrotask(() => {
                    if (state.timeout) return req.emit('timeout');
                    const response = new EventEmitter();
                    response.statusCode = options.path === '/dashboard/gerador-blogger' ? 302 : 200;
                    response.headers = {};
                    callback(response);
                    response.emit('data', Buffer.from('discarded'));
                    response.emit('end');
                }); };
                req.destroy = () => { state.destroyed++; req.emit('error', Error('ECONNRESET')); };
                return req;
            } };
            if (id === './firebase') return {
                db: { collection(name) { assert.equal(name, '_sentinel_ping'); return { limit(n) { assert.equal(n, 1); return { async get() { if (state.failDb) throw Error('mock offline'); } }; } }; } },
                bucket: { name: 'fake-bucket', async exists() {} }, auth: { async listUsers(n) { assert.equal(n, 1); } },
            };
            throw Error('External dependency forbidden: ' + id);
        },
    });
    return { worker: mod.exports, state, calls };
}

test('health sweep computes score and history using mocked HTTP, GCS, DB and Auth', async () => {
    const { worker, calls } = fixture();
    const report = await worker.runAllTests();
    assert.equal(report.healthScore, 100);
    assert.equal(report.isHealthy, true);
    assert.equal(Object.keys(report.tests).length, 8);
    assert.deepEqual(calls.map(call => call.path).sort(), ['/', '/dashboard/gerador-blogger', '/health']);
    assert.ok(calls.every(call => call.hostname === '127.0.0.1' && call.port === 9090));
    assert.equal(worker.getHistory().length, 1);
    assert.equal(worker.getStatus().uptime, 100);
    assert.equal(worker.getHistoryScores()[0].score, 100);
});

test('consecutive failures produce urgent recommendations and recover after a healthy check', async () => {
    const { worker, state } = fixture();
    state.failDb = true;
    for (let i = 0; i < 3; i++) await worker.runAllTests();
    const status = worker.getStatus();
    assert.equal(status.isHealthy, false);
    assert.equal(status.healthScore, 88);
    assert.equal(status.recommendations[0].test, 'Database Connection');
    assert.equal(status.recommendations[0].urgent, true);
    state.failDb = false;
    await worker.runAllTests();
    assert.equal(worker.getStatus().consecutiveFailures['Database Connection'], 0);
});

test('timeout rejects once and destroys request even when destroy emits another error', async () => {
    const { worker, state } = fixture(); state.timeout = true;
    await assert.rejects(() => worker.makeRequest('/health', 10), /Request timeout/);
    assert.equal(state.destroyed, 1);
});

test('analytics preserves trend, anomalies, heap thresholds and scheduler cleanup', async () => {
    const { worker, state } = fixture();
    worker.testResults = [20, 20, 20, 80, 80, 80].map(healthScore => ({ healthScore }));
    assert.equal(worker.analyzeTrend(), 'melhorando');
    worker.responseTimeSamples.A = [100, 100, 100];
    assert.equal(worker.detectAnomalies({ A: { status: 'PASS', responseTime: 400 } })[0].spike, 4);
    state.memoryRatio = 0.8; assert.equal((await worker.testMemoryUsage()).status, 'WARN');
    state.memoryRatio = 0.95; assert.equal((await worker.testMemoryUsage()).status, 'FAIL');
    let sweeps = 0; worker.runAllTests = async () => { sweeps++; };
    worker.start(1234); assert.equal(sweeps, 1); assert.equal(state.interval.ms, 1234);
    worker.stop(); assert.equal(state.cleared, state.interval);
});
