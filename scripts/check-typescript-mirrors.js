'use strict';

// Node 20 em produção carrega CommonJS .js; as fontes autoritativas são .ts.
// --write atualiza os JS espelhados. Sem --write, falha se estiverem divergentes.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const SOURCES = require('./typescript-mirror-sources.json');
const write = process.argv.includes('--write');
let stale = false;

for (const relative of SOURCES) {
    const input = path.join(ROOT, relative);
    const output = input.replace(/\.ts$/, '.js');
    const compiled = ts.transpileModule(fs.readFileSync(input, 'utf8'), {
        fileName: input,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            newLine: ts.NewLineKind.LineFeed,
        },
        reportDiagnostics: true,
    });
    const errors = (compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (errors.length) {
        console.error(ts.formatDiagnosticsWithColorAndContext(errors, {
            getCanonicalFileName: x => x,
            getCurrentDirectory: () => ROOT,
            getNewLine: () => '\n',
        }));
        process.exitCode = 1;
        continue;
    }
    const current = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
    if (current === compiled.outputText) continue;
    if (write) {
        fs.writeFileSync(output, compiled.outputText, 'utf8');
        console.log(`Atualizado: ${path.relative(ROOT, output)}`);
    } else {
        console.error(`Espelho JS desatualizado: ${path.relative(ROOT, output)} (execute npm run sync:typescript)`);
        if (current !== null) {
            let offset = 0;
            while (offset < Math.min(current.length, compiled.outputText.length)
                && current[offset] === compiled.outputText[offset]) offset++;
            console.error(`  Primeira divergência no índice ${offset}; gerado=${compiled.outputText.length} bytes JS, versionado=${current.length}.`);
            console.error(`  Esperado: ${JSON.stringify(compiled.outputText.slice(Math.max(0, offset - 50), offset + 120))}`);
            console.error(`  Atual:    ${JSON.stringify(current.slice(Math.max(0, offset - 50), offset + 120))}`);
        }
        stale = true;
    }
}
if (stale) process.exitCode = 1;
if (!process.exitCode && !stale) console.log(write ? 'Espelhos JS sincronizados.' : 'Espelhos JS TypeScript verificados.');
