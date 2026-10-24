/**
 * CLI: npm run rag:organizar.
 * Somente rascunhos válidos e não duplicados são movidos para o catálogo.
 * Pastas e catálogo podem ser injetados para testes sem alterar dados reais.
 */
export interface DraftCandidate {
    arquivo: string;
    foraDeEscopo?: boolean;
    jsonValido?: boolean;
    prontoPraCatalogo?: boolean;
    motivo?: string;
    pastaSugerida: string;
}
export interface RagEntry { id: string; [field: string]: unknown }
export interface OrganizedFile { arquivo: string; destino: string }
export interface RejectedFile { arquivo: string; motivo: string }
export interface OrganizeOptions {
    dirDrafts?: string;
    dirDestino?: string;
    catalogoExistente?: RagEntry[] | null;
}
export interface OrganizeReport {
    movidos: OrganizedFile[];
    rejeitados: RejectedFile[];
    precisamDeCuradoria: RejectedFile[];
}
interface FileOps {
    readFileSync(file: string, encoding: 'utf8'): string;
    mkdirSync(directory: string, options: { recursive: boolean }): unknown;
    writeFileSync(file: string, contents: string, encoding: 'utf8'): unknown;
    unlinkSync(file: string): unknown;
}
interface PathOps { join(...parts: string[]): string }
interface SimilarEntry { entrada: { id: string }; score: number }
interface ValidationResult { ok: boolean; erros: string[] }
declare const __dirname: string;
declare const module: unknown;
declare const process: { exit(code: number): never };
declare const require: ((name: string) => unknown) & { main: unknown };
const fs = require('fs') as FileOps;
const path = require('path') as PathOps;
const { triarDiretorio, PASTA_RASCUNHOS } = require('../src/solaris/workers/ragDraftWorker') as {
    triarDiretorio(options: { dir: string }): DraftCandidate[];
    PASTA_RASCUNHOS: string;
};
const { validarEntradaGerada } = require('../src/solaris/workers/ragKebabWorker') as {
    validarEntradaGerada(entry: RagEntry, options: { idsExistentes: string[] }): ValidationResult;
};
const { encontrarSimilares } = require('../src/solaris/rag/ragDeduplicator') as {
    encontrarSimilares(entry: RagEntry, catalog: RagEntry[]): SimilarEntry[];
};
const { carregarCatalogo } = require('../src/solaris/rag/ragCatalogLoader') as {
    carregarCatalogo(options: { forcarRecarga: boolean }): RagEntry[];
};

/** Faz a triagem determinística, sem inventar ou reescrever receitas. */
export function organizarRascunhos({ dirDrafts, dirDestino, catalogoExistente: catalogoInicial = null }: OrganizeOptions = {}): OrganizeReport {
    const ragDir = dirDestino || path.join(__dirname, '../src/solaris/rag');
    const draftsDir = dirDrafts || path.join(ragDir, PASTA_RASCUNHOS);
    const relatorio = triarDiretorio({ dir: draftsDir });
    const catalogoExistente = [...(catalogoInicial || carregarCatalogo({ forcarRecarga: true }))];

    const movidos: OrganizedFile[] = [];
    const rejeitados: RejectedFile[] = [];
    const precisamDeCuradoria: RejectedFile[] = [];

    for (const item of relatorio) {
        if (item.foraDeEscopo) continue;
        if (!item.jsonValido || !item.prontoPraCatalogo) {
            precisamDeCuradoria.push({ arquivo: item.arquivo, motivo: item.motivo as string });
            continue;
        }
        const caminhoOrigem = path.join(draftsDir, item.arquivo);
        const entrada = JSON.parse(fs.readFileSync(caminhoOrigem, 'utf8')) as RagEntry;
        const idsExistentes = catalogoExistente.map(e => e.id);
        const { ok, erros } = validarEntradaGerada(entrada, { idsExistentes });
        if (!ok) {
            rejeitados.push({ arquivo: item.arquivo, motivo: `reprovado pelo Worker determinístico: ${erros.join(' | ')}` });
            continue;
        }
        const similares = encontrarSimilares(entrada, catalogoExistente);
        if (similares.length > 0) {
            rejeitados.push({
                arquivo: item.arquivo,
                motivo: `parecido demais com entrada já existente: ${similares.map(s => `${s.entrada.id} (${(s.score * 100).toFixed(0)}%)`).join(', ')} — revisão manual antes de mover.`,
            });
            continue;
        }
        const pasta = item.pastaSugerida;
        const destinoDir = path.join(ragDir, pasta);
        fs.mkdirSync(destinoDir, { recursive: true });
        const destinoArquivo = path.join(destinoDir, `${entrada.id}.json`);
        fs.writeFileSync(destinoArquivo, JSON.stringify(entrada, null, 2) + '\n', 'utf8');
        fs.unlinkSync(caminhoOrigem);
        catalogoExistente.push(entrada);
        movidos.push({ arquivo: item.arquivo, destino: `${pasta}/${entrada.id}.json` });
    }
    return { movidos, rejeitados, precisamDeCuradoria };
}

if (require.main === module) {
    const resultado = organizarRascunhos();
    console.log(`\n✅ movidos (${resultado.movidos.length}):`);
    for (const m of resultado.movidos) console.log(`   - ${m.arquivo} -> ${m.destino}`);
    if (resultado.rejeitados.length) {
        console.log(`\n❌ rejeitados, ficaram em drafts/ (${resultado.rejeitados.length}):`);
        for (const r of resultado.rejeitados) console.log(`   - ${r.arquivo}: ${r.motivo}`);
    }
    if (resultado.precisamDeCuradoria.length) {
        console.log(`\n📝 precisam de curadoria manual, ficaram em drafts/ (${resultado.precisamDeCuradoria.length}):`);
        for (const p of resultado.precisamDeCuradoria) console.log(`   - ${p.arquivo}: ${p.motivo}`);
    }
    process.exit(resultado.rejeitados.length > 0 ? 1 : 0);
}
