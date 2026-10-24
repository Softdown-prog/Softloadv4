'use strict';

/**
 * Testes de projectStorage.js — só o suficiente pra não tocar GCS/Firestore
 * de verdade (mesma convenção do resto do módulo, README documenta): a
 * lógica de TTL (`_estaExpirado`) é pura, testada isoladamente aqui;
 * salvarProjeto/carregarProjeto/apagarProjeto/apagarProjetosExpirados
 * tocam serviços reais e são verificados manualmente antes de cada PR,
 * nunca em CI.
 *
 * Execute: node src/solaris/tools/projectStorage.test.js
 */

const { _estaExpirado, DIAS_RETENCAO_PADRAO, salvarProjeto, carregarProjeto, apagarProjeto, apagarProjetosExpirados } = require('./projectStorage');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function run() {
    // A. _estaExpirado — dentro do prazo, não expirou.
    {
        const agora = new Date('2026-08-07T12:00:00Z');
        const criadoEm = new Date('2026-08-01T12:00:00Z').toISOString(); // 6 dias atrás
        assert('6 dias < 30 dias: não expirado', _estaExpirado(criadoEm, 30, agora) === false);
    }

    // B. _estaExpirado — passou do prazo, expirou.
    {
        const agora = new Date('2026-08-07T12:00:00Z');
        const criadoEm = new Date('2026-06-01T12:00:00Z').toISOString(); // ~67 dias atrás
        assert('67 dias > 30 dias: expirado', _estaExpirado(criadoEm, 30, agora) === true);
    }

    // C. _estaExpirado — exatamente no limite não conta como expirado (usa >, não >=).
    {
        const criadoEm = new Date('2026-08-01T12:00:00Z');
        const agora = new Date(criadoEm.getTime() + 30 * 24 * 60 * 60 * 1000); // exatos 30 dias depois
        assert('exatamente 30 dias: ainda não expirado (>, não >=)', _estaExpirado(criadoEm.toISOString(), 30, agora) === false);
        const umMsDepois = new Date(agora.getTime() + 1);
        assert('30 dias + 1ms: expirado', _estaExpirado(criadoEm.toISOString(), 30, umMsDepois) === true);
    }

    // D. _estaExpirado — data inválida nunca expira sozinha (fail-safe).
    {
        assert('data inválida: nunca expira', _estaExpirado('isso-não-é-uma-data', 30) === false);
        assert('data ausente/undefined: nunca expira', _estaExpirado(undefined, 30) === false);
    }

    // E. DIAS_RETENCAO_PADRAO é um número positivo razoável (documentado no README).
    {
        assert('DIAS_RETENCAO_PADRAO é número positivo', typeof DIAS_RETENCAO_PADRAO === 'number' && DIAS_RETENCAO_PADRAO > 0);
    }

    // F. Exports tocando GCS/Firestore existem como funções — smoke-test de
    // require, nunca chamados de verdade aqui (revisão manual antes de PR).
    {
        assert('salvarProjeto é função', typeof salvarProjeto === 'function');
        assert('carregarProjeto é função', typeof carregarProjeto === 'function');
        assert('apagarProjeto é função', typeof apagarProjeto === 'function');
        assert('apagarProjetosExpirados é função', typeof apagarProjetosExpirados === 'function');
    }
}

run();
console.log(`\n${failed === 0 ? '✅' : '❌'} projectStorage: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
