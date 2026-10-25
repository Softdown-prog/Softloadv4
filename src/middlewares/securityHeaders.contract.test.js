'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'security.js'), 'utf8');

function loadSecurity(nodeEnv) {
    const calls = [];
    const module = { exports: {} };
    const context = {
        module,
        exports: {},
        process: { env: { NODE_ENV: nodeEnv } },
        require(id) {
            assert.equal(id, 'cors');
            return options => {
                calls.push(options);
                return { type: 'cors-middleware' };
            };
        },
    };
    vm.runInNewContext(source, context, { filename: 'security.js' });
    return { exports: module.exports, corsOptions: calls[0], corsCalls: calls.length };
}

function getHeaders(middleware) {
    const headers = {};
    let nextCalls = 0;
    middleware({}, {
        setHeader(name, value) { headers[name] = value; },
    }, () => { nextCalls += 1; });
    return { headers, nextCalls };
}

for (const env of ['production', 'development']) {
    test('headers HTTP preservados no ambiente ' + env, () => {
        const { exports: exported, corsOptions, corsCalls } = loadSecurity(env);
        const { headers, nextCalls } = getHeaders(exported.helmetMiddleware);
        assert.equal(nextCalls, 1);
        assert.equal(corsCalls, 1);
        assert.equal(headers['X-Content-Type-Options'], 'nosniff');
        assert.equal(headers['X-Frame-Options'], 'DENY');
        assert.equal(headers['X-DNS-Prefetch-Control'], 'off');
        assert.equal(headers['Referrer-Policy'], 'no-referrer');
        assert.equal(headers['Cross-Origin-Opener-Policy'], 'same-origin-allow-popups');
        assert.equal(headers['Strict-Transport-Security'], env === 'production' ? 'max-age=15552000; includeSubDomains' : undefined);
        assert.equal(corsOptions.origin, true);
        assert.equal(corsOptions.credentials, true);
        assert.equal(corsOptions.optionsSuccessStatus, 200);
        assert.deepEqual(Array.from(corsOptions.methods), ['GET', 'POST']);
        assert.deepEqual(Array.from(corsOptions.allowedHeaders), ['Content-Type', 'Authorization']);
        assert.equal(exported.corsMiddleware.type, 'cors-middleware');
    });
}
