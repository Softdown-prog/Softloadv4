/**
 * CLI operacional Solaris: inspeciona bloqueios e exige confirmação
 * explícita antes de qualquer recuperação; nunca abre uma rota HTTP.
 */
export interface SolarisLockInspection {
    owner: string;
    uid: string;
    sessionId: string;
    startedAt: string;
    updatedAt: string;
    ageMinutes: number;
    eligibleByAge: boolean;
}
export interface SolarisRecoveryResult { released: boolean; reason: string }
export interface SolarisRecoveryDb { collection(name: string): unknown }
interface LockRecoveryApi {
    REQUIRED_CONFIRMATION: string;
    inspectSolarisLock(db: SolarisRecoveryDb, uid: string, sessionId: string): Promise<SolarisLockInspection | null>;
    recoverSolarisLock(db: SolarisRecoveryDb, options: {
        uid: string;
        sessionId: string;
        expectedOwner?: string;
        expectedUpdatedAt?: string;
        confirmation: string;
        instancesStopped: true;
    }): Promise<SolarisRecoveryResult>;
}
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exitCode: number };
const { inspectSolarisLock, recoverSolarisLock, REQUIRED_CONFIRMATION } =
    require('../src/solaris/tools/projectLockRecovery') as LockRecoveryApi;

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
    const [action, uid, sessionId, expectedOwner, expectedUpdatedAt, ...flags] = argv;
    if (!['inspect', 'recover'].includes(action) || !uid || !sessionId) {
        throw Error('Uso: node scripts/solarisProjectLockRecovery.js inspect UID SESSION | recover UID SESSION OWNER UPDATED_AT --instances-stopped --confirm');
    }
    if (action === 'recover' && (!flags.includes('--instances-stopped') || !flags.includes('--confirm'))) {
        throw Error('Recuperação requer --instances-stopped e --confirm (após encerrar TODAS as instâncias).');
    }
    (require('dotenv') as { config(): void }).config();
    const { db } = require('../src/services/firebase') as { db: SolarisRecoveryDb };
    if (action === 'inspect') {
        const lock = await inspectSolarisLock(db, uid, sessionId);
        const report = lock ? {
            owner: lock.owner, uid: lock.uid, sessionId: lock.sessionId,
            startedAt: lock.startedAt, updatedAt: lock.updatedAt,
            ageMinutes: lock.ageMinutes, eligibleByAge: lock.eligibleByAge,
            warning: 'Idade NÃO prova que a operação parou. Não libere com instâncias ativas.',
        } : { status: 'unlocked' };
        console.log(JSON.stringify(report, null, 2));
    } else {
        const result = await recoverSolarisLock(db, {
            uid, sessionId, expectedOwner, expectedUpdatedAt,
            confirmation: REQUIRED_CONFIRMATION, instancesStopped: true,
        });
        console.log(JSON.stringify(result));
    }
}
if (require.main === module) {
    main().catch((err: Error) => { console.error('[SOLARIS-LOCK-RECOVERY]', err.message); process.exitCode = 1; });
}
