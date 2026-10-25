'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { exigirSuperAdmin } = require('./adminGuard');
const { exigirWorkerAccess } = require('./workerGuard');

function guardResponse() {
    const events = [];
    const res = {
        status(code) { events.push(['status', code]); return this; },
        render(view) { events.push(['render', view]); return this; },
    };
    return { res, events };
}

test('superadministrador autorizado passa; contas comuns e sessões ausentes recebem 404', () => {
    for (const [user, allow] of [
        [{ is_super_admin: true }, true],
        [{ is_super_admin: false }, false],
        [{ is_super_admin: 'true' }, false],
        [undefined, false],
    ]) {
        const { res, events } = guardResponse();
        let nextCalls = 0;
        exigirSuperAdmin(user ? { session: { user } } : {}, res, () => { nextCalls += 1; });
        assert.equal(nextCalls, allow ? 1 : 0);
        assert.deepEqual(events, allow ? [] : [['status', 404], ['render', 'pages/404']]);
    }
});

test('worker autorizado por email ignora caixa; outros usuários recebem 404', () => {
    for (const [user, allow] of [
        [{ email: 'SOFTLOADY@gmail.com' }, true],
        [{ email: 'softloady@gmail.com' }, true],
        [{ email: 'outro@example.com' }, false],
        [undefined, false],
    ]) {
        const { res, events } = guardResponse();
        let nextCalls = 0;
        exigirWorkerAccess(user ? { session: { user } } : {}, res, () => { nextCalls += 1; });
        assert.equal(nextCalls, allow ? 1 : 0);
        assert.deepEqual(events, allow ? [] : [['status', 404], ['render', 'pages/404']]);
    }
});
