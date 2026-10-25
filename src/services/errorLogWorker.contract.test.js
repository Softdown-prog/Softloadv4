'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, 'errorLogWorker.js'), 'utf8');

function harness() {
    const events = new Map(), printed = {errors:[], warns:[], logs:[]}, intervals = [];
    const process = {on(event, listener) {
        if (!events.has(event)) events.set(event, []);
        events.get(event).push(listener);
    }};
    const console = {
        error: (...items) => printed.errors.push(items),
        warn: (...items) => printed.warns.push(items),
        log: (...items) => printed.logs.push(items),
    };
    const module = {exports:{}};
    vm.runInNewContext(source, {
        module, exports:module.exports, console, process, Error, Date,
        setInterval(fn, ms) {
            const interval = {fn,ms,unrefCalled:false,unref(){this.unrefCalled=true;}};
            intervals.push(interval);
            return interval;
        },
    }, {filename:'errorLogWorker.js'});
    return {worker:module.exports, events, printed, intervals, console};
}
const plain = item => JSON.parse(JSON.stringify(item));

test('importação não cria listeners nem timers e start é idempotente', () => {
    const h = harness();
    assert.equal(h.worker.started,false);
    assert.equal(h.worker.logs.length,0);
    assert.equal(h.events.size,0);
    assert.equal(h.intervals.length,0);
    h.worker.start();
    const error = h.console.error;
    const warn = h.console.warn;
    h.worker.start();
    assert.equal(h.console.error,error);
    assert.equal(h.console.warn,warn);
    assert.equal(h.events.get('uncaughtException').length,1);
    assert.equal(h.events.get('unhandledRejection').length,1);
    assert.equal(h.intervals.length,1);
    assert.equal(h.intervals[0].ms,60*60*1000);
    assert.equal(h.intervals[0].unrefCalled,true);
    assert.equal(h.printed.logs.length,1);
});

test('captura error/warn sem perder saída original e ignora ruído operacional', () => {
    const h = harness();
    h.worker.start();
    h.console.error('[GEMINI] Falha de execução', {status:500});
    h.console.warn('[COMPILER] Atenção');
    h.console.error('[SESSION] Erro ao salvar sessão inesperado');
    h.console.warn('Listening on port 3000');
    h.console.warn('Sentinel Check — tudo normal');
    h.console.warn('Warning: Setting the NODE_TLS_REJECT_UNAUTHORIZED');
    assert.equal(h.printed.errors.length,2);
    assert.equal(h.printed.warns.length,4);
    assert.equal(h.worker.logs.length,2);
    assert.deepEqual(plain(h.worker.getStats().byLevel),{error:1,warn:1});
    assert.deepEqual(plain(h.worker.getStats().bySource),{GEMINI:1,COMPILER:1});
    assert.match(h.worker.logs[0].message,/status/);
});

test('exceções, rejection e objetos circulares são capturados sem encerrar processo', () => {
    const h=harness(); h.worker.start();
    h.events.get('uncaughtException')[0](new Error('falha sem captura'));
    h.events.get('unhandledRejection')[0](new Error('promise rejeitada'));
    h.events.get('unhandledRejection')[0]('motivo textual');
    const circular={};
    circular.ref=circular;
    h.console.error('[SERVER] Objeto circular',circular);
    assert.equal(h.worker.logs.length,4);
    assert.equal(h.worker.logs[0].level,'uncaughtException');
    assert.equal(h.worker.logs[1].level,'unhandledRejection');
    assert.equal(h.worker.logs[2].message,'motivo textual');
    assert.match(h.worker.logs[3].message,/circular/);
});

test('stack é separada da primeira linha e limites de mensagem são preservados', () => {
    const h=harness();
    const long='x'.repeat(1200), stack='y'.repeat(3000);
    h.worker._capture('error',['[APP] '+long+'\n'+stack]);
    const entry=h.worker.logs[0];
    assert.equal(entry.source,'APP');
    assert.equal(entry.message.length,1000);
    assert.equal(entry.stack.length,2000);
    assert.equal(entry.level,'error');
    assert.ok(!Number.isNaN(Date.parse(entry.ts)));
});

test('janela de 24 horas, filtro since, agregação e poda horária', () => {
    const h=harness(); h.worker.start();
    const now=Date.now();
    h.worker.logs.push({ts:new Date(now-26*3600e3).toISOString(), level:'error',source:'OLD',message:'old',stack:null});
    h.worker.logs.push({ts:new Date(now-3600e3).toISOString(),level:'warn',source:'APP',message:'recent',stack:null});
    h.worker.logs.push({ts:new Date(now-1000).toISOString(),level:'error',source:'APP',message:'newest',stack:null});
    assert.equal(h.worker.getLogs().length,2);
    assert.equal(h.worker.getLogs(now-2000).length,1);
    const grouped=h.worker.getLogsAndStats(now-2*3600e3);
    assert.equal(grouped.stats.total,2);
    assert.deepEqual(plain(grouped.stats.byLevel),{warn:1,error:1});
    assert.deepEqual(plain(grouped.stats.bySource),{APP:2});
    assert.equal(grouped.stats.oldest,grouped.logs[0].ts);
    assert.equal(grouped.stats.newest,grouped.logs[1].ts);
    assert.ok(grouped.stats.capturedSince);
    h.intervals[0].fn();
    assert.equal(h.worker.logs.length,2);
});

test('buffer limitado a 5000 entradas não acumula erros indefinidamente', () => {
    const h=harness();
    for(let i=0;i<5001;i++)h.worker._capture('error',['[TEST] '+i]);
    assert.equal(h.worker.logs.length,5000);
    assert.equal(h.worker.logs[0].message,'[TEST] 1');
    assert.equal(h.worker.logs[4999].message,'[TEST] 5000');
    assert.equal(h.worker.getStats().total,5000);
});
