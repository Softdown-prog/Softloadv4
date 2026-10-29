'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadRouter(file) {
    const routes = [];
    const middlewares = [];
    const exigirLogin = (_req, _res, next) => next();
    const router = {
        get(route, ...handlers) { routes.push({ route, handlers }); },
        use(handler) { middlewares.push(handler); },
    };
    const sandbox = {
        module: { exports: {} }, exports: {},
        require(id) {
            if (id === 'express') return { Router: () => router };
            if (id === '../../middlewares/authGuard') return { exigirLogin };
            if (id.startsWith('./')) return id;
            throw new Error('Unexpected dependency: ' + id);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
    assert.equal(sandbox.module.exports, router);
    return { routes, middlewares, exigirLogin };
}
test('dashboard mounts only Blogger, Forge and compatibility account/history routes', () => {
    const { middlewares } = loadRouter('index.js');
    assert.deepEqual(middlewares, ['./home', './compiler', './historico', './configuracoes', './upgrade', './conta', './reactTest']);
});
test('dashboard home requires login and passes session to simplified EJS view', () => {
    const { routes, exigirLogin } = loadRouter('home.js');
    assert.equal(routes.length, 1);
    assert.equal(routes[0].route, '/dashboard');
    assert.equal(routes[0].handlers[0], exigirLogin);
    const user = { uid: 'test-user' };
    const values = [];
    routes[0].handlers[1]({ session: { user } }, { render(view, locals) { values.push({view, locals}); } });
    assert.equal(values[0].view, 'pages/dashboard-simples');
    assert.equal(values[0].locals.activePage, 'home');
    assert.equal(values[0].locals.user, user);
});
test('react test bridge preserves its original render behavior', () => {
    const { routes } = loadRouter('reactTest.js');
    assert.equal(routes[0].route, '/react-test');
    let view = null;
    routes[0].handlers[0]({}, { render(name) { view = name; } });
    assert.equal(view, 'pages/react-test');
});
