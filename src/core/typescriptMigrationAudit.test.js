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
    const aiSource = 'src/blogger/manifestSchema.ts';
    const aiMirror = 'src/blogger/manifestSchema.js';
    write(aiSource, 'export const ENUMS = {menuType: [\'offcanvas\']} as const;');
    write(aiMirror, '"use strict";');
    registry([source, aiSource]);
    config([source, aiSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/blogger deve ser área suportada pela auditoria');
    assert.deepEqual(report.summary, {
        fontesTypeScript: 2, espelhosRegistrados: 2,
        arquivosJavaScriptSemFonteTs: 1, arquivosJavaScriptNoNucleo: 3,
    });
    assert.deepEqual(report.remaining, ['src/core/legado.js']);

    config([source]);
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Fonte TS fora de tsconfig.include: src/blogger/manifestSchema.ts')));
    config([source, aiSource]);
    registry([source, 'src/blogger/../escape.ts']);
    report = auditarMigracao(root);
    assert.match(report.errors.join('\\n'), /Entrada inválida no registro/);
    registry([source, aiSource]);
    // O pacote Solaris também precisa do espelho CommonJS e do typecheck.
    const solarisSource = 'src/lib/newRenderer.ts';
    const solarisMirror = 'src/lib/newRenderer.js';
    write(solarisSource, 'export const valor: number = 10;');
    write(solarisMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Fonte TypeScript não registrada: src/lib')));
    registry([source, aiSource, solarisSource]);
    config([source, aiSource, solarisSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/lib deve ser área suportada pela auditoria');
    assert.equal(report.summary.fontesTypeScript, 3);
    assert.equal(report.summary.arquivosJavaScriptSemFonteTs, 1);
    fs.unlinkSync(path.join(root, solarisMirror));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(error => error.includes('Espelho CommonJS ausente: src/lib')));
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

    // O namespace dos três RAGs vive em src/knowledge e também exige mirror.
    const knowledgeSource = 'src/blogger/nicheCatalog.ts';
    const knowledgeMirror = 'src/blogger/nicheCatalog.js';
    write(knowledgeSource, 'export const RAG_NAMESPACES = {};');
    write(knowledgeMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Fonte TypeScript não registrada: ' + knowledgeSource)));
    registry([source, aiSource, solarisSource, vendorSource, knowledgeSource]);
    config([source, aiSource, solarisSource, vendorSource, knowledgeSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/knowledge deve ser auditado e registrado');
    assert.equal(report.summary.fontesTypeScript, 5);
    fs.unlinkSync(path.join(root, knowledgeMirror));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Espelho CommonJS ausente: ' + knowledgeMirror)));
    write(knowledgeMirror, '"use strict";');
    registry([source, aiSource, solarisSource, vendorSource, 'src/knowledge/../escape.ts']);
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Entrada inválida no registro')));
    registry([source, aiSource, solarisSource, vendorSource, knowledgeSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true);
    // Serviços do backend também exigem fonte TS, registro e espelho.
    const serviceSource = 'src/services/buildInfo.ts';
    const serviceMirror = 'src/services/buildInfo.js';
    write(serviceSource, 'export const gitSha: string = "abc";');
    write(serviceMirror, '"use strict";');
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Fonte TypeScript não registrada: ' + serviceSource)));
    registry([source, aiSource, solarisSource, vendorSource, knowledgeSource, serviceSource]);
    config([source, aiSource, solarisSource, vendorSource, knowledgeSource, serviceSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/services deve ser auditado e registrado');
    assert.equal(report.summary.fontesTypeScript, 6);
    fs.unlinkSync(path.join(root, serviceMirror));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Espelho CommonJS ausente: ' + serviceMirror)));
    write(serviceMirror, '"use strict";');
    config([source, aiSource, solarisSource, vendorSource, knowledgeSource]);
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Fonte TS fora de tsconfig.include: ' + serviceSource)));
    config([source, aiSource, solarisSource, vendorSource, knowledgeSource, serviceSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true);
    // Bibliotecas de preview e workers precisam participar da mesma auditoria,
    // senão o CI aprova a compilação mas rejeita a fonte TS no registro.
    const libSource = 'src/lib/bloggerTemplateRenderer.ts';
    const workerSource = 'src/blogger/scriptValidation.ts';
    write(libSource, 'export const render = () => true;');
    write('src/lib/bloggerTemplateRenderer.js', '"use strict";');
    write(workerSource, 'export const worker = () => true;');
    write('src/blogger/scriptValidation.js', '"use strict";');
    registry([source, aiSource, solarisSource, vendorSource, knowledgeSource, serviceSource, libSource, workerSource]);
    config([source, aiSource, solarisSource, vendorSource, knowledgeSource, serviceSource, libSource, workerSource]);
    report = auditarMigracao(root);
    assert.equal(report.ok, true, 'src/lib e src/workers devem aceitar fontes TS registradas');
    assert.equal(report.summary.fontesTypeScript, 8);
    fs.unlinkSync(path.join(root, 'src/blogger/scriptValidation.js'));
    report = auditarMigracao(root);
    assert.ok(report.errors.some(e => e.includes('Espelho CommonJS ausente: src/blogger/scriptValidation.js')));
    write('src/blogger/scriptValidation.js', '"use strict";');
    report = auditarMigracao(root);
    assert.equal(report.ok, true);
    // Root server/CLI sources are production entry points and obey the same gate.
    const rootRegistry = JSON.parse(fs.readFileSync(path.join(root, 'scripts/typescript-mirror-sources.json'), 'utf8'));
    for (const entry of ['server']) {
        const typed = entry + '.ts', generated = entry + '.js';
        write(typed, 'export interface Entry {}'); write(generated, '"use strict";');
        assert.ok(auditarMigracao(root).errors.some(e => e.includes('Fonte TypeScript não registrada: ' + typed)));
        rootRegistry.push(typed); registry(rootRegistry); config(rootRegistry);
        assert.equal(auditarMigracao(root).ok, true);
        fs.unlinkSync(path.join(root, generated));
        assert.ok(auditarMigracao(root).errors.some(e => e.includes('Espelho CommonJS ausente: ' + generated)));
        write(generated, '"use strict";');
        config(rootRegistry.filter(item => item !== typed));
        assert.ok(auditarMigracao(root).errors.some(e => e.includes('fora de tsconfig.include: ' + typed)));
        config(rootRegistry);
    }
    registry([...rootRegistry, 'unknown-root.ts']);
    assert.ok(auditarMigracao(root).errors.some(e => e.includes('Entrada inválida no registro')));
    registry(rootRegistry); assert.equal(auditarMigracao(root).ok, true);
    console.log('✅ Auditoria TypeScript: registro, tsconfig, espelhos e arquivos legados.');
} finally {
    fs.rmSync(root, {recursive:true,force:true});
}
