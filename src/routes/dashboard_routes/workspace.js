'use strict';
Object.defineProperty(exports, "__esModule", { value: true });
const express = require('express');
const router = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard');
const { db, bucket, admin } = require('../../services/firebase');
const { gerarDiagnostico } = require('../../core/diagnostico');
const { reverterParaVersao } = require('../../core/templateEditWorker');
const { _snapshotDeManifesto } = require('./chat/chatTemplateCompiler');
const { carregarManifesto } = require('../../services/storageService');
// Resolve o manifesto completo de um doc de `compilacoes`: docs antigos ainda
// têm o objeto embutido direto (`manifesto`); docs novos só têm a referência
// pro GCS (`manifestoPath`) — ver storageService.salvarCompilacao/finalizarCompilacao.
async function _resolverManifestoDoDoc(d) {
    if (d.manifesto)
        return d.manifesto;
    if (d.manifestoPath) {
        try {
            return await carregarManifesto(d.manifestoPath);
        }
        catch (errCaught) {
            const err = errCaught;
            console.warn('[WORKSPACE] falha ao carregar manifesto do GCS:', err.message);
            return null;
        }
    }
    return null;
}
const FV = admin.firestore.FieldValue;
// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────
function projetosRef(email) {
    return db.collection('clientes_premium').doc(email).collection('projetos');
}
function sessoesRef(email, projetoId) {
    return projetosRef(email).doc(projetoId).collection('sessoes');
}
function formatarData(ts) {
    if (!ts)
        return '—';
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
}
// ──────────────────────────────────────────────────────────────────────────
// GET /dashboard/workspace
// ──────────────────────────────────────────────────────────────────────────
router.get('/dashboard/workspace', exigirLogin, (req, res) => {
    res.render('pages/react-test', {
        activePage: 'workspace',
        user: req.session.user
    });
});
router.get('/api/workspace/projetos', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const snap = await projetosRef(email)
            .orderBy('criadoEm', 'desc')
            .limit(30)
            .get();
        const projetos = await Promise.all(snap.docs.map(async (doc) => {
            const p = { id: doc.id, ...doc.data() };
            p.criadoEmFmt = formatarData(p.criadoEm);
            const ssSnap = await sessoesRef(email, doc.id)
                .orderBy('criadoEm', 'desc')
                .limit(50)
                .get();
            p.sessoes = ssSnap.docs.map(s => {
                const sd = { id: s.id, ...s.data() };
                sd.criadoEmFmt = formatarData(sd.criadoEm);
                return sd;
            });
            return p;
        }));
        res.json({ projetos });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] GET api:', err.message);
        res.status(500).json({ erro: 'Falha ao carregar projetos.', projetos: [] });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// POST /api/workspace/projetos  → criar projeto
