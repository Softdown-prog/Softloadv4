"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.main = main;
const { inspectSolarisLock, recoverSolarisLock, REQUIRED_CONFIRMATION } = require('../src/solaris/tools/projectLockRecovery');
async function main(argv = process.argv.slice(2)) {
    const [action, uid, sessionId, expectedOwner, expectedUpdatedAt, ...flags] = argv;
    if (!['inspect', 'recover'].includes(action) || !uid || !sessionId) {
        throw Error('Uso: node scripts/solarisProjectLockRecovery.js inspect UID SESSION | recover UID SESSION OWNER UPDATED_AT --instances-stopped --confirm');
    }
    if (action === 'recover' && (!flags.includes('--instances-stopped') || !flags.includes('--confirm'))) {
        throw Error('Recuperação requer --instances-stopped e --confirm (após encerrar TODAS as instâncias).');
    }
    require('dotenv').config();
    const { db } = require('../src/services/firebase');
    if (action === 'inspect') {
        const lock = await inspectSolarisLock(db, uid, sessionId);
        const report = lock ? {
            owner: lock.owner, uid: lock.uid, sessionId: lock.sessionId,
            startedAt: lock.startedAt, updatedAt: lock.updatedAt,
            ageMinutes: lock.ageMinutes, eligibleByAge: lock.eligibleByAge,
            warning: 'Idade NÃO prova que a operação parou. Não libere com instâncias ativas.',
        } : { status: 'unlocked' };
        console.log(JSON.stringify(report, null, 2));
    }
    else {
        const result = await recoverSolarisLock(db, {
            uid, sessionId, expectedOwner, expectedUpdatedAt,
            confirmation: REQUIRED_CONFIRMATION, instancesStopped: true,
        });
        console.log(JSON.stringify(result));
    }
}
if (require.main === module) {
    main().catch((err) => { console.error('[SOLARIS-LOCK-RECOVERY]', err.message); process.exitCode = 1; });
}
