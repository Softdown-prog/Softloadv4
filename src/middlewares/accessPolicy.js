"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const WORKER_EMAIL = 'softloady@gmail.com';
function wantsJson(req) {
    if (typeof req?.path === 'string' && req.path.startsWith('/api/'))
        return true;
    const get = typeof req?.get === 'function' ? req.get.bind(req) : () => '';
    return String(get('accept') || '').toLowerCase().includes('application/json') ||
        String(get('x-requested-with') || '').toLowerCase() === 'xmlhttprequest';
}
function decideAccess(scope, req) {
    if (!['session', 'admin', 'worker'].includes(scope))
        throw new TypeError('Unknown access scope');
    const user = req?.session?.user;
    if (scope === 'session')
        return user ? { allow: true } :
            { allow: false, reason: 'session-required', transport: wantsJson(req) ? 'json' : 'navigation' };
    if (scope === 'admin')
        return { allow: user?.is_super_admin === true, reason: 'not-found' };
    return { allow: typeof user?.email === 'string' &&
            user.email.toLowerCase() === WORKER_EMAIL, reason: 'not-found' };
}
module.exports = { decideAccess, wantsJson };
