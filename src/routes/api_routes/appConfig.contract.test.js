'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('app-config returns logged-in user and current public frontend configuration', () => {
    const routes = [];
    const router = { get(path, handler) { routes.push({ path, handler }); } };
    const sandbox = {
        module: { exports: {} }, exports: {},
        process: { env: { FIREBASE_API_KEY: 'public-key', FIREBASE_APP_ID: 'app-id', MP_CHECKOUT_URL: '/checkout' } },
        require(id) { assert.equal(id, 'express'); return { Router: () => router }; },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, 'appConfig.js'), 'utf8'), sandbox);
    assert.equal(sandbox.module.exports, router);
    assert.equal(routes.length, 1);
    assert.equal(routes[0].path, '/api/app-config');
    const user = { uid: 'test-uid' };
    let data;
    routes[0].handler({ session: { user } }, { json(value) { data = value; } });
    assert.equal(data.user, user);
    assert.equal(data.firebaseConfig.apiKey, 'public-key');
    assert.equal(data.firebaseConfig.appId, 'app-id');
    assert.equal(data.features.mpCheckoutUrl, '/checkout');
});
