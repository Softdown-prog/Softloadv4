'use strict';

// ============================================================
// npm run solaris:limpar-projetos-expirados [-- <dias>]
// ============================================================
// CLI pra rodar a limpeza de TTL de projetos Solaris persistidos
// manualmente (ou plugado em qualquer scheduler externo que já exista —
// Cloud Scheduler batendo na rota HTTP interna é a outra opção, ver
// src/routes/apiRoutes.js POST /internal/solaris/limpar-projetos-expirados).
// Toca Firestore/GCS de produção de verdade — nunca rodado em teste
// automatizado (mesma convenção do resto de src/solaris/tools/projectStorage.js).
// ============================================================

require('dotenv').config();
const { apagarProjetosExpirados, DIAS_RETENCAO_PADRAO } = require('../src/solaris/tools/projectStorage');

const diasArg = Number(process.argv[2]);
const dias = Number.isFinite(diasArg) && diasArg > 0 ? diasArg : DIAS_RETENCAO_PADRAO;

apagarProjetosExpirados({ diasParaExpirar: dias })
    .then((r) => {
        console.log(`\n✅ ${r.apagados.length} projeto(s) expirado(s) (>${dias}d) removido(s): ${r.apagados.join(', ') || '-'}`);
        if (r.erros.length) {
            console.log(`❌ ${r.erros.length} erro(s):`);
            for (const e of r.erros) console.log(`   - ${e.id}: ${e.erro}`);
        }
        process.exit(r.erros.length > 0 ? 1 : 0);
    })
    .catch((err) => {
        console.error('[SOLARIS-CLEANUP] falhou:', err.message);
        process.exit(1);
    });
