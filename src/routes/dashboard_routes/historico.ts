import type { AuthGuardHandler } from '../../middlewares/authGuard';
export interface HistoryUser { uid: string; email: string; plano: string }
export interface HistoryRequest {
    session: { user: HistoryUser; wsPreview?: { xmlPath?: string; siteName?: string; compilacaoId?: string; colorPreset?: string; nichoTema?: string } };
    params: { id: string }; query: { from?: unknown };
}
export interface HistoryResponse {
    headersSent: boolean; render(view: string, data: Record<string, unknown>): unknown;
    status(status: number): HistoryResponse; json(body: Record<string, unknown>): unknown;
    send(body: string): unknown; setHeader(name: string, value: string): unknown;
}
type HistoryHandler = (req: HistoryRequest, res: HistoryResponse) => unknown;
interface HistoryRouter {
    get(path: string, middleware: AuthGuardHandler, handler: HistoryHandler): void;
    delete(path: string, middleware: AuthGuardHandler, handler: HistoryHandler): void;
}
interface HistoryRecord {
    arquivo?: string; gcPath?: string; xmlPath?: string; tamanhoBytes?: number; siteName?: string;
    colorPreset?: string; typography?: string; gridLayout?: string; enableSeo?: boolean; seo?: boolean;
    buttonStyle?: string; geradoPorIA?: boolean; nichoTema?: string;
    criadoEm?: { toDate(): Date }; storage_usado_mb?: number;
}
interface HistoryDocument { get(): Promise<HistorySnapshot>; collection(name: string): HistoryCollection; delete(): Promise<unknown> }
interface HistorySnapshot { exists: boolean; id: string; data(): HistoryRecord }
interface HistoryCollection {
    doc(id: string): HistoryDocument; orderBy(field: string, direction: string): HistoryCollection;
    limit(count: number): HistoryCollection; get(): Promise<{ docs: HistorySnapshot[] }>;
}
interface HistoryDatabase {
    collection(name: string): HistoryCollection;
    runTransaction<T>(callback: (transaction: { get(ref: HistoryDocument): Promise<HistorySnapshot>; update(ref: HistoryDocument, data: Record<string, unknown>): unknown }) => Promise<T>): Promise<T>;
}

'use strict';
const express = require('express') as { Router(): HistoryRouter };
const router      = express.Router();
const { exigirLogin } = require('../../middlewares/authGuard') as { exigirLogin: AuthGuardHandler };
const { db, bucket, admin } = require('../../services/firebase') as { db: HistoryDatabase; bucket: import('@google-cloud/storage').Bucket; admin: { firestore: { FieldValue: unknown } } };
const { COLOR_PRESETS, TYPOGRAPHY_PRESETS } = require('../../core/presets') as { COLOR_PRESETS: Record<string, { label: string; primary: string }>; TYPOGRAPHY_PRESETS: Record<string, { label: string }> };
const { STORAGE_LIMITS_MB } = require('../../services/storageService') as typeof import('../../services/storageService');

const FV = admin.firestore.FieldValue;

const GRID_LABELS: Record<string, string> = {
    lista:   'Lista',
    revista: 'Revista',
    mosaico: 'Mosaico',
    coluna:  'Coluna',
};

router.get('/dashboard/historico', exigirLogin, async (req, res) => {
    // O arquivo histórico pertence ao UID autenticado; não listar itens de outros usuários.
    try {
        const user = req.session.user;
        const email = user.email.toLowerCase();
        const snapshot = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').orderBy('criadoEm', 'desc').limit(30).get();
        const prefixo = 'users/' + user.uid + '/';
        const arquivos = snapshot.docs.filter(doc => {
            const data = doc.data();
            return typeof data.gcPath === 'string' && data.gcPath.startsWith(prefixo);
        }).map(doc => {
            const data = doc.data();
            const date = data.criadoEm && typeof data.criadoEm.toDate === 'function'
                ? data.criadoEm.toDate() : null;
            return {
                id: doc.id,
                nome: data.siteName || data.arquivo || 'Template anterior',
                arquivo: data.arquivo || 'template.zip',
                tamanhoBytes: typeof data.tamanhoBytes === 'number' && Number.isSafeInteger(data.tamanhoBytes) && data.tamanhoBytes > 0
                    ? data.tamanhoBytes : 0,
                criadoEm: date && !Number.isNaN(date.getTime())
                    ? date.toLocaleDateString('pt-BR') : 'Data indisponível'
            };
        });
        return res.render('pages/historico-simples', {
            activePage: 'historico', user, arquivos
        });
    } catch (err) {
        console.error('[HISTORICO] Pagina EJS indisponivel:', (err as Error).message);
        return res.status(503).send('Não foi possível carregar seu histórico. Tente novamente.');
    }
});

