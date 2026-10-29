"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GRACE_DAYS = exports.NOTICE_DAYS = exports.ESSENTIAL_MB = exports.FREE_MB = exports.DAY = exports.MB = void 0;
exports.validTime = validTime;
exports.currentStorageLimit = currentStorageLimit;
exports.essentialLifecycle = essentialLifecycle;
exports.MB = 1024 * 1024;
exports.DAY = 24 * 60 * 60 * 1000;
exports.FREE_MB = 5;
exports.ESSENTIAL_MB = 50;
exports.NOTICE_DAYS = 5;
exports.GRACE_DAYS = 5;
function validTime(value) {
    if (typeof value !== 'string' || !value)
        return null;
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
}
function currentStorageLimit(account, now = Date.now()) {
    const a = account || {}, until = validTime(a.premium_ate);
    if (a.is_active === true && until !== null && until > now) {
        if (a.plano === 'essencial')
            return exports.ESSENTIAL_MB;
        if (a.plano && ['starter', 'start', 'pro', 'studio', 'premium'].includes(a.plano))
            return null;
    }
    return exports.FREE_MB;
}
function essentialLifecycle(account, now = Date.now()) {
    const a = account || {};
    const expiry = validTime(a.essencial_storage_expira_em);
    const accepted = validTime(a.essencial_storage_aceite_em);
    if (!expiry || !accepted || accepted > expiry || a.essencial_storage_migrado !== true) {
        return { eligible: false, reason: 'sem_politica_ou_migracao_confirmada' };
    }
    const validPlan = validTime(a.premium_ate);
    if (a.is_active === true && validPlan !== null && validPlan > now)
        return { eligible: false, reason: 'plano_ativo' };
    if (a.legal_hold === true || a.storage_retention_hold === true)
        return { eligible: false, reason: 'retencao_legal_ou_suporte' };
    const deadline = expiry + exports.GRACE_DAYS * exports.DAY;
    return {
        eligible: now >= deadline,
        reason: now >= deadline ? 'apos_carencia' : 'prazo_ou_carencia',
        expiresAt: new Date(expiry).toISOString(),
        noticeFrom: new Date(expiry - exports.NOTICE_DAYS * exports.DAY).toISOString(),
        deleteAfter: new Date(deadline).toISOString(),
        scope: 'essential-v1'
    };
}
