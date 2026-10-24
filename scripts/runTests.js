"use strict";
// ============================================================
// RUN TESTS — executa cada *.test.js de src/ em processo Node separado.
// O exit code (nao o texto impresso) determina sucesso ou falha.
// ============================================================
Object.defineProperty(exports, "__esModule", { value: true });
exports.encontrarTestes = encontrarTestes;
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
/** Descobre testes recursivamente, sem alterar diretorios nem executa-los. */
function encontrarTestes(dir, out = []) {
    for (const nome of fs.readdirSync(dir)) {
        if (nome === 'node_modules' || nome.startsWith('.'))
            continue;
        const p = path.join(dir, nome);
        const stat = fs.statSync(p);
        if (stat.isDirectory())
            encontrarTestes(p, out);
        else if (nome.endsWith('.test.js'))
            out.push(p);
    }
    return out;
}
/** Entrada CLI historica: um processo Node separado por teste. */
function main() {
    const raiz = path.join(__dirname, '..', 'src');
    const arquivos = encontrarTestes(raiz).sort();
    if (arquivos.length === 0) {
        console.log('Nenhum arquivo *.test.js encontrado em src/.');
        process.exit(0);
    }
    console.log(`Rodando ${arquivos.length} arquivo(s) de teste sob Node ${process.version}...\n`);
    let ok = 0;
    let falhou = 0;
    const falhas = [];
    const t0 = Date.now();
    for (const arquivo of arquivos) {
        const rel = path.relative(process.cwd(), arquivo);
        const inicio = Date.now();
        try {
            execFileSync(process.execPath, [arquivo], { stdio: 'pipe' });
            console.log(`✅ ${rel} (${Date.now() - inicio}ms)`);
            ok++;
        }
        catch (err) {
            console.log(`❌ ${rel} (${Date.now() - inicio}ms)`);
            falhou++;
            const failure = err;
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
if (require.main === module)
    main();
