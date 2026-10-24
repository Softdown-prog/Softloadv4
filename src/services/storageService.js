const archiver = require('archiver');
const admin = require('firebase-admin');
const { bucket, db } = require('./firebase');

// Limite de armazenamento GCS por plano (em MB)
const STORAGE_LIMITS_MB = {
    free:    5,
    starter: 100,
    start:   100, // backward compat
    pro:     100,
    studio:  500,
    premium: 100, // backward compat — usuários com plano='premium' legado
};

function verificarCota(storageMb, tamanhoBytes, limiteMb = 100) {
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
async function reservarCota(email, plano, tamanhoBytesEstimado) {
    const emailKey = (email || '').toLowerCase();
    const snap      = await db.collection('clientes_premium').doc(emailKey).get();
    const storageMb = snap.exists ? (snap.data().storage_usado_mb || 0) : 0;
    const limiteMb  = STORAGE_LIMITS_MB[plano] ?? STORAGE_LIMITS_MB.free;
    verificarCota(storageMb, tamanhoBytesEstimado, limiteMb);

    return {
        async confirmarUso(tamanhoBytesReal) {
            if (!tamanhoBytesReal) return;
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
async function liberarCota(email, tamanhoBytes) {
    if (!tamanhoBytes) return;
    const emailKey = (email || '').toLowerCase();
    await db.collection('clientes_premium').doc(emailKey).set(
        { storage_usado_mb: admin.firestore.FieldValue.increment(-(tamanhoBytes / (1024 * 1024))) },
        { merge: true }
    );
}

function readme(slug) {
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
async function salvarCompilacao(userId, slug, xmlString, manifesto = null) {
    const timestamp     = Date.now();
    const nomeArquivo   = `${timestamp}-${slug}.zip`;
    const gcPath        = `users/${userId}/compilations/${nomeArquivo}`;
    const xmlPath       = `users/${userId}/compilations/${timestamp}-${slug}.xml`;
    const manifestoPath = manifesto ? `users/${userId}/compilations/${timestamp}-${slug}-manifesto.json` : null;
    const file          = bucket.file(gcPath);

    let tamanhoBytes = 0;

    await new Promise((resolve, reject) => {
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
async function carregarManifesto(manifestoPath) {
    const [buf] = await bucket.file(manifestoPath).download();
    return JSON.parse(buf.toString('utf-8'));
}

async function deletarTodosArquivos(userId) {
    await bucket.deleteFiles({ prefix: `users/${userId}/` });
}

module.exports = { STORAGE_LIMITS_MB, verificarCota, reservarCota, liberarCota, salvarCompilacao, carregarManifesto, deletarTodosArquivos };
