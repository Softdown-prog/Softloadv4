/**
 * Verifica que os arquivos CommonJS em produção correspondem exatamente às
 * respectivas fontes TypeScript. --write sincroniza os espelhos divergentes.
 * O próprio verificador participa do registro e verifica seu próprio espelho.
 */
export interface MirrorFileSystem {
    readFileSync(file: string, encoding: 'utf8'): string;
    existsSync(file: string): boolean;
    writeFileSync(file: string, content: string, encoding: 'utf8'): void;
}
export interface MirrorPaths {
    resolve(...parts: string[]): string;
    join(...parts: string[]): string;
    relative(from: string, to: string): string;
}
export interface MirrorDiagnostic { category: number }
export interface MirrorCompiler {
    ModuleKind: { CommonJS: number };
    ScriptTarget: { ES2022: number };
    NewLineKind: { LineFeed: number };
    DiagnosticCategory: { Error: number };
    transpileModule(source: string, options: {
        fileName: string;
        compilerOptions: { module: number; target: number; newLine: number };
        reportDiagnostics: true;
    }): { outputText: string; diagnostics?: MirrorDiagnostic[] };
    formatDiagnosticsWithColorAndContext(diagnostics: MirrorDiagnostic[], host: {
        getCanonicalFileName(file: string): string;
        getCurrentDirectory(): string;
        getNewLine(): string;
    }): string;
}
export interface MirrorLogger {
    log(text: string): void;
    error(text: string): void;
}
export interface MirrorCheckOptions {
    root?: string;
    sources?: readonly string[];
    write?: boolean;
    fileSystem?: MirrorFileSystem;
    paths?: MirrorPaths;
    compiler?: MirrorCompiler;
    logger?: MirrorLogger;
}
export interface MirrorCheckResult {
    ok: boolean;
    checked: number;
    updated: string[];
    stale: string[];
    diagnosticsErrors: string[];
}
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exitCode?: number };

const fs = require('node:fs') as MirrorFileSystem;
const path = require('node:path') as MirrorPaths;
const ts = require('@typescript/typescript6') as MirrorCompiler;
const ROOT = path.resolve(__dirname, '..');
const SOURCES = require('./typescript-mirror-sources.json') as string[];

/** Verifica todos os espelhos sem escrever, salvo quando write é explícito. */
export function verificarEspelhos({
    root = ROOT,
    sources = SOURCES,
    write = false,
    fileSystem = fs,
    paths = path,
    compiler = ts,
    logger = console,
}: MirrorCheckOptions = {}): MirrorCheckResult {
    const updated: string[] = [];
    const stale: string[] = [];
    const diagnosticsErrors: string[] = [];

    for (const relative of sources) {
        const input = paths.join(root, relative);
        const output = input.replace(/\.ts$/, '.js');
        const compiled = compiler.transpileModule(fileSystem.readFileSync(input, 'utf8'), {
            fileName: input,
            compilerOptions: {
                module: compiler.ModuleKind.CommonJS,
                target: compiler.ScriptTarget.ES2022,
                newLine: compiler.NewLineKind.LineFeed,
            },
            reportDiagnostics: true,
        });
        const errors = (compiled.diagnostics || []).filter(d => d.category === compiler.DiagnosticCategory.Error);
        if (errors.length) {
            logger.error(compiler.formatDiagnosticsWithColorAndContext(errors, {
                getCanonicalFileName: x => x,
                getCurrentDirectory: () => root,
                getNewLine: () => '\n',
            }));
            diagnosticsErrors.push(relative);
            continue;
        }
        const current = fileSystem.existsSync(output) ? fileSystem.readFileSync(output, 'utf8') : null;
        if (current === compiled.outputText) continue;
        if (write) {
            fileSystem.writeFileSync(output, compiled.outputText, 'utf8');
            updated.push(relative);
            logger.log(`Atualizado: ${paths.relative(root, output)}`);
        } else {
            logger.error(`Espelho JS desatualizado: ${paths.relative(root, output)} (execute npm run sync:typescript)`);
            if (current !== null) {
                let offset = 0;
                while (offset < Math.min(current.length, compiled.outputText.length)
                    && current[offset] === compiled.outputText[offset]) offset++;
                logger.error(`  Primeira divergência no índice ${offset}; gerado=${compiled.outputText.length} bytes JS, versionado=${current.length}.`);
                logger.error(`  Esperado: ${JSON.stringify(compiled.outputText.slice(Math.max(0, offset - 50), offset + 120))}`);
                logger.error(`  Atual:    ${JSON.stringify(current.slice(Math.max(0, offset - 50), offset + 120))}`);
            }
            stale.push(relative);
        }
    }
    const ok = stale.length === 0 && diagnosticsErrors.length === 0;
    if (ok) logger.log(write ? 'Espelhos JS sincronizados.' : 'Espelhos JS TypeScript verificados.');
    return { ok, checked: sources.length, updated, stale, diagnosticsErrors };
}

if (require.main === module) {
    const report = verificarEspelhos({ write: process.argv.includes('--write') });
    if (!report.ok) process.exitCode = 1;
}
