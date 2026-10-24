// Achado real: este arquivo usava globals do Jest (`jest.mock`,
// `describe`/`test`/`expect`) mas o projeto roda testes com
// `node --test` (ver package.json) — Jest nem é devDependency. Reescrito
// para node:test + node:assert/strict, com um mock real de @google/genai
// via `mock.module()` (em vez do auto-mock do Jest, que nunca chegou a
// devolver uma resposta utilizável — as asserções originais, mesmo sob
// Jest, teriam falhado, porque nada configurava um retorno pro mock).
import { test, describe, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';

// Resposta simulada, no formato real de @google/genai (GenerateContentResponse):
// `.text` é propriedade (não método), grounding em
// candidates[0].groundingMetadata.{webSearchQueries,groundingChunks} — ver
// node_modules/@google/genai/dist/genai.d.ts. Mutável por teste via
// `mockResponse = {...}` antes de cada chamada.
let mockResponse;
let generateContentCalls;

mock.module('@google/genai', {
  namedExports: {
    GoogleGenAI: class {
      constructor({ apiKey }) {
        this.apiKey = apiKey;
        this.models = {
          generateContent: async (request) => {
            generateContentCalls.push(request);
            return mockResponse;
          },
        };
      }
    },
  },
});

// Import só depois do mock.module (ordem importa: o import abaixo é
// hoisted pelo ESM loader, mas mock.module intercepta a resolução do
// specifier '@google/genai' independente de quando o import() dinâmico
// dentro de web-search.js acontece em runtime).
const { WebSearchCapability } = await import('./web-search.js');
const { Permissions } = await import('../security/permissions.js');

function respostaPadrao() {
  return {
    text: 'Laravel 11 traz melhorias de performance e novo sistema de eventos.',
    candidates: [
      {
        groundingMetadata: {
          webSearchQueries: ['Laravel 11 novidades'],
          groundingChunks: [
            { web: { uri: 'https://laravel.com/docs/11.x/releases', title: 'Laravel 11 — Release Notes' } },
            { web: { uri: 'https://example.com/blog/laravel-11', title: 'Blog não permitido' } },
          ],
        },
      },
    ],
  };
}

describe('WebSearchCapability', () => {
  let originalApiKey;

  beforeEach(() => {
    originalApiKey = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'test-key';
    mockResponse = respostaPadrao();
    generateContentCalls = [];
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalApiKey;
  });

  test('deve executar pesquisa válida', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    const result = await capability.execute({
      type: 'web.search',
      query: 'Laravel 11 novidades',
      maxResults: 3,
    });

    assert.equal(result.success, true);
    assert.equal(result.query, 'Laravel 11 novidades');
    assert.ok(result.answer);
    assert.ok(Array.isArray(result.sources));
    assert.equal(generateContentCalls.length, 1);
    // Confirma a forma da chamada real esperada pelo SDK unificado
    // (model.generateContent na instância, não getGenerativeModel()).
    assert.ok(generateContentCalls[0].model);
    assert.ok(generateContentCalls[0].config.tools[0].googleSearch);
  });

  test('deve lançar erro para query ausente', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    // '' é falsy, então cai no branch de "exige query" antes mesmo do
    // .trim() — para testar especificamente o branch "não pode ser vazia"
    // (query truthy mas vazia após trim), precisa de uma string só com
    // espaço, não uma string vazia.
    await assert.rejects(
      capability.execute({ type: 'web.search', query: '' }),
      /exige "query"/,
    );
  });

  test('deve lançar erro para query só com espaços', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    await assert.rejects(
      capability.execute({ type: 'web.search', query: '   ' }),
      /query não pode ser vazia/,
    );
  });

  test('deve lançar erro para query muito longa', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    const longQuery = 'a'.repeat(1001);

    await assert.rejects(
      capability.execute({ type: 'web.search', query: longQuery }),
      /excede 1000 caracteres/,
    );
  });

  test('deve filtrar fontes fora da allowlist de domínios', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    const result = await capability.execute({
      type: 'web.search',
      query: 'teste',
      allowedDomains: ['laravel.com'],
    });

    // mockResponse tem 2 grounding chunks: laravel.com (permitido) e
    // example.com (não permitido) — só o primeiro deve sobreviver ao filtro.
    assert.ok(result.sources.length > 0);
    assert.ok(result.sources.every((s) => s.url.includes('laravel.com')));
    assert.equal(result.metadata.filteredCount, 1);
  });

  test('deve respeitar rate limiting (5 pesquisas por task)', async () => {
    const capability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': true } }),
    });

    const task = { type: 'web.search', query: 'teste', _taskId: 'rate-limit-test' };

    for (let i = 0; i < 5; i++) {
      await capability.execute(task);
    }

    await assert.rejects(
      capability.execute(task),
      /Limite de 5 pesquisas por task excedido/,
    );
  });

  test('deve negar quando a permissão web.search está desabilitada', async () => {
    const restrictedCapability = new WebSearchCapability({
      permissions: new Permissions({ permissions: { 'web.search': false } }),
    });

    await assert.rejects(
      restrictedCapability.execute({ type: 'web.search', query: 'teste' }),
      /Permissão negada/,
    );
  });
});
