/**
 * Safe, operator-controlled recovery of abandoned Solaris session locks.
 * Never clear locks by age automatically: a writer may still be running.
 */
export interface LockTimestamp {
    toDate(): Date;
}
export interface LockData {
    uid: string;
    sessionId: string;
    owner: string;
    iniciadoEm: string;
}
export interface LockSnapshot {
    exists: boolean;
    data(): LockData | null | undefined;
    updateTime?: LockTimestamp | null;
}
export interface LockReference {
    get(): Promise<LockSnapshot>;
    delete(options: { lastUpdateTime: LockTimestamp }): Promise<unknown>;
}
export interface LockRecoveryDb {
    collection(name: string): { doc(id: string): LockReference };
}
export interface LockInspection {
    uid: string;
    sessionId: string;
    owner: string;
    startedAt: string;
    updatedAt: string;
    ageMinutes: number;
    eligibleByAge: boolean;
    _ref: LockReference;
    _updateTime: LockTimestamp;
}
export interface LockRecoveryOptions {
    uid: string;
    sessionId: string;
    expectedOwner?: string;
    expectedUpdatedAt?: string;
    confirmation: string;
    instancesStopped: boolean;
}
export interface LockRecoveryResult {
    released: boolean;
    reason: 'already-absent' | 'confirmed-manual-recovery';
}

export const COLLECTION = 'solaris_projetos_bloqueios';
export const REQUIRED_CONFIRMATION = 'APPLICATION_STOPPED_AND_NO_ACTIVE_OPERATIONS';
const MIN_AGE_MS = 60 * 60 * 1000;

function _validId(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && value !== '.' && value !== '..'
        && !value.includes('/') && !value.includes('\\') && !value.includes('\0');
}

function _lockRef(db: LockRecoveryDb, uid: string, sessionId: string): LockReference {
    if (!_validId(uid) || !_validId(sessionId)) throw new TypeError('Identificador de sessão inválido.');
    return db.collection(COLLECTION).doc(`${uid}_${sessionId}`);
}

export async function inspectSolarisLock(
    db: LockRecoveryDb, uid: string, sessionId: string, now: Date = new Date()
): Promise<LockInspection | null> {
    const ref = _lockRef(db, uid, sessionId);
    const snapshot = await ref.get();
    if (!snapshot.exists) return null;
    const data = snapshot.data();
    // Fail closed on malformed or ambiguous metadata.
    if (!data || data.uid !== uid || data.sessionId !== sessionId || typeof data.owner !== 'string' || !data.owner) {
        throw new Error('Bloqueio inválido: identidade não confere com a sessão.');
    }
    const started = new Date(data.iniciadoEm);
    const updated = snapshot.updateTime?.toDate?.();
    if (!Number.isFinite(started.getTime()) || !(updated instanceof Date) || !Number.isFinite(updated.getTime())) {
        throw new Error('Bloqueio sem carimbo de atualização seguro. Não liberar automaticamente.');
    }
    const ageMs = now.getTime() - started.getTime();
    if (!Number.isFinite(ageMs) || ageMs < 0) throw new Error('Relógio inválido para recuperação de bloqueio.');
    return {
        uid, sessionId, owner: data.owner,
        startedAt: started.toISOString(),
        updatedAt: updated.toISOString(),
        ageMinutes: Math.floor(ageMs / 60000),
        eligibleByAge: ageMs >= MIN_AGE_MS,
        _ref: ref,
        _updateTime: snapshot.updateTime as LockTimestamp,
    };
}

export async function recoverSolarisLock(db: LockRecoveryDb, options: LockRecoveryOptions): Promise<LockRecoveryResult> {
    const {uid, sessionId, expectedOwner, expectedUpdatedAt, confirmation, instancesStopped} = options;
    // This is NOT proof that no process is alive; the operator MUST stop all
    // app instances and in-flight workers first. No unattended recovery.
    if (confirmation !== REQUIRED_CONFIRMATION || instancesStopped !== true) {
        throw new Error('Interrompa TODAS as instâncias e confirme a manutenção antes de liberar um bloqueio.');
    }
    const current = await inspectSolarisLock(db, uid, sessionId);
    if (!current) return {released: false, reason: 'already-absent'};
    if (!current.eligibleByAge) throw new Error('Bloqueio muito recente; recuperação requer pelo menos 60 minutos.');
    if (!expectedOwner || current.owner !== expectedOwner || !expectedUpdatedAt || current.updatedAt !== expectedUpdatedAt) {
        throw new Error('Bloqueio alterado desde a inspeção. Faça nova inspeção antes de recuperar.');
    }
    // Atomic compare-and-delete: a replaced/updated lock cannot be removed
    // using a stale fingerprint. Never issue an unconditional delete.
    await current._ref.delete({lastUpdateTime: current._updateTime});
    return {released: true, reason: 'confirmed-manual-recovery'};
}
