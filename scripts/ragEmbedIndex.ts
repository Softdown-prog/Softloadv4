/**
 * Indexador do RAG TÉCNICO do Solaris; não acessa o corpus autoral
 * (`solaris_code_vectors`) nem o RAG de arquivos do Blogger.
 * CLI histórica: npm run rag:embed-index [-- <id1,id2,...>]
 */
import type { RagVectorDb, RagCatalogEntry } from '../src/solaris/rag/ragVectorStore';
import type { RagEmbedEntry } from '../src/solaris/rag/ragEntryText';

export interface IndexEntry extends RagCatalogEntry, RagEmbedEntry { id: string }
export interface IndexResult {
    indexados: string[];
    pulados: { id: string; motivo: string }[];
    erros: { id: string; erro: string }[];
    removidos: OrphanCleanupResult;
}
export interface OrphanCleanupResult { documentos: number; entradas: string[] }
interface VectorDocument { ref: unknown; data(): { entryId: string } }
interface IndexDb extends RagVectorDb {
    collection(name: string): ReturnType<RagVectorDb['collection']> & {
        get(): Promise<{ docs: VectorDocument[] }>;
    };
}
export interface IndexOptions {
    catalogo?: IndexEntry[] | null;
    db: IndexDb;
    gerarEmbeddingsFn?: (params: { textos: string[]; taskType: 'RETRIEVAL_DOCUMENT' }) => Promise<number[][]>;
    idsFiltro?: string[] | null;
}
export interface OrphanCleanupOptions { db: IndexDb; entryIdsAtuais: Set<string> }
interface IndexDeps {
    carregarCatalogo(params: { forcarRecarga: boolean }): IndexEntry[];
    montarTextoEmbedavel(entry: IndexEntry): string;
    chunkarTexto(text: string): string[];
    gerarEmbeddings(params: { textos: string[]; taskType: 'RETRIEVAL_DOCUMENT' }): Promise<number[][]>;
    substituirVetoresDaEntrada(params: { db: RagVectorDb; entrada: IndexEntry; chunks: string[]; embeddings: number[][] }): Promise<unknown>;
    COLECAO: string;
}
declare function require(id: string): unknown;
declare namespace require { const main: unknown }
declare const module: unknown;
declare const process: { argv: string[]; exit(code: number): never };
declare const console: { log(...args: unknown[]): void; error(...args: unknown[]): void };

const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader') as Pick<IndexDeps, 'carregarCatalogo'>;
const { montarTextoEmbedavel } = require('../src/solaris/rag/ragEntryText') as Pick<IndexDeps, 'montarTextoEmbedavel'>;
const { chunkarTexto } = require('../src/solaris/rag/ragChunker') as Pick<IndexDeps, 'chunkarTexto'>;
const { gerarEmbeddings } = require('../src/solaris/rag/ragEmbeddingsClient') as Pick<IndexDeps, 'gerarEmbeddings'>;
const { substituirVetoresDaEntrada, COLECAO } = require('../src/solaris/rag/ragVectorStore') as Pick<IndexDeps, 'substituirVetoresDaEntrada' | 'COLECAO'>;

const TAMANHO_LOTE_REMOVER = 400;

/**
 * A limpeza de órfãos só é permitida após indexação completa e não vazia.
 * Também só consulta a coleção técnica (COLECAO), nunca os outros RAGs.
 */
export async function removerVetoresOrfaos({ db, entryIdsAtuais }: OrphanCleanupOptions): Promise<OrphanCleanupResult> {
    if (!(entryIdsAtuais instanceof Set) || entryIdsAtuais.size === 0) {
        return { documentos: 0, entradas: [] };
    }

    const colecao = db.collection(COLECAO);
    const snapshot = await colecao.get();
    const orfaos = snapshot.docs.filter(doc => !entryIdsAtuais.has(doc.data().entryId));
    if (orfaos.length === 0) return { documentos: 0, entradas: [] };

    for (let inicio = 0; inicio < orfaos.length; inicio += TAMANHO_LOTE_REMOVER) {
        const lote = db.batch();
        for (const doc of orfaos.slice(inicio, inicio + TAMANHO_LOTE_REMOVER)) {
            lote.delete(doc.ref);
        }
        await lote.commit();
    }

    return {
        documentos: orfaos.length,
        entradas: [...new Set(orfaos.map(doc => doc.data().entryId))].sort(),
    };
}

/** Cada entrada é independente: erro de embedding não cancela as demais. */
export async function rodarIndexacao({
    catalogo = null,
    db,
    gerarEmbeddingsFn = gerarEmbeddings,
    idsFiltro = null,
}: IndexOptions): Promise<IndexResult> {
    if (!db) {
        throw new Error('rodarIndexacao: "db" é obrigatório');
    }

    const entradas = (catalogo || carregarCatalogo({ forcarRecarga: true }))
        .filter(entrada => !idsFiltro || idsFiltro.includes(entrada.id));

    const resultado: IndexResult = { indexados: [], pulados: [], erros: [], removidos: { documentos: 0, entradas: [] } };

    for (const entrada of entradas) {
        const texto = montarTextoEmbedavel(entrada);
        const chunks = chunkarTexto(texto);
        if (chunks.length === 0) {
            resultado.pulados.push({ id: entrada.id, motivo: 'texto embedável vazio' });
            continue;
        }

        try {
            const embeddings = await gerarEmbeddingsFn({ textos: chunks, taskType: 'RETRIEVAL_DOCUMENT' });
            await substituirVetoresDaEntrada({ db, entrada, chunks, embeddings });
            resultado.indexados.push(entrada.id);
        } catch (err) {
            resultado.erros.push({ id: entrada.id, erro: (err as Error).message });
        }
    }

    // Indexação filtrada NÃO pode remover vetores fora do filtro.
    if (!idsFiltro) {
        resultado.removidos = await removerVetoresOrfaos({
            db,
            entryIdsAtuais: new Set(entradas.map(entrada => entrada.id).filter(Boolean)),
        });
    }

    return resultado;
}

if (require.main === module) {
    (require('dotenv') as { config(): void }).config();
    const { db } = require('../src/services/firebase') as { db: IndexDb };
    const [, , filtroArg] = process.argv;
    const idsFiltro = filtroArg ? filtroArg.split(',').map(s => s.trim()).filter(Boolean) : null;

    rodarIndexacao({ db, idsFiltro })
        .then(r => {
            console.log(`\n✅ indexados (${r.indexados.length}): ${r.indexados.join(', ') || '-'}`);
            console.log(`⏭️  pulados (${r.pulados.length}): ${r.pulados.map(p => p.id).join(', ') || '-'}`);
            console.log(`🗑️  vetores órfãos removidos (${r.removidos.documentos}): ${r.removidos.entradas.join(', ') || '-'}`);
            if (r.erros.length) {
                console.log(`❌ erros (${r.erros.length}):`);
                for (const e of r.erros) console.log(`   - ${e.id}: ${e.erro}`);
            }
            process.exit(r.erros.length > 0 ? 1 : 0);
        })
        .catch((err: Error) => {
            console.error(`[RAG-EMBED-INDEX] falhou: ${err.message}`);
            process.exit(1);
        });
}
