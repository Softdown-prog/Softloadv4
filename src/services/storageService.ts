import type { Firestore, DocumentReference } from 'firebase-admin/firestore';
import type { Bucket } from '@google-cloud/storage';
import type { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
interface StorageWallet { storage_usado_mb?: number; plano?: string; is_active?: boolean; premium_ate?: string }
export interface QuotaTrackingMutation { ref: DocumentReference; data: Record<string, unknown> | null }
export interface FileQuotaChange { path: string; bytesAntes: number; bytesDepois: number }
export interface QuotaReservation { confirmarUso(bytes: number, confirmationId?: string): Promise<void> }
interface Archive {
    on(event: 'error', listener: (error: Error) => void): unknown;
    pointer(): number; pipe(stream: Writable): unknown;
    append(data: Buffer, options: { name: string }): unknown;
    finalize(): Promise<void>;
}
const archiver = require('archiver') as (format: 'zip', options: { zlib: { level: number } }) => Archive;
const admin = require('firebase-admin') as { firestore: { FieldValue: typeof import('firebase-admin/firestore').FieldValue } };
const { bucket, db } = require('./firebase') as { bucket: Bucket; db: Firestore };
const { currentStorageLimit } = require('./essentialStoragePolicy.cjs') as { currentStorageLimit(account: StorageWallet): number | null };





// Limite de armazenamento GCS por plano (em MB)
export const STORAGE_LIMITS_MB: Readonly<Record<string, number>> = {
    free:    5,
    essencial: 50, // Acesso pago de 30 dias com 50 MiB; só com assinatura ativa
    starter: 100,
    start:   100, // backward compat
    pro:     100,
    studio:  500,
    premium: 100, // backward compat — usuários com plano='premium' legado
};

export function verificarCota(storageMb: number | null | undefined, tamanhoBytes: number, limiteMb = 100): void {
    const limiteBytes = limiteMb * 1024 * 1024;
    const usadoBytes  = (storageMb || 0) * 1024 * 1024;
    if (usadoBytes + tamanhoBytes > limiteBytes) {
        const usadoMb = (usadoBytes / (1024 * 1024)).toFixed(1);
        throw new Error(`Cota de ${limiteMb}MB excedida. Uso atual: ${usadoMb}MB. Exclua compilações antigas no Histórico.`);
    }
}

/**
 * Reserva cota de armazenamento ANTES de gravar algo novo em GCS — lança
 * se a estimativa já não couber no limite do plano (falha cedo, antes de
 * gastar IO gravando). Retorna `{ confirmarUso }`: o chamador invoca isso
 * DEPOIS que a escrita real terminou, com o tamanho REAL gravado (pode
 * diferir da estimativa — ex: compressão de ZIP) — só então o Firestore é
 * debitado.
 *
 * Regra geral do projeto (não específica de compilação): QUALQUER feature
 * que grave algo do usuário em armazenamento durável passa por aqui —
 * mesmo pool de `storage_usado_mb` em `clientes_premium/{email}`, nunca um
 * contador paralelo por feature. Extraído do que já era feito inline em
 * `compilerPipeline.js` — usado também por `chatStorageService.js`
 * (sessões/memória de chat no GCS, que antes não descontavam nada).
 *
 * Cota é enforçada pra todo mundo, inclusive assinante ativo — diferente
 * de crédito de IA (que é só contador de analytics pra quem já paga):
 * armazenamento tem custo real de infra independente do plano.
 *
 * @param {string} email
 * @param {string} plano
 * @param {number} tamanhoBytesEstimado
 * @returns {Promise<{ confirmarUso: (tamanhoBytesReal: number) => Promise<void> }>}
 */
export async function reservarCota(email: string, plano: string, tamanhoBytesEstimado: number, operacaoId?: string): Promise<QuotaReservation> {
    const emailKey = (email || '').toLowerCase();
    const snap      = await db.collection('clientes_premium').doc(emailKey).get();
    const storageMb = snap.exists ? ((snap.data() as StorageWallet).storage_usado_mb || 0) : 0;
    const conta = snap.exists ? (snap.data() as StorageWallet) : {};
    const limiteMb = conta.plano === 'essencial' || plano === 'essencial'
        ? currentStorageLimit(conta) ?? STORAGE_LIMITS_MB.free
        : STORAGE_LIMITS_MB[plano] ?? STORAGE_LIMITS_MB.free;
    verificarCota(storageMb, tamanhoBytesEstimado, limiteMb);

    return {
        async confirmarUso(tamanhoBytesReal: number, confirmacaoId = operacaoId) {
            if (!tamanhoBytesReal) return;
            // Compilations learn their stable Firestore ID only after upload.
            // A confirmation-scoped key keeps the initial quota preflight unchanged.
            if (confirmacaoId !== undefined) {
                await movimentarCotaIdempotente(emailKey, tamanhoBytesReal, confirmacaoId, { limiteMb });
                return;
            }
            await db.collection('clientes_premium').doc(emailKey).set(
                { storage_usado_mb: admin.firestore.FieldValue.increment(tamanhoBytesReal / (1024 * 1024)) },
                { merge: true }
            );
        },
    };
}

/**
 * Libera cota de armazenamento — decremento simétrico ao `confirmarUso()`
 * de `reservarCota()`, usado quando algo persistido é apagado de
 * propósito (ex.: TTL de projeto Solaris expirado, substituição de um
 * projeto por um upload novo). Mesmo pool `storage_usado_mb` de sempre —
 * sem isso, cota liberada por deleção nunca voltava pro usuário, mesmo
 * gap que existia silenciosamente em `deletarTodosArquivos()`.
 *
 * @param {string} email
 * @param {number} tamanhoBytes
 */
/**
 * Registrado no mesmo commit Firestore que atualiza o saldo. Recibos devem
 * permanecer: expirarlos permitiria aplicar o mesmo credito ou debito novamente.
 */
async function movimentarCotaIdempotente(emailKey: string, deltaBytes: number, operacaoId: string, { limiteMb, trackingMutacao }: { limiteMb?: number; trackingMutacao?: QuotaTrackingMutation } = {}) {
    if (typeof operacaoId !== 'string' || operacaoId.length === 0 || operacaoId.length > 512) {
        throw new TypeError('Operacao de cota sem identificador valido.');
    }
    if (!Number.isSafeInteger(deltaBytes)) throw new RangeError('Cota deve usar bytes inteiros.');
    const hash = createHash('sha256').update(JSON.stringify([emailKey, operacaoId])).digest('hex');
    const opRef = db.collection('storage_cota_operacoes').doc(hash);
    const userRef = db.collection('clientes_premium').doc(emailKey);
    return db.runTransaction(async tx => {
        const prior = await tx.get(opRef);
        if (prior.exists) {
            if (prior.data()!.deltaBytes !== deltaBytes) throw new Error('Recibo reutilizado com quantidade diferente.');
            return { aplicada: false };
        }
        const user = await tx.get(userRef);
        if (deltaBytes > 0 && limiteMb !== undefined) {
            const atual = user.exists ? (user.data() as StorageWallet) : {};
            const tetoAtual = atual.plano === 'essencial' || limiteMb === STORAGE_LIMITS_MB.essencial
                ? currentStorageLimit(atual) ?? STORAGE_LIMITS_MB.free : limiteMb;
            verificarCota(atual.storage_usado_mb || 0, deltaBytes, tetoAtual);
        }
        if (deltaBytes !== 0) tx.set(userRef, {
            storage_usado_mb: admin.firestore.FieldValue.increment(deltaBytes / (1024 * 1024))
        }, { merge: true });
        if (trackingMutacao) {
            if (trackingMutacao.data === null) tx.delete(trackingMutacao.ref);
            else tx.set(trackingMutacao.ref, trackingMutacao.data);
        }
        tx.create(opRef, { deltaBytes, criadoEm: admin.firestore.FieldValue.serverTimestamp(), origem: 'solaris' });
        return { aplicada: true };
    });
}

export async function liberarCota(email: string, tamanhoBytes: number, operacaoId?: string, trackingMutacao?: QuotaTrackingMutation) {
    if (!tamanhoBytes && !trackingMutacao) return;
    const emailKey = (email || '').toLowerCase();
    if (operacaoId !== undefined) {
        await movimentarCotaIdempotente(emailKey, -(tamanhoBytes || 0), operacaoId, { trackingMutacao });
        return;
    }
    if (trackingMutacao) throw new Error('Mutacao atomica exige identificador idempotente.');
    await db.collection('clientes_premium').doc(emailKey).set(
        { storage_usado_mb: admin.firestore.FieldValue.increment(-(tamanhoBytes / (1024 * 1024))) },
        { merge: true }
    );
}


/**
 * Quota do chat: each GCS object has a persisted byte baseline.
 * The first rewrite of a legacy object credits/debits ONLY its difference,
 * preserving the existing (possibly inflated) aggregate balance.
 *
 * All per-object state and the user's balance commit atomically, so an ACK
 * lost after commit cannot double-charge a replay of the same objects.
 * Callers MUST serialize writes to these paths across processes.
 */
export async function reconciliarCotaArquivos(email: string, plano: string, uid: string, alteracoes: FileQuotaChange[], { apenasCreditosRastreados = false }: { apenasCreditosRastreados?: boolean } = {}) {
    const emailKey = (email || '').toLowerCase();
    if (!emailKey || typeof uid !== 'string' || !uid || !Array.isArray(alteracoes) || alteracoes.length === 0) {
        throw new TypeError('Reconciliacao de quota exige email, uid e arquivos.');
    }
    const seen = new Set();
    const items = alteracoes.map(({ path, bytesAntes, bytesDepois }) => {
        if (typeof path !== 'string' || !path.startsWith(`users/${uid}/`) ||
            path.includes('..') || seen.has(path) ||
            !Number.isSafeInteger(bytesAntes) || bytesAntes < 0 ||
            !Number.isSafeInteger(bytesDepois) || bytesDepois < 0) {
            throw new TypeError('Arquivo ou tamanho de quota invalido.');
        }
        seen.add(path);
        const id = createHash('sha256').update(JSON.stringify([emailKey, uid, path])).digest('hex');
        return { path, bytesAntes, bytesDepois, ref: db.collection('storage_cota_arquivos').doc(id) };
    });
    const userRef = db.collection('clientes_premium').doc(emailKey);
    return db.runTransaction(async tx => {
        // All reads precede any write, as required by Firestore transactions.
        const snapshots = await Promise.all(items.map(item => tx.get(item.ref)));
        const user = await tx.get(userRef);
        const deltaBytes = items.reduce((sum, item, i) => {
            const antigo = snapshots[i].exists ? snapshots[i].data()!.bytes : item.bytesAntes;
            if (!Number.isSafeInteger(antigo) || antigo < 0) {
                throw new Error('Registro de cota com tamanho invalido.');
            }
            const delta = item.bytesDepois - antigo;
            // Legacy files without a tracked baseline may already be overcharged.
            // A deletion must never grant guessed credit for those old bytes.
            return sum + (apenasCreditosRastreados && !snapshots[i].exists && delta < 0 ? 0 : delta);
        }, 0);
        if (!Number.isSafeInteger(deltaBytes)) throw new RangeError('Diferenca de armazenamento fora do limite.');
        const oldMb = user.exists ? ((user.data() as StorageWallet).storage_usado_mb || 0) : 0;
        const currentAccount = user.exists ? (user.data() as StorageWallet) : {};
        const limit = currentAccount.plano === 'essencial' || plano === 'essencial'
            ? currentStorageLimit(currentAccount) ?? STORAGE_LIMITS_MB.free
            : STORAGE_LIMITS_MB[plano] ?? STORAGE_LIMITS_MB.free;
        if (deltaBytes > 0) verificarCota(oldMb, deltaBytes, limit);
        if (deltaBytes !== 0) {
            tx.set(userRef, { storage_usado_mb: Math.max(0, oldMb + deltaBytes / (1024 * 1024)) }, { merge: true });
        }
        for (const item of items) {
            tx.set(item.ref, {
                uid, path: item.path, bytes: item.bytesDepois,
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        }
        return { deltaBytes };
    });
}


function readme(slug: string): string {
    return (
        `Softload Engine — Template Compilado\n` +
        `Gerado em: ${new Date().toISOString()}\n\n` +
        `Como instalar:\n` +
        `1. Acesse o Blogger → Tema → Personalizar → Editar HTML\n` +
        `2. Selecione todo o conteúdo e cole o arquivo ${slug}.xml\n` +
        `3. Salve o tema\n`
    );
}

/**
 * Compila o XML em um ZIP e envia para o GCS via stream.
 * Também salva o XML bruto separadamente para uso no preview, e o
 * manifesto completo (se fornecido) como um JSON à parte — mesmo padrão
 * do XML: cada compilação/versão grava seu próprio arquivo, nunca
 * sobrescreve uma versão anterior. O Firestore guarda só o `manifestoPath`
 * (referência), não o objeto inteiro — histórico de versões sem limite
 * de retenção não deve acumular blobs de manifesto indefinidamente numa
 * coleção Firestore; o GCS já é o armazenamento de longo prazo por versão,
 * com a cota de storage do plano cobrindo esse crescimento.
 * tamanhoBytes contabiliza o ZIP + o manifesto.json (quando houver) — o
 * XML bruto separado NÃO entra na conta (mesmo comportamento de antes).
 */
export async function salvarCompilacao(userId: string, slug: string, xmlString: string, manifesto: Record<string, unknown> | null = null) {
    const timestamp     = Date.now();
    const nomeArquivo   = `${timestamp}-${slug}.zip`;
    const gcPath        = `users/${userId}/compilations/${nomeArquivo}`;
    const xmlPath       = `users/${userId}/compilations/${timestamp}-${slug}.xml`;
    const manifestoPath = manifesto ? `users/${userId}/compilations/${timestamp}-${slug}-manifesto.json` : null;
    const file          = bucket.file(gcPath);

    let tamanhoBytes = 0;

    await new Promise<void>((resolve, reject) => {
        const gcsStream = file.createWriteStream({
            metadata: { contentType: 'application/zip' },
            resumable: false,
        });
        const archive = archiver('zip', { zlib: { level: 6 } });

        archive.on('error', reject);
        gcsStream.on('error', reject);
        gcsStream.on('finish', () => {
            tamanhoBytes = archive.pointer();
            resolve();
        });

        archive.pipe(gcsStream);
        archive.append(Buffer.from(xmlString, 'utf-8'), { name: `${slug}.xml` });
        archive.append(Buffer.from(readme(slug), 'utf-8'), { name: 'README.txt' });
        archive.finalize();
    });

    // XML bruto separado para o preview — tamanhoBytes não inclui este arquivo
    await bucket.file(xmlPath).save(Buffer.from(xmlString, 'utf-8'), {
        metadata: { contentType: 'text/xml; charset=utf-8' },
        resumable: false,
    });

    if (manifestoPath) {
        const manifestoBuf = Buffer.from(JSON.stringify(manifesto), 'utf-8');
        await bucket.file(manifestoPath).save(manifestoBuf, {
            metadata: { contentType: 'application/json; charset=utf-8' },
            resumable: false,
        });
        tamanhoBytes += manifestoBuf.byteLength;
    }

    return { gcPath, xmlPath, manifestoPath, nomeArquivo, tamanhoBytes };
}

/**
 * Lê de volta um manifesto salvo via salvarCompilacao (manifestoPath).
 * Usado pelo Histórico de Versões do Workspace (revert, seed de sessão
 * nova a partir da última compilação, importação) — só quando o manifesto
 * não está mais embutido direto no doc do Firestore (compilações antigas,
 * de antes desta função existir, ainda têm `manifesto` no próprio doc;
 * essas continuam lidas direto, sem passar por aqui).
 */
export async function carregarManifesto(manifestoPath: string): Promise<unknown> {
    const [buf] = await bucket.file(manifestoPath).download();
    return JSON.parse(buf.toString('utf-8'));
}

export async function deletarTodosArquivos(userId: string) {
    await bucket.deleteFiles({ prefix: `users/${userId}/` });
}