// ──────────────────────────────────────────────────────────────────────────
router.post('/api/workspace/projetos', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { nome } = req.body || {};
        if (!nome || !nome.trim())
            return res.status(400).json({ erro: 'Nome obrigatório.' });
        if (nome.trim().length > 60)
            return res.status(400).json({ erro: 'Nome muito longo (máx. 60 caracteres).' });
        const agora = FV.serverTimestamp();
        const docRef = await projetosRef(email).add({
            nome: nome.trim(),
            criadoEm: agora,
            ultimaAtualizacao: agora,
        });
        res.json({ id: docRef.id, nome: nome.trim() });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] criar projeto:', err.message);
        res.status(500).json({ erro: 'Falha ao criar projeto.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/workspace/projetos/:id  → deletar projeto + sessões
// ──────────────────────────────────────────────────────────────────────────
router.delete('/api/workspace/projetos/:id', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { id } = req.params;
        const ssSnap = await sessoesRef(email, id).get();
        const batch = db.batch();
        ssSnap.docs.forEach(d => batch.delete(d.ref));
        batch.delete(projetosRef(email).doc(id));
        await batch.commit();
        res.json({ ok: true });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] deletar projeto:', err.message);
        res.status(500).json({ erro: 'Falha ao deletar projeto.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// POST /api/workspace/projetos/:pid/sessoes  → criar sessão com snapshot
// ──────────────────────────────────────────────────────────────────────────
router.post('/api/workspace/projetos/:pid/sessoes', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { pid } = req.params;
        const { nome } = req.body || {};
        if (!nome || !nome.trim())
            return res.status(400).json({ erro: 'Nome obrigatório.' });
        if (nome.trim().length > 80)
            return res.status(400).json({ erro: 'Nome muito longo (máx. 80 caracteres).' });
        // Verifica que o projeto pertence ao usuário
        const projetoDoc = await projetosRef(email).doc(pid).get();
        if (!projetoDoc.exists)
            return res.status(404).json({ erro: 'Projeto não encontrado.' });
        // Busca última compilação para snapshot binding
        const cSnap = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(1)
            .get();
        let snapshot = null;
        if (!cSnap.empty) {
            const c = cSnap.docs[0];
            const d = c.data();
            snapshot = {
                compilacaoId: c.id,
                siteName: d.siteName || null,
                colorPreset: d.colorPreset || 'tech-blue',
                typography: d.typography || 'inter',
                gridLayout: d.gridLayout || 'lista',
                nichoTema: d.nichoTema || null,
                xmlPath: d.xmlPath || null,
                gcPath: d.gcPath || null,
                manifesto: await _resolverManifestoDoDoc(d),
                snapshotEm: d.criadoEm || null,
            };
        }
        const agora = FV.serverTimestamp();
        const ssRef = await sessoesRef(email, pid).add({
            nome: nome.trim(),
            snapshot,
            criadoEm: agora,
            chatSessionId: null,
        });
        await projetosRef(email).doc(pid).update({ ultimaAtualizacao: agora });
        // `manifesto` fica só no Firestore (usado pelo chat do Workspace pra
        // editar) — não precisa ir pro cliente, só infla a resposta (pode ter
        // customCss/heroHtml de vários KB) sem nenhum uso na UI de listagem.
        const snapshotFmt = snapshot ? {
            ...snapshot,
            manifesto: undefined,
            snapshotEmFmt: formatarData(snapshot.snapshotEm),
        } : null;
        res.json({ id: ssRef.id, nome: nome.trim(), snapshot: snapshotFmt });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] criar sessão:', err.message);
        res.status(500).json({ erro: 'Falha ao criar sessão.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// DELETE /api/workspace/projetos/:pid/sessoes/:sid
// ──────────────────────────────────────────────────────────────────────────
router.delete('/api/workspace/projetos/:pid/sessoes/:sid', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { pid, sid } = req.params;
        await sessoesRef(email, pid).doc(sid).delete();
        res.json({ ok: true });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] deletar sessão:', err.message);
        res.status(500).json({ erro: 'Falha ao deletar sessão.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// GET /api/workspace/compilacoes  → lista compilações para o seletor de import
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/workspace/compilacoes', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const snap = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(30)
            .get();
        if (snap.empty)
            return res.json([]);
        const lista = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                siteName: d.siteName || 'Template sem nome',
                colorPreset: d.colorPreset || 'tech-blue',
                typography: d.typography || 'inter',
                gridLayout: d.gridLayout || 'lista',
                gcPath: d.gcPath || null,
                xmlPath: d.xmlPath || null,
                geradoPorIA: d.geradoPorIA || false,
                criadoEmFmt: formatarData(d.criadoEm),
            };
        });
        res.json(lista);
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] compilacoes:', err.message);
        res.status(500).json({ erro: 'Falha ao buscar compilações.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// POST /api/workspace/importar  → importa compilação como projeto + sessão
// ──────────────────────────────────────────────────────────────────────────
router.post('/api/workspace/importar', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { compilacaoId } = req.body || {};
        if (!compilacaoId)
            return res.status(400).json({ erro: 'compilacaoId obrigatório.' });
        const cDoc = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(compilacaoId).get();
        if (!cDoc.exists)
            return res.status(404).json({ erro: 'Compilação não encontrada.' });
        const c = cDoc.data();
        const snapshot = {
            compilacaoId,
            siteName: c.siteName || null,
            colorPreset: c.colorPreset || 'tech-blue',
            typography: c.typography || 'inter',
            gridLayout: c.gridLayout || 'lista',
            nichoTema: c.nichoTema || null,
            xmlPath: c.xmlPath || null,
            gcPath: c.gcPath || null,
            manifesto: await _resolverManifestoDoDoc(c),
            snapshotEm: c.criadoEm || null,
        };
        const agora = FV.serverTimestamp();
        const nomeProjeto = (c.siteName || 'Projeto Importado').trim().slice(0, 60);
        const projetoRef = await projetosRef(email).add({
            nome: nomeProjeto,
            criadoEm: agora,
            ultimaAtualizacao: agora,
        });
        const ssRef = await sessoesRef(email, projetoRef.id).add({
            nome: 'Sessão Inicial',
            snapshot,
            criadoEm: agora,
            chatSessionId: null,
        });
        // `manifesto` fica só no Firestore (usado pelo chat do Workspace pra
        // editar) — não precisa ir pro cliente, mesma razão de POST .../sessoes.
        res.json({
            projeto: { id: projetoRef.id, nome: nomeProjeto },
            sessao: {
                id: ssRef.id,
                nome: 'Sessão Inicial',
                snapshot: { ...snapshot, manifesto: undefined, snapshotEmFmt: formatarData(snapshot.snapshotEm) },
                criadoEmFmt: 'agora',
            },
        });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] importar:', err.message);
        res.status(500).json({ erro: 'Falha ao importar compilação.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// GET /api/workspace/snapshot-info  → info da última compilação (para preview)
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/workspace/snapshot-info', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const cSnap = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(1)
            .get();
        if (cSnap.empty)
            return res.json(null);
        const d = cSnap.docs[0].data();
        res.json({
            siteName: d.siteName || null,
            colorPreset: d.colorPreset || 'tech-blue',
            typography: d.typography || 'inter',
            criadoEmFmt: formatarData(d.criadoEm),
        });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] snapshot-info:', err.message);
        res.json(null);
    }
});
// POST /api/workspace/set-preview — salva snapshot na sessão HTTP para preview sem Firestore
router.post('/api/workspace/set-preview', exigirLogin, (req, res) => {
    const user = req.session.user;
    const { xmlPath, gcPath, siteName, colorPreset, nichoTema, compilacaoId } = req.body || {};
    if (!xmlPath || !xmlPath.startsWith(`users/${user.uid}/`)) {
        return res.status(403).json({ erro: 'Acesso negado.' });
    }
    req.session.wsPreview = { xmlPath, gcPath, siteName, colorPreset, nichoTema, compilacaoId };
    res.json({ ok: true });
});
// ──────────────────────────────────────────────────────────────────────────
// GET /api/workspace/diagnostico/:compilacaoId  → Diagnóstico Inteligente
//
// v1 restrito a templates gerados pela própria Softload — lê o XML já
// compilado (mesmo padrão de acesso ao GCS usado em historico.js), roda as
// checagens estáticas (XML/estrutura/semântica/SEO/acessibilidade/
// responsividade) e devolve nota + achados. Não busca nem audita o blog
// "ao vivo" no Blogger — isso exigiria integração com a Blogger API real,
// ausente hoje.
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/workspace/diagnostico/:compilacaoId', exigirLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const email = user.email.toLowerCase();
        const doc = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.compilacaoId).get();
        if (!doc.exists)
            return res.status(404).json({ erro: 'Compilação não encontrada.' });
        const data = doc.data();
        // Fallback para compilações antigas sem xmlPath persistido — mesmo
        // padrão de historico.js (o storageService sempre salvou o XML bruto,
        // só nem sempre persistia o path).
        const xmlPath = data.xmlPath
            || (data.gcPath ? data.gcPath.replace(/\.zip$/, '.xml') : null);
        if (!xmlPath || !xmlPath.startsWith(`users/${user.uid}/`)) {
            return res.status(403).json({ erro: 'Acesso negado.' });
        }
        const [contents] = await bucket.file(xmlPath).download();
        const diagnostico = gerarDiagnostico(contents.toString('utf-8'));
        res.json({
            siteName: data.siteName || 'Template sem nome',
            ...diagnostico,
        });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] diagnostico:', err.message);
        res.status(500).json({ erro: 'Falha ao gerar diagnóstico.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// GET /api/workspace/projetos/:pid/sessoes/:sid/historico
//
// Histórico de versões da sessão — toda compilação (geração inicial via
// [[TEMPLATE:{...}]], edição via chat agêntico, ou revert) já é gravada em
// `compilacoes` por finalizarCompilacao(); esta rota só filtra pelas que
// pertencem a ESTA sessão (wsSessionId, ligado desde a origem — ver
// compilerPipeline.js/templateEditWorker.js). Lista LEVE — sem `manifesto`
// completo, só carregado no momento do revert (ver rota abaixo).
// ──────────────────────────────────────────────────────────────────────────
router.get('/api/workspace/projetos/:pid/sessoes/:sid/historico', exigirLogin, async (req, res) => {
    try {
        const email = req.session.user.email.toLowerCase();
        const { pid, sid } = req.params;
        const sessaoDoc = await sessoesRef(email, pid).doc(sid).get();
        if (!sessaoDoc.exists)
            return res.status(404).json({ erro: 'Sessão não encontrada.' });
        const snap = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .where('wsSessionId', '==', sid)
            .orderBy('criadoEm', 'desc')
            .limit(50)
            .get();
        const ORIGEM_LABEL = { 'chat-pipeline': 'Geração inicial', 'chat-edicao': 'Editado via chat', 'revert': 'Revertido' };
        const versoes = snap.docs.map(doc => {
            const d = doc.data();
            return {
                id: doc.id,
                siteName: d.siteName || 'Template sem nome',
                colorPreset: d.colorPreset || 'tech-blue',
                typography: d.typography || 'inter',
                origem: d.origem || 'chat-pipeline',
                origemLabel: ORIGEM_LABEL[d.origem] || d.origem || 'Compilação',
                resumoMudancas: d.resumoMudancas || null,
                tamanhoBytes: d.tamanhoBytes || 0,
                criadoEmFmt: formatarData(d.criadoEm),
            };
        });
        res.json(versoes);
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] historico:', err.message);
        res.status(500).json({ erro: 'Falha ao buscar histórico de versões.' });
    }
});
// ──────────────────────────────────────────────────────────────────────────
// POST /api/workspace/projetos/:pid/sessoes/:sid/reverter
//
// Reverte a sessão pra uma versão anterior — recompila o manifesto ANTIGO
// tal como estava (reverterParaVersao, sem merge) e grava como o snapshot
// ATUAL da sessão. O revert em si vira mais uma entrada nova no histórico
// (origem:'revert') — nunca apaga nada, mesmo princípio de `git revert`.
// ──────────────────────────────────────────────────────────────────────────
router.post('/api/workspace/projetos/:pid/sessoes/:sid/reverter', exigirLogin, async (req, res) => {
    try {
        const user = req.session.user;
        const email = user.email.toLowerCase();
        const { pid, sid } = req.params;
        const { compilacaoId } = req.body || {};
        if (!compilacaoId)
            return res.status(400).json({ erro: 'compilacaoId obrigatório.' });
        const sessaoRef = sessoesRef(email, pid).doc(sid);
        const sessaoDoc = await sessaoRef.get();
        if (!sessaoDoc.exists)
            return res.status(404).json({ erro: 'Sessão não encontrada.' });
        const versaoDoc = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(compilacaoId).get();
        if (!versaoDoc.exists)
            return res.status(404).json({ erro: 'Versão não encontrada.' });
        const versao = versaoDoc.data();
        // Nunca confia só no id solto — a versão precisa pertencer de fato a
        // ESTA sessão, senão seria possível reverter pra manifesto de outra
        // sessão/projeto só adivinhando um compilacaoId válido do mesmo dono.
        if (versao.wsSessionId !== sid) {
            return res.status(403).json({ erro: 'Essa versão não pertence a esta sessão.' });
        }
        const manifestoAntigo = await _resolverManifestoDoDoc(versao);
        if (!manifestoAntigo) {
            return res.status(422).json({ erro: 'Versão sem manifesto registrado — não é possível reverter (compilação anterior à esta funcionalidade).' });
        }
        const { downloadUrl, xmlPath, gcPath, manifesto } = await reverterParaVersao(manifestoAntigo, user, () => { }, pid, sid);
        const novoSnapshot = _snapshotDeManifesto(downloadUrl, manifesto, xmlPath, gcPath);
        await sessaoRef.update({ snapshot: novoSnapshot, edicaoPendente: admin.firestore.FieldValue.delete() });
        res.json({ downloadUrl, snapshot: { ...novoSnapshot, snapshotEmFmt: 'agora' } });
    }
    catch (errCaught) {
        const err = errCaught;
        console.error('[WORKSPACE] reverter:', err.message);
        res.status(500).json({ erro: 'Falha ao reverter para a versão selecionada.' });
    }
});
module.exports = router;
