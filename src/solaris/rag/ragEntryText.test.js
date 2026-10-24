'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { montarTextoEmbedavel } = require('./ragEntryText');

test('montarTextoEmbedavel junta descricao/componentes/exemplos/boas_praticas/keywords', () => {
    const texto = montarTextoEmbedavel({
        descricao: 'Framework web minimalista em Python.',
        componentes: ['Flask()', '@app.route'],
        exemplos: ['app = Flask(__name__)'],
        boas_praticas: ['Use blueprints pra organizar rotas grandes.'],
        keywords: ['flask', 'python web'],
    });

    assert.match(texto, /Framework web minimalista em Python\./);
    assert.match(texto, /Componentes: Flask\(\), @app\.route\./);
    assert.match(texto, /Exemplos:\napp = Flask\(__name__\)/);
    assert.match(texto, /Boas práticas: Use blueprints/);
    assert.match(texto, /Palavras-chave: flask, python web\./);
});

test('montarTextoEmbedavel omite seções de campos ausentes/vazios', () => {
    const texto = montarTextoEmbedavel({ descricao: 'Só descrição.' });
    assert.equal(texto, 'Só descrição.');
});

test('montarTextoEmbedavel produz string vazia se não houver nenhum campo', () => {
    assert.equal(montarTextoEmbedavel({}), '');
});

test('montarTextoEmbedavel é determinístico -- mesma entrada produz o mesmo texto', () => {
    const entrada = { descricao: 'x', componentes: ['a', 'b'], keywords: ['k'] };
    assert.equal(montarTextoEmbedavel(entrada), montarTextoEmbedavel({ ...entrada }));
});

test('montarTextoEmbedavel rejeita entrada inválida', () => {
    assert.throws(() => montarTextoEmbedavel(null), /objeto/);
    assert.throws(() => montarTextoEmbedavel('x'), /objeto/);
    assert.throws(() => montarTextoEmbedavel([1, 2]), /objeto/);
});
