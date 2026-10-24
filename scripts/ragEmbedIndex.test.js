'use strict';

/**
 * Testes de scripts/ragEmbedIndex.js (rodarIndexacao) — catálogo e
 * gerarEmbeddingsFn fakes injetados (nunca bate na API real nem no
 * Firestore real, usa __testUtils__/fakeFirestore.js). Mesmo padrão de
 * scripts/ragGenerate.test.js — não faz parte de `npm test`
 * (scripts/ fica fora do scan de scripts/runTests.js), roda manual:
 *
 * Execute: node scripts/ragEmbedIndex.test.js
 */

const { rodarIndexacao } = require('./ragEmbedIndex');
const { criarFakeFirestore } = require('../src/solaris/rag/__testUtils__/fakeFirestore');
const { COLECAO } = require('../src/solaris/rag/ragVectorStore');

let passed = 0;
let failed = 0;

function assert(label, condition, extra = '') {
    if (condition) { passed++; }
    else { failed++; console.error(`  ❌ ${label}${extra ? ` — ${extra}` : ''}`); }
}

function fakeGerarEmbeddingsFn() {
    return async ({ textos }) => textos.map((t) => [t.length, 0]);
}

async function run() {
    // A. indexa todas as entradas do catálogo injetado, um doc por chunk.
    {
        const db = criarFakeFirestore();
        const catalogo = [
            { id: 'flask-fundamentos', categoria: 'flask', descricao: 'Framework web minimalista em Python.' },
            { id: 'django-orm', categoria: 'django', descricao: 'ORM completo do Django.' },
        ];

        const r = await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn() });

        assert('indexou as 2 entradas', r.indexados.length === 2, JSON.stringify(r));
        assert('nenhum erro', r.erros.length === 0, JSON.stringify(r.erros));
        assert('nenhum pulado', r.pulados.length === 0, JSON.stringify(r.pulados));
        assert('gravou doc no Firestore fake pra flask', db._dump(COLECAO).has('flask-fundamentos::chunk0'));
        assert('gravou doc no Firestore fake pra django', db._dump(COLECAO).has('django-orm::chunk0'));
    }

    // B. entrada sem texto embedável (nenhum campo preenchido) é pulada, sem chamar embeddings.
    {
        const db = criarFakeFirestore();
        let chamouEmbeddings = false;
        const gerarEmbeddingsFn = async () => { chamouEmbeddings = true; return []; };

        const r = await rodarIndexacao({
            catalogo: [{ id: 'vazio-total' }],
            db,
            gerarEmbeddingsFn,
        });

        assert('entrada vazia foi pulada', r.pulados.some((p) => p.id === 'vazio-total'));
        assert('embeddings nunca foi chamado pra entrada vazia', !chamouEmbeddings);
        assert('nada foi gravado no Firestore fake', db._dump(COLECAO).size === 0);
    }

    // C. idsFiltro restringe quais entradas são reindexadas.
    {
        const db = criarFakeFirestore();
        const catalogo = [
            { id: 'a', descricao: 'texto a' },
            { id: 'b', descricao: 'texto b' },
            { id: 'c', descricao: 'texto c' },
        ];

        const r = await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn(), idsFiltro: ['b'] });

        assert('só indexou a entrada filtrada', r.indexados.length === 1 && r.indexados[0] === 'b', JSON.stringify(r));
        assert('não tocou nas entradas fora do filtro', db._dump(COLECAO).size === 1);
    }

    // D. falha ao gerar embeddings de UMA entrada não impede as demais.
    {
        const db = criarFakeFirestore();
        const catalogo = [
            { id: 'falha', descricao: 'vai falhar' },
            { id: 'sucesso', descricao: 'vai funcionar' },
        ];
        const gerarEmbeddingsFn = async ({ textos }) => {
            if (textos[0].includes('falhar')) throw new Error('serviço indisponível');
            return textos.map((t) => [t.length, 0]);
        };

        const r = await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn });

        assert('entrada com falha aparece em erros', r.erros.some((e) => e.id === 'falha' && /indisponível/.test(e.erro)));
        assert('entrada seguinte ainda foi indexada', r.indexados.includes('sucesso'));
    }

    // E. reindexar a MESMA entrada duas vezes é idempotente (replace, não duplica).
    {
        const db = criarFakeFirestore();
        const catalogo = [{ id: 'idempotente', descricao: 'texto original' }];

        await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn() });
        await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn() });

        assert('rodar duas vezes não duplica documentos', db._dump(COLECAO).size === 1);
    }

    // F. sem "db" lança erro explícito.
    {
        let lancou = false;
        try { await rodarIndexacao({ catalogo: [] }); } catch (_) { lancou = true; }
        assert('sem db lança erro', lancou);
    }

    // G. indexação completa remove vetores de uma entrada que saiu do catálogo.
    {
        const db = criarFakeFirestore();
        const gerarEmbeddingsFn = fakeGerarEmbeddingsFn();
        await rodarIndexacao({
            catalogo: [
                { id: 'permanece', descricao: 'entrada que continua no catálogo' },
                { id: 'apagada', descricao: 'entrada que será removida do catálogo' },
            ],
            db,
            gerarEmbeddingsFn,
        });

        const r = await rodarIndexacao({
            catalogo: [{ id: 'permanece', descricao: 'entrada que continua no catálogo' }],
            db,
            gerarEmbeddingsFn,
        });

        assert('removeu o vetor órfão', !db._dump(COLECAO).has('apagada::chunk0'));
        assert('reportou a entrada removida', r.removidos.documentos === 1 && r.removidos.entradas.includes('apagada'), JSON.stringify(r.removidos));
    }

    // H. indexação parcial nunca remove vetores das entradas fora do filtro.
    {
        const db = criarFakeFirestore();
        const catalogo = [
            { id: 'a', descricao: 'texto a' },
            { id: 'b', descricao: 'texto b' },
        ];
        await rodarIndexacao({ catalogo, db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn() });
        const r = await rodarIndexacao({ catalogo: [catalogo[0]], idsFiltro: ['a'], db, gerarEmbeddingsFn: fakeGerarEmbeddingsFn() });

        assert('manteve vetor fora do filtro', db._dump(COLECAO).has('b::chunk0'));
        assert('não reportou remoção em execução parcial', r.removidos.documentos === 0);
    }

    console.log(`\n${failed === 0 ? '✅' : '❌'} ragEmbedIndex: ${passed} passed, ${failed} failed`);
    process.exit(failed === 0 ? 0 : 1);
}

run();
