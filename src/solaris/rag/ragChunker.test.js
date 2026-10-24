'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { chunkarTexto, MAX_PALAVRAS_PADRAO } = require('./ragChunker');

test('chunkarTexto retorna array vazio para texto vazio/só espaço', () => {
    assert.deepEqual(chunkarTexto(''), []);
    assert.deepEqual(chunkarTexto('   \n\t  '), []);
});

test('chunkarTexto retorna 1 chunk quando texto cabe no limite', () => {
    const texto = 'uma frase pequena de teste';
    assert.deepEqual(chunkarTexto(texto, { maxPalavras: 250 }), [texto]);
});

test('chunkarTexto fatia em múltiplos chunks respeitando o limite de palavras', () => {
    const palavras = Array.from({ length: 10 }, (_, i) => `p${i}`);
    const texto = palavras.join(' ');
    const chunks = chunkarTexto(texto, { maxPalavras: 3 });

    assert.equal(chunks.length, 4); // 3+3+3+1
    assert.equal(chunks[0], 'p0 p1 p2');
    assert.equal(chunks[1], 'p3 p4 p5');
    assert.equal(chunks[2], 'p6 p7 p8');
    assert.equal(chunks[3], 'p9');
});

test('chunkarTexto nunca corta uma palavra ao meio', () => {
    const texto = 'palavraumcomprimentoqualquer '.repeat(5).trim();
    const chunks = chunkarTexto(texto, { maxPalavras: 2 });
    for (const chunk of chunks) {
        for (const token of chunk.split(' ')) {
            assert.equal(token, 'palavraumcomprimentoqualquer');
        }
    }
});

test('chunkarTexto normaliza espaços/quebras de linha múltiplas entre palavras', () => {
    const texto = 'a   b\n\nc\td';
    assert.deepEqual(chunkarTexto(texto, { maxPalavras: 250 }), ['a b c d']);
});

test('chunkarTexto usa 250 palavras como default', () => {
    const texto = Array.from({ length: 251 }, (_, i) => `p${i}`).join(' ');
    const chunks = chunkarTexto(texto);
    assert.equal(chunks.length, 2);
    assert.equal(chunks[0].split(' ').length, MAX_PALAVRAS_PADRAO);
    assert.equal(chunks[1], 'p250');
});

test('chunkarTexto rejeita entrada que não é string', () => {
    assert.throws(() => chunkarTexto(null), /deve ser uma string/);
    assert.throws(() => chunkarTexto(42), /deve ser uma string/);
});

test('chunkarTexto rejeita maxPalavras inválido', () => {
    assert.throws(() => chunkarTexto('a', { maxPalavras: 0 }), /inteiro positivo/);
    assert.throws(() => chunkarTexto('a', { maxPalavras: -5 }), /inteiro positivo/);
    assert.throws(() => chunkarTexto('a', { maxPalavras: 1.5 }), /inteiro positivo/);
});
