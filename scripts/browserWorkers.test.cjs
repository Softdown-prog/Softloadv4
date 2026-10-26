'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const scripts = path.join(__dirname, '..', 'public/js/workers');
function run(script, globals) {
    const source = fs.readFileSync(path.join(scripts, script + '.js'), 'utf8');
    vm.runInNewContext(source, globals, { filename: script + '.js', timeout: 1000 });
}
test('w-utils mantém API global, escaping e atribuição de valores nulos', () => {
    const element = { textContent: null };
    const window = {};
    const document = { getElementById: (id) => id === 'present' ? element : null };
    run('w-utils', { window, document });
    assert.equal(typeof window._w.el, 'function');
    assert.equal(window._w.el('present'), element);
    window._w.setText('present', null);
    assert.equal(element.textContent, null);
    window._w.setText('present', 'texto');
    assert.equal(element.textContent, 'texto');
    assert.equal(window._w.esc(`<x a="&">`), '&lt;x a=&quot;&amp;&quot;&gt;');
    assert.equal(window._w.esc(null), '');
});
test('w-init preserva montagem e frequências do Sentinel', () => {
    const calls = [], timers = [];
    const window = {
        _workerStatusChart: (x) => calls.push(['chart', Object.keys(x).length]),
        workerRefresh: () => calls.push(['status']),
        _workerLoadHistory: () => calls.push(['history'])
    };
    run('w-init', {
        window,
        setTimeout: (fn, ms) => timers.push(['timeout', ms, fn]),
        setInterval: (fn, ms) => timers.push(['interval', ms, fn])
    });
    assert.deepEqual(calls.map(x => x[0]), ['chart', 'status']);
    assert.deepEqual(timers.map(x => [x[0], x[1]]),
        [['timeout', 500], ['interval', 60000], ['interval', 120000]]);
    timers[0][2](); timers[1][2](); timers[2][2]();
    assert.deepEqual(calls.slice(2).map(x => x[0]), ['history', 'status', 'history']);
});
test('w-log-init inicia após DOM ready e atualiza a cada 60 segundos', () => {
    const element = { textContent: null }, timers = [], handlers = {};
    let loads = 0;
    const document = {
        getElementById: () => element,
        addEventListener: (name, fn) => { handlers[name] = fn; }
    };
    run('w-log-init', {
        document, loadErrorLog: () => loads++,
        setInterval: (fn, ms) => timers.push({ fn, ms })
    });
    assert.equal(loads, 0);
    handlers.DOMContentLoaded();
    assert.equal(loads, 1);
    assert.equal(element.textContent, '60s');
    assert.equal(timers[0].ms, 1000);
    for (let i = 0; i < 59; i++) timers[0].fn();
    assert.equal(loads, 1);
    assert.equal(element.textContent, '1s');
    timers[0].fn();
    assert.equal(loads, 2);
    assert.equal(element.textContent, '60s');
});
test('templates continuam carregando scripts clássicos na ordem correta', () => {
    const root = path.join(__dirname, '..', 'views/pages/workers');
    for (const [template, expected] of [
        ['worker_health.ejs', ['w-utils.js', 'w-sentinel.js', 'w-init.js']],
        ['workerlog.ejs', ['w-utils.js', 'w-errorlog.js', 'w-log-init.js']]
    ]) {
        const html = fs.readFileSync(path.join(root, template), 'utf8');
        const indices = expected.map(name => html.indexOf('/js/workers/' + name));
        assert.ok(indices.every(i => i >= 0), template + ' faltando scripts');
        assert.ok(indices.every((v, i) => i === 0 || v > indices[i - 1]),
            template + ' ordem de scripts mudou');
    }
});
