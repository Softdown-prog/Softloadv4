'use strict';
/**
 * Task Worker — worker_threads background executor
 * Recebe { comando, alvo, flags, modoJson, env } via workerData.
 * Opera no Firestore/GCS/Firebase Auth sem bloquear o Express.
 */

const { parentPort, workerData } = require('worker_threads');
const path = require('path');

// Injeta env vars antes de qualquer require de serviço
if (workerData && workerData.env) {
    for (const [k, v] of Object.entries(workerData.env)) {
        // Aceita apenas valores primitivos coercíveis em string — evita "[object Object]"
        if (v == null) continue;
        const t = typeof v;
        if (t === 'string' || t === 'number' || t === 'boolean') {
            process.env[k] = String(v);
        }
    }
}
// override:false garante que valores injetados acima (workerData) tenham prioridade
// sobre os do .env local. Em produção (Cloud Run) o arquivo não existe e tudo segue igual.
try { require('dotenv').config({ path: path.join(__dirname, '../../.env'), override: false }); } catch (_) {}

// ==========================================
// COMUNICAÇÃO COM O CLI
// ==========================================

const modoJson = workerData && workerData.modoJson;

function ok(texto, dados) {
    parentPort.postMessage({ tipo: 'ok', texto, dados });
}

function erro(texto, sugestao, dados) {
    parentPort.postMessage({ tipo: 'erro', texto, sugestao, dados });
}

function aviso(texto, dados) {
    parentPort.postMessage({ tipo: 'aviso', texto, dados });
}

function json(dados) {
    parentPort.postMessage({ tipo: 'ok', json: true, dados });
}

function sair(sucesso = true) {
    process.exit(sucesso ? 0 : 1);
}

// ==========================================
// HELPERS INTERNOS
// ==========================================

function validarEmail(email) {
    return email && typeof email === 'string' && email.includes('@') && email.includes('.');
}

async function buscarCliente(db, email) {
    const ref = db.collection('clientes_premium').doc(email);
    const doc = await ref.get();
    if (!doc.exists) return { ref, doc: null, dados: null };
    return { ref, doc, dados: doc.data() };
}

function formatarData(val) {
    if (!val) return '—';
    try { return new Date(val).toLocaleString('pt-BR'); } catch { return String(val); }
}

function mascararEmail(email) {
    const [local, dom] = email.split('@');
    return local.substring(0, 2) + '***@' + dom;
}

// ==========================================
// DESPACHO DE COMANDOS
// ==========================================

const { comando, alvo, flags } = workerData || {};
const [entidade, acao] = (comando || '').split(':');

