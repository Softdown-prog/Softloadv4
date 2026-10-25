'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const { verificarEspelhos } = require('./check-typescript-mirrors.js');

function fixture(t, source = 'export const numero: number = 42;\n') {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-mirror-'));
    t.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.mkdirSync(path.join(root, 'scripts'));
    const relative = 'scripts/exemplo.ts';
    const input = path.join(root, relative);
    const output = input.replace(/\.ts$/, '.js');
    fs.writeFileSync(input, source, 'utf8');
    const expected = ts.transpileModule(source, {
        fileName: input,
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
            newLine: ts.NewLineKind.LineFeed,
        },
        reportDiagnostics: true,
    }).outputText;
    const logs = [];
    const logger = {
        log: x => logs.push(['log', x]),
        error: x => logs.push(['error', x]),
    };
    return {
        root, input, output, expected, logs,
        run: (options = {}) => verificarEspelhos({ root, sources: [relative], logger, ...options }),
    };
}

test('arquivo sincronizado passa na verificação somente leitura', t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, f.expected, 'utf8');
    const result = f.run();
    assert.deepEqual(result, { ok: true, checked: 1, updated: [], stale: [], diagnosticsErrors: [] });
    assert.equal(fs.readFileSync(f.output, 'utf8'), f.expected);
    assert.ok(f.logs.some(([level, message]) => level === 'log' && message.includes('verificados')));
});

test('arquivo divergente falha sem alterá-lo e explica a primeira diferença', t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, 'console.log("antigo")\n', 'utf8');
    const result = f.run();
    assert.equal(result.ok, false);
    assert.deepEqual(result.stale, ['scripts/exemplo.ts']);
    assert.deepEqual(result.updated, []);
    assert.equal(fs.readFileSync(f.output, 'utf8'), 'console.log("antigo")\n');
    assert.ok(f.logs.some(([level, message]) => level === 'error' && message.includes('Primeira divergência')));
    assert.ok(f.logs.some(([level, message]) => level === 'error' && message.includes('sync:typescript')));
});

test('arquivo espelho ausente falha sem criá-lo na verificação', t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.ok, false);
    assert.deepEqual(result.stale, ['scripts/exemplo.ts']);
    assert.equal(fs.existsSync(f.output), false);
});

test('--write restaura somente o arquivo divergente no diretório temporário', t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, 'desatualizado', 'utf8');
    const result = f.run({ write: true });
    assert.deepEqual(result, { ok: true, checked: 1, updated: ['scripts/exemplo.ts'], stale: [], diagnosticsErrors: [] });
    assert.equal(fs.readFileSync(f.output, 'utf8'), f.expected);
    assert.ok(f.logs.some(([level, message]) => level === 'log' && message.includes('Atualizado: scripts/exemplo.js')));
});

test('--write pode criar espelho ausente no diretório temporário', t => {
    const f = fixture(t);
    const result = f.run({ write: true });
    assert.equal(result.ok, true);
    assert.deepEqual(result.updated, ['scripts/exemplo.ts']);
    assert.equal(fs.readFileSync(f.output, 'utf8'), f.expected);
});

test('fonte TypeScript inválida falha e não atualiza espelho mesmo com --write', t => {
    const f = fixture(t, 'export const valor: number = ;\n');
    fs.writeFileSync(f.output, 'preservar', 'utf8');
    const result = f.run({ write: true });
    assert.equal(result.ok, false);
    assert.deepEqual(result.diagnosticsErrors, ['scripts/exemplo.ts']);
    assert.deepEqual(result.updated, []);
    assert.equal(fs.readFileSync(f.output, 'utf8'), 'preservar');
    assert.ok(f.logs.some(([level]) => level === 'error'));
});

test('fontes múltiplas: diagnostica uma falha e continua verificando as outras', t => {
    const f = fixture(t);
    fs.writeFileSync(f.output, f.expected, 'utf8');
    const input2 = path.join(f.root, 'scripts', 'erro.ts');
    fs.writeFileSync(input2, 'const incompleto = ;\n', 'utf8');
    const result = f.run({ sources: ['scripts/erro.ts', 'scripts/exemplo.ts'] });
    assert.equal(result.ok, false);
    assert.equal(result.checked, 2);
    assert.deepEqual(result.diagnosticsErrors, ['scripts/erro.ts']);
    assert.deepEqual(result.stale, []);
    assert.equal(fs.readFileSync(f.output, 'utf8'), f.expected);
});
