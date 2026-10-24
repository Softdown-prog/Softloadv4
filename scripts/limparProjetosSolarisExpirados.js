"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const { apagarProjetosExpirados, DIAS_RETENCAO_PADRAO } = require('../src/solaris/tools/projectStorage');
const diasArg = Number(process.argv[2]);
const dias = Number.isFinite(diasArg) && diasArg > 0 ? diasArg : DIAS_RETENCAO_PADRAO;
apagarProjetosExpirados({ diasParaExpirar: dias })
    .then((r) => {
    console.log(`\n✅ ${r.apagados.length} projeto(s) expirado(s) (>${dias}d) removido(s): ${r.apagados.join(', ') || '-'}`);
    if (r.erros.length) {
        console.log(`❌ ${r.erros.length} erro(s):`);
        for (const e of r.erros)
            console.log(`   - ${e.id}: ${e.erro}`);
    }
    process.exit(r.erros.length > 0 ? 1 : 0);
})
    .catch((err) => {
    console.error('[SOLARIS-CLEANUP] falhou:', err.message);
    process.exit(1);
});