(async () => {
    try {

        // ─────────────────────────────────────────────
        // worker:ping
        // ─────────────────────────────────────────────
        if (entidade === 'worker' && acao === 'ping') {
            const mem = process.memoryUsage();
            const payload = {
                status:      'alive',
                pid:         process.pid,
                node:        process.version,
                heapUsedMb:  (mem.heapUsed / 1024 / 1024).toFixed(1),
                uptimeSecs:  Math.round(process.uptime()),
                comando,
                alvo:        alvo || null,
                flags,
            };
            if (modoJson) json(payload);
            else {
                ok(`Worker vivo — PID ${process.pid} — Node ${process.version}`);
                ok(`Heap: ${payload.heapUsedMb}MB — Uptime: ${payload.uptimeSecs}s`);
                ok(`Comando: ${comando} | Alvo: ${alvo || 'nenhum'} | Flags: ${JSON.stringify(flags)}`);
            }
            sair(true);
            return;
        }

        // ─────────────────────────────────────────────
        // cliente:info <email>
        // ─────────────────────────────────────────────
        if (entidade === 'cliente' && acao === 'info') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js cliente:info email@dominio.com');
                sair(false); return;
            }
            const email = alvo.toLowerCase().trim();
            const { db } = require('../services/firebase');
            const { ref, dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado no Firestore.`,
                     `Verifique se o e-mail está correto ou use: node cli.js cliente:listar`);
                sair(false); return;
            }

            // Busca compilações recentes
            let compilacoes = [];
            try {
                const snap = await ref.collection('compilacoes')
                    .orderBy('criadoEm', 'desc').limit(5).get();
                compilacoes = snap.docs.map(d => {
                    const c = d.data();
                    return {
                        siteName:  c.siteName || '—',
                        preset:    c.colorPreset || '—',
                        tamanhoKb: c.tamanhoBytes ? (c.tamanhoBytes / 1024).toFixed(1) : '—',
                        criadoEm:  formatarData(c.criadoEm),
                    };
                });
            } catch (_) {}

            const payload = {
                email:                 dados.email || email,
                nome:                  dados.nome  || '—',
                plano:                 dados.plano || 'free',
                is_active:             dados.is_active || false,
                is_super_admin:        dados.is_super_admin || false,
                status:                dados.status || '—',
                premium_ate:           formatarData(dados.premium_ate),
                storage_usado_mb:      parseFloat((dados.storage_usado_mb || 0).toFixed(3)),
                tentativas_compilacao: dados.tentativas_compilacao || 0,
                dominios:              dados.dominios || [],
                criado_em:             formatarData(dados.criado_em),
                ultima_atualizacao:    formatarData(dados.ultima_atualizacao),
                ultimas_compilacoes:   compilacoes,
            };

            json(payload);
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // cliente:listar [--plano=premium|free] [--limite=20]
        // ─────────────────────────────────────────────
        if (entidade === 'cliente' && acao === 'listar') {
            const { db } = require('../services/firebase');
            const limite = Math.min(parseInt(flags.limite || flags.n) || 20, 100);
            const filtroPlano = flags.plano || null;

            ok(`Buscando até ${limite} clientes${filtroPlano ? ` (plano: ${filtroPlano})` : ''}...`);

            let query = db.collection('clientes_premium').orderBy('criado_em', 'desc').limit(limite);
            if (filtroPlano) query = query.where('is_active', '==', filtroPlano === 'premium');

            const snap = await query.get();
            const clientes = snap.docs.map(doc => {
                const d = doc.data();
                return {
                    email:       d.email || doc.id,
                    nome:        d.nome  || '—',
                    plano:       d.plano || 'free',
                    is_active:   d.is_active || false,
                    storageMb:   parseFloat((d.storage_usado_mb || 0).toFixed(2)),
                    compilacoes: d.tentativas_compilacao || 0,
                    criado_em:   formatarData(d.criado_em),
                };
            });

            const resumo = {
                total:      clientes.length,
                filtro:     filtroPlano || 'todos',
                premium:    clientes.filter(c => c.is_active).length,
                free:       clientes.filter(c => !c.is_active).length,
                clientes,
            };

            json(resumo);
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // cliente:promover <email> --dias=<n>
        // ─────────────────────────────────────────────
        if (entidade === 'cliente' && acao === 'promover') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js cliente:promover email@dominio.com --dias=30');
                sair(false); return;
            }
            const dias = parseInt(flags.dias) || 30;
            if (dias < 1 || dias > 730) {
                erro('--dias deve estar entre 1 e 730.', 'node cli.js cliente:promover email@test.com --dias=30');
                sair(false); return;
            }

            const email = alvo.toLowerCase().trim();
            ok(`Promovendo ${email} por ${dias} dias...`);

            const { db } = require('../services/firebase');
            const { ref, dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado.`,
                     `Use: node cli.js cliente:listar para ver os e-mails cadastrados`);
                sair(false); return;
            }

            if (dados.is_active) {
                aviso(`${email} já é premium. Expira em: ${formatarData(dados.premium_ate)}`);
            }

            const premiumAte = new Date();
            premiumAte.setDate(premiumAte.getDate() + dias);

            await ref.update({
                is_active:          true,
                plano:              'premium',
                status:             'ativo',
                premium_ate:        premiumAte.toISOString(),
                ultima_atualizacao: new Date().toISOString(),
            });

            ok(`${email} → Premium até ${premiumAte.toLocaleDateString('pt-BR')} (+${dias} dias)`);
            if (modoJson) json({ ok: true, email, premium_ate: premiumAte.toISOString(), dias });
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // cliente:suspender <email>
        // ─────────────────────────────────────────────
        if (entidade === 'cliente' && acao === 'suspender') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js cliente:suspender email@dominio.com');
                sair(false); return;
            }

            const email = alvo.toLowerCase().trim();
            ok(`Suspendendo ${email}...`);

            const { db } = require('../services/firebase');
            const { ref, dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado.`);
                sair(false); return;
            }

            if (!dados.is_active) {
                aviso(`${email} já está inativo (plano: ${dados.plano}).`);
                sair(true); return;
            }

            await ref.update({
                is_active:          false,
                plano:              'free',
                status:             'pendente',
                ultima_atualizacao: new Date().toISOString(),
            });

            ok(`${email} → suspenso. Acesso premium revogado.`);
            if (modoJson) json({ ok: true, email, is_active: false });
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // cliente:deletar <email> --force
        // ─────────────────────────────────────────────
        if (entidade === 'cliente' && acao === 'deletar') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js cliente:deletar email@dominio.com --force');
                sair(false); return;
            }
            if (!flags.force) {
                erro('Operação destrutiva — requer a flag --force.',
                     'node cli.js cliente:deletar email@dominio.com --force');
                sair(false); return;
            }

            const email = alvo.toLowerCase().trim();
            aviso(`DELETANDO permanentemente: ${mascararEmail(email)}`);

            const { db, auth } = require('../services/firebase');
            const { ref, dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado.`);
                sair(false); return;
            }

            // Deleta subcollections (compilacoes) em páginas de 400 — Firestore limita
            // batch a 500 operações por commit.
            let compilacoesRemovidas = 0;
            try {
                const TAMANHO_PAGINA = 400;
                let cursor = null;
                while (true) {
                    let query = ref.collection('compilacoes').limit(TAMANHO_PAGINA);
                    if (cursor) query = query.startAfter(cursor);
                    const snap = await query.get();
                    if (snap.empty) break;

                    const batch = db.batch();
                    snap.docs.forEach(d => batch.delete(d.ref));
                    await batch.commit();
                    compilacoesRemovidas += snap.size;

                    if (snap.size < TAMANHO_PAGINA) break;
                    cursor = snap.docs[snap.docs.length - 1];
                }
            } catch (subErr) {
                aviso(`Erro ao remover subcollection: ${subErr.message}`);
            }

            // Deleta documento principal
            await ref.delete();
            ok(`Firestore: documento ${mascararEmail(email)} removido (+ ${compilacoesRemovidas} compilações)`);

            // Firebase Auth (best-effort)
            try {
                const userRecord = await auth.getUserByEmail(email);
                await auth.deleteUser(userRecord.uid);
                ok(`Firebase Auth: usuário removido (UID: ${userRecord.uid})`);
            } catch (authErr) {
                aviso(`Firebase Auth: ${authErr.code || authErr.message} (Firestore já removido)`);
            }

            if (modoJson) json({ ok: true, email: mascararEmail(email), compilacoesRemovidas });
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // auditoria:historico <email>
        // ─────────────────────────────────────────────
        if (entidade === 'auditoria' && acao === 'historico') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js auditoria:historico email@dominio.com');
                sair(false); return;
            }

            const email = alvo.toLowerCase().trim();
            const limite = Math.min(parseInt(flags.n) || 20, 50);
            ok(`Carregando histórico de ${email} (últimas ${limite} compilações)...`);

            const { db } = require('../services/firebase');
            const { ref, dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado.`);
                sair(false); return;
            }

            const snap = await ref.collection('compilacoes')
                .orderBy('criadoEm', 'desc').limit(limite).get();

            const compilacoes = snap.docs.map(d => {
                const c = d.data();
                return {
                    id:          d.id,
                    siteName:    c.siteName || '—',
                    colorPreset: c.colorPreset || '—',
                    buttonStyle: c.buttonStyle || '—',
                    typography:  c.typography  || '—',
                    gridLayout:  c.gridLayout  || '—',
                    seo:         c.seo || false,
                    tamanhoKb:   c.tamanhoBytes ? (c.tamanhoBytes / 1024).toFixed(1) : '—',
                    modulos:     c.modulosAtivos ? Object.keys(c.modulosAtivos).filter(k => c.modulosAtivos[k]) : [],
                    badges:      c.categoryBadges ? c.categoryBadges.length : 0,
                    criadoEm:    formatarData(c.criadoEm),
                };
            });

            json({
                usuario: {
                    email:                 dados.email || email,
                    nome:                  dados.nome  || '—',
                    plano:                 dados.plano || 'free',
                    is_active:             dados.is_active,
                    storage_usado_mb:      parseFloat((dados.storage_usado_mb || 0).toFixed(2)),
                    tentativas_compilacao: dados.tentativas_compilacao || 0,
                },
                total_compilacoes:   compilacoes.length,
                compilacoes,
            });
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // auditoria:storage <email>
        // ─────────────────────────────────────────────
        if (entidade === 'auditoria' && acao === 'storage') {
            if (!validarEmail(alvo)) {
                erro('E-mail inválido.', 'node cli.js auditoria:storage email@dominio.com');
                sair(false); return;
            }

            const email = alvo.toLowerCase().trim();
            ok(`Consultando storage de ${email}...`);

            const { db, bucket } = require('../services/firebase');
            const { dados } = await buscarCliente(db, email);

            if (!dados) {
                erro(`Usuário "${email}" não encontrado.`);
                sair(false); return;
            }

            let arquivos = [];
            try {
                const [files] = await bucket.getFiles({ prefix: `compilacoes/${email.replace('@', '_at_')}/` });
                arquivos = files.map(f => ({
                    nome:  path.basename(f.name),
                    path:  f.name,
                    bytes: f.metadata.size ? parseInt(f.metadata.size) : null,
                    kb:    f.metadata.size ? (parseInt(f.metadata.size) / 1024).toFixed(1) : '—',
                    criado: f.metadata.timeCreated || '—',
                }));
            } catch (gcsErr) {
                aviso(`GCS inacessível: ${gcsErr.message}`);
            }

            json({
                email,
                storage_usado_mb:  parseFloat((dados.storage_usado_mb || 0).toFixed(3)),
                arquivos_no_gcs:   arquivos.length,
                arquivos,
            });
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // auditoria:erros [--n=50]
        // ─────────────────────────────────────────────
        if (entidade === 'auditoria' && acao === 'erros') {
            const limite = Math.min(parseInt(flags.n) || 50, 200);
            ok(`Buscando últimas ${limite} compilações do sistema para análise...`);

            const { db } = require('../services/firebase');

            // Busca todos os usuários e suas últimas compilações em paralelo
            const usersSnap = await db.collection('clientes_premium')
                .select('email', 'nome', 'tentativas_compilacao')
                .orderBy('criado_em', 'desc')
                .limit(30)
                .get();

            const resumo = {
                usuarios_analisados: usersSnap.size,
                compilacoes_coletadas: 0,
                top_usuarios_por_volume: [],
            };

            const topUsers = usersSnap.docs
                .map(d => ({ email: d.data().email || d.id, total: d.data().tentativas_compilacao || 0 }))
                .sort((a, b) => b.total - a.total)
                .slice(0, 10);

            resumo.top_usuarios_por_volume = topUsers;
            resumo.compilacoes_coletadas   = topUsers.reduce((s, u) => s + u.total, 0);

            json(resumo);
            sair(true); return;
        }

        // ─────────────────────────────────────────────
        // Comando desconhecido
        // ─────────────────────────────────────────────
        erro(
            `Comando desconhecido: "${comando}"`,
            'Execute "node cli.js --help" para ver todos os comandos disponíveis.'
        );
        sair(false);

    } catch (e) {
        erro(
            `Erro inesperado no worker: ${e.message}`,
            'Verifique as variáveis de ambiente e a conexão com Firebase. Use: node cli.js sistema:env',
            { stack: e.stack }
        );
        sair(false);
    }
})();
