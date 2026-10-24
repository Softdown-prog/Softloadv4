'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { auditarMigracao } = require('../../scripts/audit-typescript-migration');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-ts-audit-'));
const write = (name, content) => {
    const filename = path.join(root, name);
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    fs.writeFileSync(filename, content);
};
const registry = array => write('scripts/typescript-mirror-sources.json', JSON.stringify(array));
const config = array => write('tsconfig.json', JSON.stringify({include: array}));
const source = 'src/core/modulo.ts';
const mirror = 'src/core/modulo.js';
try {
    write(source, 'export const valor: number = 3;');
    write(mirror, '"use strict";');
    write('src/core/legado.js', 'module.exports = {};');
    registry([source]);
    config([source]);
    let report = auditarMigracao(root);
    assert.equal(report.ok, true);
    assert.deepEqual(report.summary, {
        fontesTypeScript: 1, espelhosRegistrados: 1,
        arquivosJavaScriptSemFonteTs: 1, arquivosJavaScriptNoNucleo: 2,
    });
    assert.deepEqual(report.remaining, ['src/core/legado.js']);
    write('src/core/novo.ts', 'export {}');
    report = auditarMigracao(root);
    assert.equal(report.ok, false);
    assert.match(report.errors.join('\n'), /Fonte TypeScript não registrada/);
    fs.unlinkSync('' + path.join(root, 'src/core/novo.ts'));
    fs.unlinkSync(path.join(root, mirror));
    report = auditarMigracao(root);
    assert.match(report.errors.join('\n'), /Espelho CommonJS ausente/);
    write(mirror, '"use strict";');
    config([]);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\n'), /fora de tsconfig.include/);
    config([source]);
    registry([source, source]);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\n'), /Fonte duplicada/);
    registry([source, '../escape.ts']);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\n'), /Entrada inválida no registro/);
    registry([source, 'src/core/inexistente.ts']);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\n'), /Fonte TS ausente/);
    assert.match(report.errors.join('\n'), /Espelho CommonJS ausente/);
    // O registro cobre também schemas da IA, sem aceitar travessia de diretórios.
    const aiSource = 'src/ai/blueprintSchema.ts';
    const aiMirror = 'src/ai/blueprintSchema.js';
    write(aiSource, 'export const ENUMS = {menuType: [\'offcanvas\']} as const;');
    write(aiMirror, '"use strict";');
    registry([source, aiSource]);
    config([source, aiSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/ai deve ser área suportada pela auditoria');
    assert.deepEqual(report.summary, {
        fontesTypeScript: 2, espelhosRegistrados: 2,
        arquivosJavaScriptSemFonteTs: 1, arquivosJavaScriptNoNucleo: 3,
    });
    assert.deepEqual(report.remaining, ['src/core/legado.js']);

    config([source]);
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Fonte TS fora de tsconfig.include: src/ai/blueprintSchema.ts')));
    config([source, aiSource]);
    registry([source, 'src/ai/../escape.ts']);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\\n'), /Entrada inválida no registro/);
    registry([source, aiSource]);
    // O pacote Solaris também precisa do espelho CommonJS e do typecheck.
    const solarisSource = 'src/solaris/rag/ragChunker.ts';
    const solarisMirror = 'src/solaris/rag/ragChunker.js';
    write(solarisSource, 'export const valor: number = 10;');
    write(solarisMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Fonte TypeScript não registrada: src/solaris')));
    registry([source, aiSource, solarisSource]);
    config([source, aiSource, solarisSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/solaris deve ser área suportada pela auditoria');
    assert.equal(report.summary.fontesTypeScript, 3);
    assert.equal(report.summary.arquivosJavaScriptSemFonteTs, 1);
    fs.unlinkSync(path.join(root, solarisMirror));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Espelho CommonJS ausente: src/solaris')));
    write(solarisMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.equal(report.ok, true);
    // Scripts de build também são fontes TypeScript e exigem mirror no postinstall.
    const vendorSource = 'scripts/vendorAssets.ts';
    const vendorMirror = 'scripts/vendorAssets.js';
    write(vendorSource, 'export const ARQUIVOS = [];');
    write(vendorMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Fonte TypeScript não registrada: scripts/vendorAssets.ts')));
    registry([source, aiSource, solarisSource, vendorSource]);
    config([source, aiSource, solarisSource, vendorSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'scripts/ precisa ser coberto pela auditoria');
    fs.unlinkSync(path.join(root, vendorMirror));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Espelho CommonJS ausente: scripts/vendorAssets.js')));
    write(vendorMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.equal(report.ok, true);
    console.log('✅ Auditoria TypeScript: registro, tsconfig, espelhos e arquivos legados.');
} finally {
    fs.rmSync(root, {recursive:true,force:true});
}
