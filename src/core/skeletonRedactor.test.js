'use strict';
const assert = require('node:assert/strict');
const { redigirDadosReais } = require('./skeletonRedactor');
const sample = '<img src="https://blogger.googleusercontent.com/img/a/b"/>' +
    '<a href="https://example-site.blogspot.com/p/abc">X</a>' +
    '<setting name="twitterUsername">usuario</setting>';
const result = redigirDadosReais(sample);
assert.ok(result.xml.includes('https://placehold.co/800x450'));
assert.ok(result.xml.includes('https://seu-blog.blogspot.com/p/abc'));
assert.ok(!result.xml.includes('example-site.blogspot.com'));
assert.ok(result.xml.includes('twitterUsername'));
assert.ok(result.achados.some(x => x.includes('URL(s) de imagem')));
assert.ok(result.achados.some(x => x.includes('revisar manualmente')));
assert.deepEqual(redigirDadosReais('<html/>'), { xml: '<html/>', achados: [] });
console.log('✅ skeletonRedactor: dados reais omitidos e settings sinalizados');
