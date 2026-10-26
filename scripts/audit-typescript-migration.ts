// Inventario deterministico da migracao TypeScript.
// Fonte TS autoritativa, executavel em Node com espelho CommonJS.
interface AuditDirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
}
interface AuditFileSystem {
    existsSync(filename: string): boolean;
    readdirSync(directory: string, options: { withFileTypes: true }): AuditDirent[];
    readFileSync(filename: string, encoding: 'utf8'): string;
}
interface AuditPath {
    join(...segments: string[]): string;
    resolve(...segments: string[]): string;
    sep: string;
}
export interface MigrationSummary {
    fontesTypeScript: number;
    espelhosRegistrados: number;
    arquivosJavaScriptSemFonteTs: number;
    arquivosJavaScriptNoNucleo: number;
}
export interface MigrationReport {
    ok: boolean;
    errors: string[];
    summary: MigrationSummary;
    remaining: string[];
}
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: { argv: string[]; exitCode?: number };

const fs = require('node:fs') as AuditFileSystem;
const path = require('node:path') as AuditPath;

const asRepoPath = (p: string): string => p.split(path.sep).join('/');

export function scanFiles(root: string, relative: string = ''): string[] {
    const dir = path.join(root, relative);
    if (!fs.existsSync(dir)) return [];
    const result: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const name = relative ? relative + '/' + entry.name : entry.name;
        if (entry.isDirectory()) result.push(...scanFiles(root, name));
        else if (entry.isFile()) result.push(asRepoPath(name));
    }
    return result.sort();
}

export function auditarMigracao(root: string): MigrationReport {
    const errors: string[] = [];
    const registryFile = path.join(root, 'scripts/typescript-mirror-sources.json');
    const tsconfigFile = path.join(root, 'tsconfig.json');
    const sources: unknown = JSON.parse(fs.readFileSync(registryFile, 'utf8'));
    const config: { include?: unknown } = JSON.parse(fs.readFileSync(tsconfigFile, 'utf8'));
    if (!Array.isArray(sources) || !Array.isArray(config.include)) {
        throw new Error('Registro de espelhos e tsconfig.include precisam ser arrays.');
    }
    // As fontes tipadas cobrem compilador, IA, Solaris, RAG, serviços e scripts de build.
    // Todas precisam estar no registro, no typecheck e possuir espelho CommonJS.
    const rootEntries = ['server.ts', 'server.js', 'cli.ts', 'cli.js'].filter(file => fs.existsSync(path.join(root, file)));
    const auditedFiles = [...rootEntries, ...scanFiles(root, 'src/core'), ...scanFiles(root, 'src/ai'), ...scanFiles(root, 'src/solaris'), ...scanFiles(root, 'src/knowledge'), ...scanFiles(root, 'src/lib'), ...scanFiles(root, 'src/workers'), ...scanFiles(root, 'src/services'), ...scanFiles(root, 'src/middlewares'), ...scanFiles(root, 'src/routes'), ...scanFiles(root, 'src/rag'), ...scanFiles(root, 'scripts')].sort();
    const actualTs = auditedFiles.filter(x => x.endsWith('.ts') && !x.endsWith('.d.ts'));
    const allJs = auditedFiles.filter(x => x.endsWith('.js') && !x.endsWith('.test.js'));
    const seen = new Set<string>();

    for (const source of sources) {
        if (typeof source !== 'string' || !/^(?:(?:server|cli)\.ts|(?:src\/(?:core|ai|solaris|knowledge|lib|workers|services|middlewares|routes|rag)\/|scripts\/)[a-zA-Z0-9_./-]+\.ts)$/.test(source) || source.includes('..')) {
            errors.push('Entrada inválida no registro: ' + JSON.stringify(source));
            continue;
        }
        if (seen.has(source)) errors.push('Fonte duplicada no registro: ' + source);
        seen.add(source);
        if (!actualTs.includes(source)) errors.push('Fonte TS ausente: ' + source);
        if (!config.include.includes(source)) errors.push('Fonte TS fora de tsconfig.include: ' + source);
        const mirror = source.slice(0, -3) + '.js';
        if (!auditedFiles.includes(mirror)) errors.push('Espelho CommonJS ausente: ' + mirror);
    }
    for (const source of actualTs) {
        if (!seen.has(source)) errors.push('Fonte TypeScript não registrada: ' + source);
    }
    const legacyJs = allJs.filter(x => !seen.has(x.slice(0, -3) + '.ts'));
    return {
        ok: errors.length === 0,
        errors,
        summary: {
            fontesTypeScript: actualTs.length,
            espelhosRegistrados: sources.length,
            arquivosJavaScriptSemFonteTs: legacyJs.length,
            arquivosJavaScriptNoNucleo: allJs.length,
        },
        remaining: legacyJs,
    };
}

if (require.main === module) {
    try {
        const result = auditarMigracao(path.resolve(__dirname, '..'));
        if (process.argv.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log('Auditoria de migração: ' +
                result.summary.fontesTypeScript + ' fontes TypeScript, ' +
                result.summary.espelhosRegistrados + ' espelhos CommonJS e ' +
                result.summary.arquivosJavaScriptSemFonteTs + ' arquivos JS legados no núcleo.');
            for (const error of result.errors) console.error('❌ ' + error);
            if (result.ok) console.log('✅ Todas as fontes TS estão registradas, tipadas e possuem espelho.');
        }
        if (!result.ok) process.exitCode = 1;
    } catch (err) {
        console.error('❌ Não foi possível auditar a migração:', (err as Error).message);
        process.exitCode = 1;
    }
}