router.get('/api/historico', exigirLogin, async (req, res) => {
    try {
        const email    = req.session.user.email.toLowerCase();
        const snapshot = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes')
            .orderBy('criadoEm', 'desc')
            .limit(30)
            .get();

        const compilacoes = snapshot.docs.map(doc => {
            const d = doc.data();
            const preset = COLOR_PRESETS[d.colorPreset || ''] || COLOR_PRESETS['tech-blue'];
            const typo   = TYPOGRAPHY_PRESETS[d.typography || ''];

            return {
                id:             doc.id,
                arquivo:        d.arquivo,
                gcPath:         d.gcPath,
                xmlPath:        d.xmlPath || null,
                tamanhoBytes:   d.tamanhoBytes || 0,
                siteName:       d.siteName || 'Sem nome',
                colorPreset:    d.colorPreset || 'tech-blue',
                colorLabel:     preset.label,
                colorHex:       preset.primary,
                typography:     d.typography  || null,
                typographyLabel: typo ? typo.label.split('(')[0].trim() : (d.typography || null),
                gridLayout:     d.gridLayout  || null,
                gridLabel:      GRID_LABELS[d.gridLayout || ''] || d.gridLayout || null,
                enableSeo:      d.enableSeo   || d.seo || false,
                buttonStyle:    d.buttonStyle || null,
                geradoPorIA:    d.geradoPorIA || false,
                criadoEm:       d.criadoEm
                    ? d.criadoEm.toDate().toLocaleDateString('pt-BR', {
                        day: '2-digit', month: '2-digit', year: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })
                    : '—',
                criadoEmISO: d.criadoEm ? d.criadoEm.toDate().toISOString() : null,
            };
        });

        const totalIA         = compilacoes.filter(c => c.geradoPorIA).length;
        const storageLimitMb  = STORAGE_LIMITS_MB[req.session.user.plano] ?? STORAGE_LIMITS_MB.free;

        res.json({ compilacoes, totalIA, storageLimitMb, user: req.session.user });
    } catch (err) {
        console.error('[HISTORICO] API:', (err as Error).message);
        res.status(500).json({ erro: 'Falha ao carregar histórico.', compilacoes: [] });
    }
});

// GET /dashboard/compilacao/:id/download — stream direto do GCS
router.get('/dashboard/compilacao/:id/download', exigirLogin, async (req, res) => {
    const t0  = Date.now();
    const pad = () => new Promise<void>(r => setTimeout(r, Math.max(0, 100 - (Date.now() - t0))));

    try {
        const user  = req.session.user;
        const email = user.email.toLowerCase();
        const doc   = await db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.id).get();

        if (!doc.exists) {
            await pad(); return res.status(404).send('Arquivo não encontrado.');
        }

        const data   = doc.data();
        const gcPath = data.gcPath;

        // Garante que o path pertence ao UID do usuário — bloqueia acesso cruzado
        const prefixoEsperado = `users/${user.uid}/`;
        if (typeof gcPath !== 'string' || !gcPath.startsWith(prefixoEsperado)) {
            console.warn(`[DOWNLOAD] gcPath '${gcPath}' não pertence ao usuário ${user.uid} — bloqueado.`);
            await pad(); return res.status(403).send('Acesso negado.');
        }

        const nomeArquivo = data.arquivo || 'template.zip';
        res.setHeader('Content-Type', 'application/zip');
        res.setHeader('Content-Disposition', `attachment; filename="${nomeArquivo}"`);

        bucket.file(gcPath)
            .createReadStream()
            .on('error', (err) => {
                console.error('[DOWNLOAD]', (err as Error).message);
                if (!res.headersSent) res.status(500).send('Falha ao baixar arquivo.');
            })
            .pipe(res as unknown as NodeJS.WritableStream);

    } catch (err) {
        console.error('[DOWNLOAD]', (err as Error).message);
        if (!res.headersSent) res.status(500).send('Falha ao baixar arquivo. Tente novamente.');
    }
});

router.delete('/dashboard/compilacao/:id', exigirLogin, async (req, res) => {
    try {
        const user    = req.session.user;
        const email   = user.email.toLowerCase();
        const docRef  = db.collection('clientes_premium').doc(email)
            .collection('compilacoes').doc(req.params.id);

        const doc = await docRef.get();
        if (!doc.exists) return res.status(404).json({ erro: 'Compilação não encontrada.' });

        const data    = doc.data();
        const gcPath  = data.gcPath;
        const xmlPath = data.xmlPath;

        // Segurança: o gcPath tem que pertencer ao UID do usuário
        const prefixo = `users/${user.uid}/`;
        if (typeof gcPath !== 'string' || !gcPath.startsWith(prefixo)) {
            return res.status(403).json({ erro: 'Acesso negado.' });
        }

        // Apaga arquivos no GCS (zip + xml)
        const gcsOps = [bucket.file(gcPath).delete({ ignoreNotFound: true })];
        if (xmlPath && typeof xmlPath === 'string' && xmlPath.startsWith(prefixo)) {
            gcsOps.push(bucket.file(xmlPath).delete({ ignoreNotFound: true }));
        }
        await Promise.all(gcsOps);

        // Apaga doc no Firestore
        await docRef.delete();
        console.log(`[HISTORICO] Firestore doc ${req.params.id} deletado.`);

        // Decrementa storage_usado_mb com proteção contra negativo
        const tamanhoMb = (data.tamanhoBytes || 0) / (1024 * 1024);
        if (tamanhoMb > 0) {
            await db.runTransaction(async (tx) => {
                const userRef = db.collection('clientes_premium').doc(email);
                const snap    = await tx.get(userRef);
                if (snap.exists) {
                    const atual = snap.data().storage_usado_mb || 0;
                    tx.update(userRef, { storage_usado_mb: Math.max(0, atual - tamanhoMb) });
                }
            });
        }

        console.log(`[HISTORICO] Compilação ${req.params.id} excluída por ${email}`);
        res.json({ sucesso: true, id: req.params.id });

    } catch (err) {
        console.error('[DELETE-COMPILACAO]', (err as Error).message);
        res.status(500).json({ erro: 'Falha ao excluir. Tente novamente.' });
    }
});

module.exports = router;
