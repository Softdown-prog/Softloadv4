'use strict';

// ============================================================
// RUN TESTS — executa todo *.test.js sob src/ num único comando
// (`npm test`), em vez de rodar arquivo por arquivo manualmente.
//
// Um processo Node por arquivo — não dá pra só require() tudo no mesmo
// processo: cada teste já termina com process.exit(código), então o
// primeiro arquivo executado mataria o runner antes de chegar no
// segundo. Agrega pass/fail pelo EXIT CODE de cada processo (0 = passou),
// nunca por parsing de texto — os testes não compartilham um formato de
// saída único (alguns imprimem "N passed, M failed", outros "N passaram,
// M falharam"), e o exit code já é o contrato real de cada um.
// ============================================================

const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

function encontrarTestes(dir, out = []) {
    for (const nome of fs.readdirSync(dir)) {
        if (nome === 'node_modules' || nome.startsWith('.')) continue;
        const p = path.join(dir, nome);
        const stat = fs.statSync(p);
        if (stat.isDirectory()) encontrarTestes(p, out);
        else if (nome.endsWith('.test.js')) out.push(p);
    }
    return out;
}

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
    } catch (err) {
        console.log(`❌ ${rel} (${Date.now() - inicio}ms)`);
        falhou++;
        falhas.push({
            rel,
            saida: (err.stdout ? err.stdout.toString() : '') + (err.stderr ? err.stderr.toString() : ''),
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
