/**
 * npm run compile:batch -- [--dir=manifests] [--out=dist/compiled]
 * npm run compile:batch:pkg -- [--dir=manifests] [--out=dist/compiled]
 *
 * CLI sobre o compilador existente: preserva erros isolados por manifesto,
 * nomes .xml e os dois aliases npm sem adicionar novo pipeline.
 */
interface BatchFileSystem {
    existsSync(filename: string): boolean;
    statSync(filename: string): { isDirectory(): boolean };
    readdirSync(directory: string): string[];
    mkdirSync(directory: string, options: { recursive: true }): unknown;
    readFileSync(filename: string, encoding: 'utf8'): string;
    writeFileSync(filename: string, data: string, encoding: 'utf8'): void;
}
interface BatchPath {
    join(...parts: string[]): string;
    basename(filename: string, extension?: string): string;
    resolve(...parts: string[]): string;
}
export interface BatchParams { readonly dir: string; readonly outDir: string }
export interface BatchCompiled { readonly manifesto: string; readonly saida: string }
export interface BatchError { readonly manifesto: string; readonly erro: string }
export interface BatchResult {
    readonly compilados: BatchCompiled[];
    readonly erros: BatchError[];
}
declare const module: unknown;
declare const require: ((name: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exit(status: number): never };
const fs = require('fs') as BatchFileSystem;
const path = require('path') as BatchPath;
const { executarCompilacao } = require('../src/core/compilerWorker') as {
    executarCompilacao(manifesto: unknown, options?: {telemetry?: boolean}): { xmlFinal: string };
};

function parseArg(args: readonly string[], nome: string, padrao: string): string {
    const prefixo = `--${nome}=`;
    const encontrado = args.find((a) => a.startsWith(prefixo));
    return encontrado ? encontrado.slice(prefixo.length) : padrao;
}

/** Compila manifestos JSON em XML, sem interromper o lote em caso de erro individual. */
export function compilarLote({ dir, outDir }: BatchParams): BatchResult {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
        throw new Error(`Diretório de manifestos não encontrado: ${dir}`);
    }

    const arquivos = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
    const compilados: BatchCompiled[] = [];
    const erros: BatchError[] = [];

    if (arquivos.length === 0) {
        return { compilados, erros };
    }

    fs.mkdirSync(outDir, { recursive: true });

    for (const nome of arquivos) {
        const caminhoManifesto = path.join(dir, nome);
        try {
            const manifesto: unknown = JSON.parse(fs.readFileSync(caminhoManifesto, 'utf8'));
            const { xmlFinal } = executarCompilacao(manifesto, {telemetry:false});
            const caminhoSaida = path.join(outDir, `${path.basename(nome, '.json')}.xml`);
            fs.writeFileSync(caminhoSaida, xmlFinal, 'utf8');
            compilados.push({ manifesto: nome, saida: caminhoSaida });
        } catch (err) {
            erros.push({ manifesto: nome, erro: (err as Error).message });
        }
    }

    return { compilados, erros };
}

function main(): void {
    const args = process.argv.slice(2);
    const dir = path.resolve(parseArg(args, 'dir', 'manifests'));
    const outDir = path.resolve(parseArg(args, 'out', 'dist/compiled'));

    let resultado: BatchResult;
    try {
        resultado = compilarLote({ dir, outDir });
    } catch (err) {
        console.error(`[COMPILE-BATCH] falhou: ${(err as Error).message}`);
        process.exit(1);
        return;
    }

    const { compilados, erros } = resultado;
    if (compilados.length === 0 && erros.length === 0) {
        console.log(`Nenhum manifesto (*.json) encontrado em ${dir}`);
        process.exit(0);
        return;
    }

    console.log(`\n✅ compilados (${compilados.length}):`);
    for (const c of compilados) console.log(`   - ${c.manifesto} -> ${c.saida}`);

    if (erros.length) {
        console.log(`\n❌ erros (${erros.length}):`);
        for (const e of erros) console.log(`   - ${e.manifesto}: ${e.erro}`);
    }

    process.exit(erros.length > 0 ? 1 : 0);
}

if (require.main === module) main();
