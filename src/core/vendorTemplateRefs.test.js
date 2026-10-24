'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASSETS } = require('../../scripts/vendorAssets');
const { verificarReferenciasVendor } = require('../../scripts/vendorTemplateRefs');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'softload-vendor-ejs-'));
const originalError = console.error;
const originalLog = console.log;
const errors = [];
console.error = (...args) => errors.push(args.join(' '));
console.log = () => {};
const template = path.join(root, 'views', 'pages', 'workers', 'health.ejs');
const other = path.join(root, 'views', 'partials', 'footer.ejs');
try {
    assert.equal(verificarReferenciasVendor(root), false, 'views ausente deve falhar');
    fs.mkdirSync(path.dirname(template), { recursive: true });
    fs.mkdirSync(path.dirname(other), { recursive: true });
    for (const asset of ASSETS) {
        const output = path.join(root, 'public', asset.dest);
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, 'asset-publicado');
    }
    fs.writeFileSync(template, [
        '<%# <script src="/vendor/ignorar/comentario.js"></script> %>',
        '<!-- <link href="/vendor/ignorar/html.css"> -->',
        '<link href="/vendor/bootstrap/css/bootstrap.min.css?v=<%= gitSha %>" rel="stylesheet">',
        "<script src='/vendor/chart.js/chart.umd.min.js#cache'></script>",
    ].join('\n'));
    fs.writeFileSync(other, '<script src="/vendor/bootstrap/js/bootstrap.bundle.min.js?v=<%= gitSha %>"></script>');
    assert.equal(verificarReferenciasVendor(root), true, 'referencias CSS e JS devem resolver sem executar EJS');

    fs.writeFileSync(template, '<link href="/vendor/bootstrap/css/bootstrap-inexistente.css">');
    assert.equal(verificarReferenciasVendor(root), false, 'nome desconhecido falha mesmo se arquivo existir');
    assert.ok(errors.some(message => message.includes('health.ejs') && message.includes('nao prevista')));
    fs.writeFileSync(template, '<link href="/vendor/<%= nome %>">');
    assert.equal(verificarReferenciasVendor(root), false, 'nome dinamico nao pode passar sem verificacao');

    fs.writeFileSync(template, '<link href="/vendor/bootstrap/css/bootstrap.min.css">');
    const target = path.join(root, 'public', ASSETS[0].dest);
    fs.rmSync(target);
    assert.equal(verificarReferenciasVendor(root), false, 'arquivo de saida ausente falha');
    assert.ok(errors.some(message => message.includes('arquivo vendor nao encontrado')));
    fs.writeFileSync(target, '');
    assert.equal(verificarReferenciasVendor(root), false, 'arquivo publicado vazio falha');
    fs.writeFileSync(target, 'restaurado');
    assert.equal(verificarReferenciasVendor(root), true);

    fs.writeFileSync(template, '<%# <script src="/vendor/bootstrap/js/bootstrap.bundle.min.js"> %>');
    fs.writeFileSync(other, '<!-- <link href="/vendor/bootstrap/css/bootstrap.min.css"> -->');
    assert.equal(verificarReferenciasVendor(root), false, 'somente comentarios nao contam como referencias');
    assert.ok(errors.some(message => message.includes('Nenhuma referencia /vendor/')));

    fs.rmSync(path.join(root, 'views'), { recursive: true });
    fs.mkdirSync(path.join(root, 'views'));
    assert.equal(verificarReferenciasVendor(root), false, 'views sem templates falha');
    assert.ok(errors.some(message => message.includes('Nenhum template EJS')));
} finally {
    console.error = originalError;
    console.log = originalLog;
    fs.rmSync(root, { recursive: true, force: true });
}
console.log('✅ vendor EJS: referencias existentes, cache-busting, nomes invalidos, arquivos vazios e comentarios');
