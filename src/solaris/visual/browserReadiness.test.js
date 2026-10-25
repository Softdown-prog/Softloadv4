'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { browserSandboxReady } = require('./browserReadiness');

function response(body, status = 200) {
    return {
        ok: status >= 200 && status < 300,
        async text() { return typeof body === 'string' ? body : JSON.stringify(body); },
    };
}

test('habilita só quando /health confirma Chromium de verdade', async () => {
    let request;
    const ready = await browserSandboxReady('http://sandbox:8080/', async (url, opts) => {
        request = {url, opts};
        return response({status:'ok',capabilities:{browser:true,archive:true}});
    });
    assert.equal(ready, true);
    assert.equal(request.url, 'http://sandbox:8080/health');
    assert.equal(request.opts.method, 'GET');
    assert.equal(request.opts.redirect, 'error');
    assert.ok(request.opts.signal);
});

test('bloqueia archive-only, sandbox antigo e status inválido', async () => {
    const samples = [
        {status:'ok',capabilities:{browser:false,archive:true}},
        {status:'ok'},
        {status:'error',capabilities:{browser:true}},
        {status:'ok',capabilities:{browser:'true'}},
        {status:'ok',capabilities:{browser:1}},
    ];
    for (const sample of samples) {
        assert.equal(await browserSandboxReady('http://sandbox:8080',async () => response(sample)), false);
    }
});

test('falha fechado para rede indisponível, erro HTTP, corpo inválido e body excessivo', async () => {
    const failures = [
        async () => { throw new Error('ECONNREFUSED'); },
        async () => response('not json'),
        async () => response('x'.repeat(3000)),
        async () => response({status:'ok',capabilities:{browser:true}},503),
    ];
    for (const fetcher of failures) {
        assert.equal(await browserSandboxReady('http://sandbox:8080',fetcher), false);
    }
});

test('rejeita endpoint inseguro, URL malformada ou não configurada sem fazer fetch', async () => {
    let calls=0;
    const fetcher=async()=>{ calls++;return response({status:'ok',capabilities:{browser:true}}); };
    for(const url of [
        undefined,'','ftp://sandbox:8080','https://user:password@sandbox.local',
        'file:///etc/passwd','invalidurl',
    ]) {
        assert.equal(await browserSandboxReady(url,fetcher),false);
    }
    assert.equal(calls,0);
});
