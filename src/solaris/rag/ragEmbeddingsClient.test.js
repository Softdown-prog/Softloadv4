'use strict';

const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { gerarEmbeddings, ErroServicoEmbeddings, _lerAutorizacao } = require('./ragEmbeddingsClient');

const aguardarInstantaneo = () => Promise.resolve();

function respostaJson(status, corpo) {
    return {
        ok: status >= 200 && status < 300,
        status,
        json: async () => corpo,
    };
}

let envOriginal;

beforeEach(() => {
    envOriginal = { ...process.env };
    process.env.EMBEDDINGS_SERVICE_URL = 'https://embeddings.exemplo.internal';
    process.env.EMBEDDINGS_SHARED_SECRET = 'segredo-teste';
});

afterEach(() => {
    process.env = envOriginal;
});

test('gerarEmbeddings lança erro claro quando EMBEDDINGS_SERVICE_URL não está configurada', async () => {
    delete process.env.EMBEDDINGS_SERVICE_URL;
    await assert.rejects(
        gerarEmbeddings({ textos: ['a'] }),
        /EMBEDDINGS_SERVICE_URL não configurada/,
    );
});

test('gerarEmbeddings rejeita array de textos vazio', async () => {
    await assert.rejects(gerarEmbeddings({ textos: [] }), /array não vazio/);
});

test('gerarEmbeddings rejeita taskType inválido', async () => {
    await assert.rejects(
        gerarEmbeddings({ textos: ['a'], taskType: 'INVALIDO' }),
        /taskType/,
    );
});

test('gerarEmbeddings chama o endpoint /embed com o header de segredo e corpo esperado', async () => {
    const chamadas = [];
    const fetchImpl = async (url, opcoes) => {
        chamadas.push({ url, opcoes });
        return respostaJson(200, { embeddings: [[0.1, 0.2]], model: 'text-embedding-004', dimension: 2 });
    };

    const resultado = await gerarEmbeddings({ textos: ['ola mundo'], fetchImpl, aguardar: aguardarInstantaneo });

    assert.deepEqual(resultado, [[0.1, 0.2]]);
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0].url, 'https://embeddings.exemplo.internal/embed');
    assert.equal(chamadas[0].opcoes.headers['x-embeddings-secret'], 'segredo-teste');
    const corpoEnviado = JSON.parse(chamadas[0].opcoes.body);
    assert.deepEqual(corpoEnviado, { texts: ['ola mundo'], taskType: 'RETRIEVAL_DOCUMENT' });
});

test('gerarEmbeddings envia ID token quando EMBEDDINGS_IAM_AUTH está ativada', async () => {
    process.env.EMBEDDINGS_IAM_AUTH = 'true';
    let headersRecebidos;
    const fetchImpl = async (url, opcoes) => {
        headersRecebidos = opcoes.headers;
        return respostaJson(200, { embeddings: [[1]] });
    };

    await gerarEmbeddings({
        textos: ['ola mundo'],
        fetchImpl,
        aguardar: aguardarInstantaneo,
        obterTokenIdentidade: async (url) => {
            assert.equal(url, 'https://embeddings.exemplo.internal');
            return 'Bearer token-de-teste';
        },
    });

    assert.equal(headersRecebidos.Authorization, 'Bearer token-de-teste');
});

test('gerarEmbeddings usa ID token temporário fornecido pelo Cloud Build', async () => {
    process.env.EMBEDDINGS_IAM_AUTH = 'true';
    process.env.EMBEDDINGS_ID_TOKEN = 'token-temporario';
    let headersRecebidos;

    await gerarEmbeddings({
        textos: ['ola mundo'],
        fetchImpl: async (url, opcoes) => {
            headersRecebidos = opcoes.headers;
            return respostaJson(200, { embeddings: [[1]] });
        },
        aguardar: aguardarInstantaneo,
        obterTokenIdentidade: async () => { throw new Error('não deve buscar token pela metadata server'); },
    });

    assert.equal(headersRecebidos.Authorization, 'Bearer token-temporario');
});

test('_lerAutorizacao lê Headers nativo retornado pelo cliente Google', () => {
    assert.equal(
        _lerAutorizacao(new Headers({ authorization: 'Bearer token-de-teste' })),
        'Bearer token-de-teste',
    );
});

test('gerarEmbeddings divide em lotes de no máximo 20 textos por requisição', async () => {
    const chamadas = [];
    const textos = Array.from({ length: 45 }, (_, i) => `texto ${i}`);
    const fetchImpl = async (url, opcoes) => {
        const corpo = JSON.parse(opcoes.body);
        chamadas.push(corpo.texts.length);
        return respostaJson(200, { embeddings: corpo.texts.map(() => [0]) });
    };

    const resultado = await gerarEmbeddings({ textos, fetchImpl, aguardar: aguardarInstantaneo });

    assert.deepEqual(chamadas, [20, 20, 5]);
    assert.equal(resultado.length, 45);
});

test('gerarEmbeddings NÃO tenta de novo em erro 4xx (não é transitório)', async () => {
    let chamadasFetch = 0;
    const fetchImpl = async () => {
        chamadasFetch += 1;
        return respostaJson(400, { error: 'texto inválido' });
    };

    await assert.rejects(
        gerarEmbeddings({ textos: ['a'], fetchImpl, aguardar: aguardarInstantaneo }),
        (err) => err instanceof ErroServicoEmbeddings && /400/.test(err.message),
    );
    assert.equal(chamadasFetch, 1);
});

test('gerarEmbeddings tenta de novo em erro 5xx até MAX_RETRIES vezes', async () => {
    let chamadasFetch = 0;
    const fetchImpl = async () => {
        chamadasFetch += 1;
        return respostaJson(503, { error: 'indisponível' });
    };

    await assert.rejects(gerarEmbeddings({ textos: ['a'], fetchImpl, aguardar: aguardarInstantaneo }));
    assert.equal(chamadasFetch, 3);
});

test('gerarEmbeddings se recupera se uma tentativa falhar e a próxima funcionar', async () => {
    let chamadasFetch = 0;
    const fetchImpl = async () => {
        chamadasFetch += 1;
        if (chamadasFetch < 2) return respostaJson(503, { error: 'indisponível' });
        return respostaJson(200, { embeddings: [[1, 2, 3]] });
    };

    const resultado = await gerarEmbeddings({ textos: ['a'], fetchImpl, aguardar: aguardarInstantaneo });
    assert.deepEqual(resultado, [[1, 2, 3]]);
    assert.equal(chamadasFetch, 2);
});

test('gerarEmbeddings lança erro se o serviço retornar número de embeddings diferente do esperado', async () => {
    const fetchImpl = async () => respostaJson(200, { embeddings: [[1, 2]] });

    await assert.rejects(
        gerarEmbeddings({ textos: ['a', 'b'], fetchImpl, aguardar: aguardarInstantaneo }),
        /número de embeddings diferente/,
    );
});

test('gerarEmbeddings funciona sem EMBEDDINGS_SHARED_SECRET (não manda o header)', async () => {
    delete process.env.EMBEDDINGS_SHARED_SECRET;
    let headersRecebidos;
    const fetchImpl = async (url, opcoes) => {
        headersRecebidos = opcoes.headers;
        return respostaJson(200, { embeddings: [[1]] });
    };

    await gerarEmbeddings({ textos: ['a'], fetchImpl, aguardar: aguardarInstantaneo });
    assert.equal(headersRecebidos['x-embeddings-secret'], undefined);
});
