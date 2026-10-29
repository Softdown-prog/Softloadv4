'use strict';

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const FREE_MB = 5;
const ESSENTIAL_MB = 50;
const NOTICE_DAYS = 5;
const GRACE_DAYS = 5;
function validTime(value) {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
function currentStorageLimit(account, now = Date.now()) {
  const a = account || {}, until = validTime(a.premium_ate);
  if (a.is_active === true && until !== null && until > now) {
    if (a.plano === 'essencial') return ESSENTIAL_MB;
    if (['starter','start','pro','studio','premium'].includes(a.plano)) return null;
  }
  return FREE_MB;
}
function essentialLifecycle(account, now = Date.now()) {
  const a = account || {};
  const expiry = validTime(a.essencial_storage_expira_em);
  const accepted = validTime(a.essencial_storage_aceite_em);
  // Não tocar contas antigas sem consentimento e migração do armazenamento.
  if (!expiry || !accepted || accepted > expiry || a.essencial_storage_migrado !== true) {
    return {eligible:false,reason:'sem_politica_ou_migracao_confirmada'};
  }
  const validPlan = validTime(a.premium_ate);
  if (a.is_active === true && validPlan !== null && validPlan > now) return {eligible:false,reason:'plano_ativo'};
  if (a.legal_hold === true || a.storage_retention_hold === true)
    return {eligible:false,reason:'retencao_legal_ou_suporte'};
  const deadline = expiry + GRACE_DAYS * DAY;
  return {
    eligible:now >= deadline,
    reason:now >= deadline ? 'apos_carencia' : 'prazo_ou_carencia',
    expiresAt:new Date(expiry).toISOString(),
    noticeFrom:new Date(expiry-NOTICE_DAYS*DAY).toISOString(),
    deleteAfter:new Date(deadline).toISOString(),
    scope:'essential-v1'
  };
}
module.exports={MB,DAY,FREE_MB,ESSENTIAL_MB,NOTICE_DAYS,GRACE_DAYS,validTime,currentStorageLimit,essentialLifecycle};
