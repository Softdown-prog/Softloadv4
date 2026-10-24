import {
    gerarEmbeddings, ErroServicoEmbeddings, MAX_TEXTOS_POR_REQUISICAO, _lerAutorizacao,
} from '../solaris/rag/ragEmbeddingsClient';
import type {
    EmbeddingsTaskType, EmbeddingsHttpResponse, EmbeddingsHttpBody,
    EmbeddingsHeaders, EmbeddingsFetch, EmbeddingsDelay, GerarEmbeddingsOptions,
} from '../solaris/rag/ragEmbeddingsClient';

const mode: EmbeddingsTaskType = 'RETRIEVAL_QUERY';
const response: EmbeddingsHttpBody = { embeddings: [[0.1, 0.2]] };
const fakeResponse: EmbeddingsHttpResponse = {
    status: 200, ok: true, json: async () => response,
};
const fetchFake: EmbeddingsFetch = async () => fakeResponse;
const pause: EmbeddingsDelay = async () => {};
const options: GerarEmbeddingsOptions = {
    textos: ['um texto'], taskType: mode, fetchImpl: fetchFake, aguardar: pause,
};
const task: Promise<number[][]> = gerarEmbeddings(options);
const headers: EmbeddingsHeaders = { Authorization: 'Bearer test' };
const authorization: string | null | undefined = _lerAutorizacao(headers);
const retryable: boolean = new ErroServicoEmbeddings('temporário', { retryable: true }).retryable;
const batchSize: number = MAX_TEXTOS_POR_REQUISICAO;
void task; void authorization; void retryable; void batchSize;
