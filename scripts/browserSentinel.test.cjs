'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
function fixture() {
    const elements = new Map(), requests = [], charts = [];
    const document = { getElementById(id) {
        if (!elements.has(id)) elements.set(id, { id, style: {}, textContent: '', innerHTML: '', disabled: false });
        return elements.get(id);
    } };
    const window = {};
    const context = vm.createContext({ window, document,
        fetch(url) { let resolve; const promise = new Promise(done => resolve = done); requests.push({ url, resolve }); return promise; },
        Chart: class { constructor(canvas, config) { this.canvas = canvas; this.config = config; this.data = config.data; this.updates = 0; charts.push(this); } update() { this.updates++; } },
    });
    for (const name of ['w-utils', 'w-sentinel']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../public/js/workers', name + '.js'), 'utf8'), context);
    const respond = (i, data, ok = true) => requests[i].resolve({ ok, status: ok ? 200 : 503, async json() { return data; } });
    return { window, elements, requests, charts, respond, el: id => document.getElementById(id) };
}
const status = () => ({ healthScore: 94, uptime: 99, trend: 'melhorando', lastCheck: '2026-10-26T16:00:00Z', avgResponseTime: 12.5,
    tests: { 'Memory Usage': { status: 'WARN', usagePercent: 96, heapUsedMb: 300, heapLimitMb: 320, rssMb: 350 }, '<img src=x>': { status: 'FAIL', error: '<script>bad</script>', responseTime: 12 } },
    consecutiveFailures: { '<img src=x>': 3 }, recommendations: [{ test: '<img src=x>', status: 'FAIL', urgent: true, recommendation: '<script>recommendation</script>' }],
    anomalies: [{ test: '<img src=x>', responseTime: 400, avgResponseTime: 100, spike: 4 }],
});

test('refresh deduplicates pending requests, escapes values and restores controls', async () => {
    const f = fixture(); const first = f.window.workerRefresh(); await f.window.workerRefresh();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/workers/api/status');
    assert.equal(f.el('btnAtualizar').disabled, true); assert.equal(f.el('btnAnalisar').disabled, true);
    f.respond(0, status()); await first;
    assert.equal(f.el('btnAtualizar').disabled, false); assert.equal(f.el('iconAtualizar').style.animation, '');
    assert.equal(f.el('healthStatus').textContent, 'Saudável'); assert.equal(f.el('heapBar').style.width, '96%');
    assert.equal(f.el('memAlertBadge').textContent, 'Crítico');
    assert.match(f.el('testsGrid').innerHTML, /&lt;img/); assert.doesNotMatch(f.el('testsGrid').innerHTML, /<script>|<img/);
    assert.match(f.el('recommendationsList').innerHTML, /&lt;script/);
    assert.equal(f.charts.length, 1); assert.equal(f.charts[0].config.type, 'doughnut');
    assert.deepEqual(Array.from(f.charts[0].data.datasets[0].data), [0, 1, 1]);
});

test('HTTP failure releases busy flag and allows retry without stale chart duplication', async () => {
    const f = fixture(); let promise = f.window.workerRefresh(); f.respond(0, null, false); await promise;
    assert.match(f.el('testsGrid').innerHTML, /Erro ao carregar/); assert.equal(f.el('btnAtualizar').disabled, false);
    promise = f.window.workerRefresh(); f.respond(1, status()); await promise;
    promise = f.window.workerRefresh(); f.respond(2, { healthScore: 40, tests: {}, recommendations: [], anomalies: [] }); await promise;
    assert.equal(f.el('healthStatus').textContent, 'Crítico'); assert.equal(f.el('recommendationsWrap').style.display, 'none');
    assert.equal(f.charts.length, 1); assert.equal(f.charts[0].updates, 1);
});

test('history has an independent deduplication flag and updates the existing line chart', async () => {
    const f = fixture(); let promise = f.window._workerLoadHistory(); await f.window._workerLoadHistory();
    assert.equal(f.requests.length, 1); assert.equal(f.requests[0].url, '/workers/api/scores?limit=20');
    f.respond(0, [{ ts: '2026-10-26T16:00:00Z', score: 80 }, { timestamp: '2026-10-26T16:01:00Z', score: 90 }]); await promise;
    assert.equal(f.charts.length, 1); assert.equal(f.charts[0].config.type, 'line');
    assert.deepEqual(Array.from(f.charts[0].data.datasets[0].data), [80, 90]);
    promise = f.window._workerLoadHistory(); f.respond(1, [{ ts: '2026-10-26T16:02:00Z', score: 0 }]); await promise;
    assert.equal(f.charts.length, 1); assert.equal(f.charts[0].updates, 1);
    assert.deepEqual(Array.from(f.charts[0].data.datasets[0].data), [0]);
});

test('classic browser globals remain callable with no CommonJS loader', () => {
    const f = fixture();
    assert.equal(typeof f.window.solicitarAnaliseMemoria, 'function');
    assert.equal(typeof f.window._workerStatusChart, 'function');
    f.window._workerStatusChart({});
    assert.deepEqual(Array.from(f.charts[0].data.datasets[0].data), [0, 0, 0]);
});
