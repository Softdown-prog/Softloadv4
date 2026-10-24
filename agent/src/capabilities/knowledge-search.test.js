import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Permissions } from "../security/permissions.js";
import { KnowledgeSearchCapability } from "./knowledge-search.js";

let envSnapshot;

beforeEach(() => {
  envSnapshot = { ...process.env };
  process.env.SOLARIS_RAG_SEARCH_URL = "https://app.exemplo.internal";
  process.env.SOLARIS_RAG_SEARCH_SECRET = "segredo-teste";
});

afterEach(() => {
  process.env = envSnapshot;
});

function respostaJson(status, corpo) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  };
}

function makeCapability(fetchImpl, permissionsOverride) {
  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });
  return new KnowledgeSearchCapability({ permissions, fetchImpl });
}

test("knowledge.search exige query", async () => {
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "knowledge.search" }),
    /exige query/,
  );
});

test("knowledge.search lança erro claro quando SOLARIS_RAG_SEARCH_URL não está configurada", async () => {
  delete process.env.SOLARIS_RAG_SEARCH_URL;
  const capability = makeCapability(async () => respostaJson(200, {}));

  await assert.rejects(
    () => capability.execute({ type: "knowledge.search", query: "flask" }),
    /SOLARIS_RAG_SEARCH_URL não configurada/,
  );
});

test("knowledge.search chama POST /internal/solaris/rag/buscar com o header de segredo e repassa o resultado", async () => {
  const chamadas = [];
  const capability = makeCapability(async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    return respostaJson(200, {
      query: "como uso flask?",
      resultados: [{ entryId: "flask-fundamentos" }],
    });
  });

  const result = await capability.execute({
    type: "knowledge.search",
    query: "como uso flask?",
    topK: 3,
  });

  assert.deepEqual(result, {
    query: "como uso flask?",
    resultados: [{ entryId: "flask-fundamentos" }],
  });
  assert.equal(chamadas.length, 1);
  assert.equal(
    chamadas[0].url,
    "https://app.exemplo.internal/internal/solaris/rag/buscar",
  );
  assert.equal(
    chamadas[0].opcoes.headers["x-solaris-rag-search-secret"],
    "segredo-teste",
  );

  const corpoEnviado = JSON.parse(chamadas[0].opcoes.body);
  assert.deepEqual(corpoEnviado, { query: "como uso flask?", topK: 3 });
});

test("knowledge.search não manda topK quando não fornecido", async () => {
  let corpoEnviado;
  const capability = makeCapability(async (url, opcoes) => {
    corpoEnviado = JSON.parse(opcoes.body);
    return respostaJson(200, { query: "x", resultados: [] });
  });

  await capability.execute({ type: "knowledge.search", query: "x" });
  assert.deepEqual(corpoEnviado, { query: "x" });
});

test("knowledge.search propaga como exceção uma resposta não-ok", async () => {
  const capability = makeCapability(async () =>
    respostaJson(403, { erro: "Forbidden" }),
  );

  await assert.rejects(
    () => capability.execute({ type: "knowledge.search", query: "x" }),
    /403/,
  );
});

test("knowledge.search funciona sem SOLARIS_RAG_SEARCH_SECRET (não manda o header)", async () => {
  delete process.env.SOLARIS_RAG_SEARCH_SECRET;
  let headersRecebidos;
  const capability = makeCapability(async (url, opcoes) => {
    headersRecebidos = opcoes.headers;
    return respostaJson(200, { query: "x", resultados: [] });
  });

  await capability.execute({ type: "knowledge.search", query: "x" });
  assert.equal(headersRecebidos["x-solaris-rag-search-secret"], undefined);
});

test("knowledge.search respeita Permissions -- negado por padrão (preset restricted)", async () => {
  const capability = makeCapability(
    async () => respostaJson(200, { query: "x", resultados: [] }),
    { mode: "restricted" },
  );

  await assert.rejects(
    () => capability.execute({ type: "knowledge.search", query: "x" }),
    /Permissão negada/,
  );
});
