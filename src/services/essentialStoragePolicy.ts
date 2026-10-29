/** Fonte TypeScript tipada da política pura consumida via essentialStoragePolicy.cjs. */
export interface EssentialStorageAccount {
  plano?: string;
  is_active?: boolean;
  premium_ate?: string | null;
  essencial_storage_expira_em?: string | null;
  essencial_storage_aceite_em?: string | null;
  essencial_storage_migrado?: boolean;
  legal_hold?: boolean;
  storage_retention_hold?: boolean;
}
export interface EssentialStorageLifecycle {
  eligible: boolean;
  reason: string;
  expiresAt?: string;
  noticeFrom?: string;
  deleteAfter?: string;
  scope?: 'essential-v1';
}
export const MB = 1024 * 1024;
export const DAY = 24 * 60 * 60 * 1000;
export const FREE_MB = 5;
export const ESSENTIAL_MB = 50;
export const NOTICE_DAYS = 5;
export const GRACE_DAYS = 5;
export function validTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}
export function currentStorageLimit(account: EssentialStorageAccount | null | undefined, now = Date.now()): number | null {
  const a = account || {}, until = validTime(a.premium_ate);
  if (a.is_active === true && until !== null && until > now) {
    if (a.plano === 'essencial') return ESSENTIAL_MB;
    if (a.plano && ['starter','start','pro','studio','premium'].includes(a.plano)) return null;
  }
  return FREE_MB;
}
export function essentialLifecycle(account: EssentialStorageAccount | null | undefined, now = Date.now()): EssentialStorageLifecycle {
  const a = account || {};
  const expiry = validTime(a.essencial_storage_expira_em);
  const accepted = validTime(a.essencial_storage_aceite_em);
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
