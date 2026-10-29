'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

function loadRouter(file) {
    const registrations = [];
    const exigirLogin = (_req, _res, next) => next();
    const router = { get(route, ...handlers) { registrations.push({ route, handlers }); } };
    const sandbox = {
        exports: {},
        module: { exports: {} },
        require(spec) {
            if (spec === 'express') return { Router: () => router };
            if (spec === '../../middlewares/authGuard') return { exigirLogin };
            throw new Error('Dependência inesperada: ' + spec);
        },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, file), 'utf8'), sandbox, { filename: file });
    assert.equal(sandbox.module.exports, router);
    return { registrations, exigirLogin };
}

test('compilador legado preserva dois redirects 301 protegidos', () => {
    const { registrations, exigirLogin } = loadRouter('compiler.js');
    assert.deepEqual(registrations.map(x => x.route), ['/dashboard/compiler', '/dashboard/compiler-blogger-xml']);
    for (const registration of registrations) {
        assert.equal(registration.handlers[0], exigirLogin);
        const received = [];
        registration.handlers[1]({}, { redirect(status, to) { received.push(status, to); } });
        assert.deepEqual(received, [301, '/dashboard/chat']);
    }
});

for (const [file, url, page] of [
    ['configuracoes.js', '/dashboard/configuracoes', 'configuracoes'],
    ['upgrade.js', '/dashboard/upgrade', 'upgrade'],
]) {
    test('rota protegida ' + file + ' preserva a view React e usuário de sessão', () => {
        const { registrations, exigirLogin } = loadRouter(file);
        const selected = registrations.find(r=>r.route===url);
        assert.ok(selected,'rota legada disponível');
        assert.equal(selected.handlers[0], exigirLogin);
        const results = [];
        const user = { uid: 'id-de-teste' };
        selected.handlers[1]({ session: { user } }, { render(view, locals) { results.push({ view, locals }); } });
        assert.equal(results[0].view, 'pages/react-test');
        assert.equal(results[0].locals.activePage, page);
        assert.equal(results[0].locals.user, user);
        if(file==='upgrade.js') {
          const essential=registrations.find(r=>r.route==='/dashboard/plano-essencial');
          assert.ok(essential,'novo plano SSR precisa de rota independente');
          const outcome=[];
          essential.handlers[1]({session:{user}},{render(view,locals){outcome.push({view,locals});}});
          assert.equal(outcome[0].view,'pages/plano-essencial');
        }
    });
}
