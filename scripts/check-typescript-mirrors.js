"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.verificarEspelhos = verificarEspelhos;
const fs = require('node:fs');
const path = require('node:path');
const ts = require('@typescript/typescript6');
const ROOT = path.resolve(__dirname, '..');
const SOURCES = require('./typescript-mirror-sources.json');
/** Verifica todos os espelhos sem escrever, salvo quando write é explícito. */
function verificarEspelhos({ root = ROOT, sources = SOURCES, write = false, fileSystem = fs, paths = path, compiler = ts, logger = console, } = {}) {
    const updated = [];
    const stale = [];
    const diagnosticsErrors = [];
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
        if (current === compiled.outputText)
            continue;
        if (write) {
            fileSystem.writeFileSync(output, compiled.outputText, 'utf8');
            updated.push(relative);
            logger.log(`Atualizado: ${paths.relative(root, output)}`);
        }
        else {
            logger.error(`Espelho JS desatualizado: ${paths.relative(root, output)} (execute npm run sync:typescript)`);
            if (current !== null) {
                let offset = 0;
                while (offset < Math.min(current.length, compiled.outputText.length)
                    && current[offset] === compiled.outputText[offset])
                    offset++;
                logger.error(`  Primeira divergência no índice ${offset}; gerado=${compiled.outputText.length} bytes JS, versionado=${current.length}.`);
                logger.error(`  Esperado: ${JSON.stringify(compiled.outputText.slice(Math.max(0, offset - 50), offset + 120))}`);
                logger.error(`  Atual:    ${JSON.stringify(current.slice(Math.max(0, offset - 50), offset + 120))}`);
            }
            stale.push(relative);
        }
    }
    const ok = stale.length === 0 && diagnosticsErrors.length === 0;
    if (ok)
        logger.log(write ? 'Espelhos JS sincronizados.' : 'Espelhos JS TypeScript verificados.');
    return { ok, checked: sources.length, updated, stale, diagnosticsErrors };
}
if (require.main === module) {
    const report = verificarEspelhos({ write: process.argv.includes('--write') });
    if (!report.ok)
        process.exitCode = 1;
}
