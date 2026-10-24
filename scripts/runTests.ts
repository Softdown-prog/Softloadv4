// ============================================================
// RUN TESTS — executa cada *.test.js de src/ em processo Node separado.
// O exit code (nao o texto impresso) determina sucesso ou falha.
// ============================================================

interface TestDirentStat { isDirectory(): boolean }
interface TestFileSystem {
    readdirSync(directory: string): string[];
    statSync(filename: string): TestDirentStat;
}
interface TestPath {
    join(...segments: string[]): string;
    relative(from: string, to: string): string;
}
interface TestChildProcess {
    execFileSync(command: string, args: string[], options: { stdio: 'pipe' }): unknown;
}
interface ProcessFailure {
    stdout?: { toString(): string };
    stderr?: { toString(): string };
}
declare const __dirname: string;
declare const module: unknown;
declare const require: ((id: string) => unknown) & { main: unknown };
declare const process: {
    version: string;
    execPath: string;
    cwd(): string;
    exit(code: number): never;
};

const { execFileSync } = require('child_process') as TestChildProcess;
const path = require('path') as TestPath;
const fs = require('fs') as TestFileSystem;

/** Descobre testes recursivamente, sem alterar diretorios nem executa-los. */
export function encontrarTestes(dir: string, out: string[] = []): string[] {
    for (const nome of fs.readdirSync(dir)) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue;
        const p = path.join(dir, nome);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) encontrarTestes(p, out);
        else if (nome.endsWith('.test.js')) out.push(p);
    }
    return out;
}

/** Entrada CLI historica: um processo Node separado por teste. */
function main(): void {
    const raiz = path.join(__dirname, '..', 'src');
    const arquivos = encontrarTestes(raiz).sort();

    if (arquivos.length === 0) {
        console.log('Nenhum arquivo *.test.js encontrado em src/.');
        process.exit(0);
    }

    console.log(`Rodando ${arquivos.length} arquivo(s) de teste sob Node ${process.version}...\n`);

    let ok = 0;
    let falhou = 0;
    const falhas: { rel: string; saida: string }[] = [];
    const t0 = Date.now();

    for (const arquivo of arquivos) {
        const rel = path.relative(process.cwd(), arquivo);
        const inicio = Date.now();
        try {
            execFileSync(process.execPath, [arquivo], { stdio: 'pipe' });
            console.log(`✅ ${rel} (${Date.now() - inicio}ms)`);
            ok++;
        } catch (err) {
            console.log(`❌ ${rel} (${Date.now() - inicio}ms)`);
            falhou++;
            const failure = err as ProcessFailure;
            falhas.push({
                rel,
                saida: (failure.stdout ? failure.stdout.toString() : '') +
                    (failure.stderr ? failure.stderr.toString() : ''),
            });
        }
    }

    console.log(`\n${'─'.repeat(60)}`);
    console.log(`${falhou === 0 ? '✅' : '❌'} ${ok}/${arquivos.length} arquivos passaram — ${Date.now() - t0}ms total`);

    if (falhas.length) {
        console.log(`\n${falhas.length} arquivo(s) com falha:\n`);
        for (const f of falhas) {
            console.log(`── ${f.rel} ${'─'.repeat(Math.max(0, 56 - f.rel.length))}`);
            console.log(f.saida.trim());
            console.log();
        }
    }

    process.exit(falhou === 0 ? 0 : 1);
}

if (require.main === module) main();
