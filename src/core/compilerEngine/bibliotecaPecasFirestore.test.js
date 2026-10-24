'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const filename = require.resolve('./bibliotecaPecas');
const source = fs.readFileSync(filename, 'utf8');

// A fronteira Firestore é simulada: nenhuma credencial ou escrita real.
function criarHarness(seed = []) {
    const documents = new Map(seed.map(doc => [doc.id, { ...doc }]));
    const chamadas = { leituras: 0, escritas: [], colecoes: [] };
    let falhaLeitura = false, falhaGravacao = false;
    const marcadorTimestamp = { timestamp: 'servidor' };
    const firebase = {
        db: { collection(name) {
            chamadas.colecoes.push(name);
            return {
                async get() {
                    chamadas.leituras++;
                    if (falhaLeitura) throw new Error('Firestore indisponível para leitura');
                    return { docs: [...documents.values()].map(d => ({ data: () => ({ ...d }) })) };
                },
                doc(id) { return { async set(data) {
                    chamadas.escritas.push({ id, data });
                    if (falhaGravacao) throw new Error('Firestore indisponível para escrita');
                    documents.set(id, { ...data });
                } }; }
            };
        } },
        admin: { firestore: { FieldValue: { serverTimestamp: () => marcadorTimestamp } } }
    };
    const mod = new Module(filename, module);
    mod.filename = filename;
    mod.paths = module.paths;
    mod.require = id => id === '../../services/firebase' ? firebase : require(id);
    mod._compile(source, filename);
    return {
        api: mod.exports, documents, chamadas, marcadorTimestamp,
        erroLeitura(v = true) { falhaLeitura = v; },
        erroGravacao(v = true) { falhaGravacao = v; }
    };
}
(async () => {
    const h = criarHarness([
        { id: 'promo', palavras_chave: ['contagem', 'promocional', 'widget'], nichoOrigem: 'moda', css: '.x{}', embedding: [1], criadoEm: 'antes' },
        { id: 'fraco', palavras_chave: ['vivo'], nichoOrigem: 'tecnologia' }
    ]);
    const r = await h.api.buscarNaBiblioteca('quero contagem promocional na vitrine');
    assert.deepEqual(r, { id: 'promo', nichoOrigem: 'moda', css: '.x{}' }, 'remove apenas metadados internos');
    assert.equal(h.chamadas.colecoes[0], 'pecas_biblioteca');
    assert.equal(await h.api.buscarNaBiblioteca('placar ao vivo'), null, 'uma keyword não basta');
    assert.equal(await h.api.buscarNaBiblioteca('contagem promocional', { excluirNicho: 'moda' }), null);
    assert.equal(await h.api.buscarNaBiblioteca('pedido sem correspondência'), null);

    assert.equal((await h.api.registrarNaBiblioteca(null, 'moda')).ok, false);
    assert.equal((await h.api.registrarNaBiblioteca({ id: 3 }, 'moda')).ok, false);
    assert.equal(h.chamadas.escritas.length, 0, 'dados inválidos não gravam');
    assert.deepEqual(await h.api.registrarNaBiblioteca({ id: 'nova', descricao: 'Widget de notícias' }, 'esporte'), { ok: true, erros: [] });
    assert.equal(h.documents.get('nova').nichoOrigem, 'esporte');
    assert.equal(h.documents.get('nova').criadoEm, h.marcadorTimestamp);
    assert.ok(h.documents.get('nova').palavras_chave.includes('esporte'));
    assert.equal(h.chamadas.escritas[0].id, 'nova');
    await h.api.registrarNaBiblioteca({ id: 'nova', descricao: 'Atualizada' }, null);
    assert.equal(h.documents.get('nova').descricao, 'Atualizada', 'doc id sobrescreve');
    assert.equal(h.documents.get('nova').nichoOrigem, null);

    h.erroGravacao();
    const falha = await h.api.registrarNaBiblioteca({ id: 'perdida' }, 'esporte');
    assert.equal(falha.ok, false);
    assert.match(falha.erros[0], /Firestore indisponível para escrita/);
    assert.equal(h.documents.has('perdida'), false);
    h.erroLeitura();
    const avisos = [];
    const warn = console.warn;
    console.warn = mensagem => avisos.push(mensagem);
    try { assert.equal(await h.api.buscarNaBiblioteca('contagem promocional'), null); }
    finally { console.warn = warn; }
    assert.equal(avisos.length, 1);
    assert.match(avisos[0], /Firestore indisponível para leitura/);

    const kws = h.api._gerarPalavrasChave('Widget de notícias e destaques', 'esporte-mag', 'card-noticias');
    assert.ok(kws.includes('esporte-mag'));
    assert.ok(kws.includes('widget'));
    assert.ok(kws.length <= 20);
    const candidato = h.api._melhorCandidato('contagem promocional', [
        { id: 'a', palavras_chave: ['contagem', 'promocional'] },
        { id: 'b', palavras_chave: ['contagem'] }
    ]);
    assert.equal(candidato.melhor.id, 'a');
    assert.equal(candidato.melhorHits, 2);
    console.log('✅ bibliotecaPecas: Firestore simulado, ranking, filtros, metadados e falhas.');
})().catch(e => { console.error(e); process.exitCode = 1; });
