import { test } from "node:test";
import assert from "node:assert/strict";

import { parseMcpServersConfig, loadMcpServersConfig } from "./mcpServers.js";

test("parseMcpServersConfig: ausente/vazio retorna mapa vazio", () => {
  assert.deepEqual(parseMcpServersConfig(undefined), {});
  assert.deepEqual(parseMcpServersConfig(null), {});
  assert.deepEqual(parseMcpServersConfig(""), {});
  assert.deepEqual(parseMcpServersConfig("   "), {});
});

test("parseMcpServersConfig: JSON malformado lança erro claro", () => {
  assert.throws(
    () => parseMcpServersConfig("{ isso não é json"),
    /não é um JSON válido/,
  );
});

test("parseMcpServersConfig: URL inválida lança erro", () => {
  assert.throws(
    () =>
      parseMcpServersConfig(
        JSON.stringify({ docs: { url: "não-é-uma-url" } }),
      ),
    /MCP_SERVERS_JSON inválido/,
  );
});

test("parseMcpServersConfig: campo extra não listado é rejeitado (.strict())", () => {
  assert.throws(
    () =>
      parseMcpServersConfig(
        JSON.stringify({
          docs: { url: "https://mcp.exemplo.com/mcp", token: "abc" },
        }),
      ),
    /MCP_SERVERS_JSON inválido/,
  );
});

test("parseMcpServersConfig: configuração válida com um servidor, sem headers", () => {
  const config = parseMcpServersConfig(
    JSON.stringify({ docs: { url: "https://mcp.exemplo.com/mcp" } }),
  );

  assert.deepEqual(config, {
    docs: { url: "https://mcp.exemplo.com/mcp" },
  });
});

test("parseMcpServersConfig: múltiplos servidores, um deles com headers", () => {
  const config = parseMcpServersConfig(
    JSON.stringify({
      docs: { url: "https://mcp-docs.exemplo.com/mcp" },
      privado: {
        url: "https://mcp-privado.exemplo.com/mcp",
        headers: { Authorization: "Bearer segredo-123" },
      },
    }),
  );

  assert.deepEqual(config, {
    docs: { url: "https://mcp-docs.exemplo.com/mcp" },
    privado: {
      url: "https://mcp-privado.exemplo.com/mcp",
      headers: { Authorization: "Bearer segredo-123" },
    },
  });
});

test("loadMcpServersConfig: lê MCP_SERVERS_JSON do env informado (injetável)", () => {
  const fakeEnv = {
    MCP_SERVERS_JSON: JSON.stringify({
      docs: { url: "https://mcp.exemplo.com/mcp" },
    }),
  };

  assert.deepEqual(loadMcpServersConfig(fakeEnv), {
    docs: { url: "https://mcp.exemplo.com/mcp" },
  });
});

test("loadMcpServersConfig: env sem MCP_SERVERS_JSON retorna mapa vazio", () => {
  assert.deepEqual(loadMcpServersConfig({}), {});
});

test("loadMcpServersConfig: configura GitHub MCP oficial com PAT fora do JSON", () => {
  const result = loadMcpServersConfig({
    GITHUB_MCP_TOKEN: "ghp_teste",
    GITHUB_MCP_ALLOWED_TOOLS: "get_issue, search_repositories",
  });

  assert.deepEqual(result, {
    github: {
      url: "https://api.githubcopilot.com/mcp/",
      headers: { Authorization: "Bearer ghp_teste" },
      allowedTools: ["get_issue", "search_repositories"],
    },
  });
});

test("loadMcpServersConfig: Supabase MCP exige token e project_ref e fica read-only por padrão", () => {
  assert.throws(
    () => loadMcpServersConfig({ SUPABASE_MCP_ACCESS_TOKEN: "sbp_teste" }),
    /SUPABASE_MCP_PROJECT_REF/,
  );

  const result = loadMcpServersConfig({
    SUPABASE_MCP_ACCESS_TOKEN: "sbp_teste",
    SUPABASE_MCP_PROJECT_REF: "abc123",
  });

  assert.deepEqual(result, {
    supabase: {
      url: "https://mcp.supabase.com/mcp?project_ref=abc123&read_only=true&features=database%2Cdocs",
      headers: { Authorization: "Bearer sbp_teste" },
    },
  });
});

test("loadMcpServersConfig: não aceita preset e servidor JSON com mesmo nome", () => {
  assert.throws(
    () => loadMcpServersConfig({
      MCP_SERVERS_JSON: JSON.stringify({ github: { url: "https://mcp.exemplo.com/mcp" } }),
      GITHUB_MCP_TOKEN: "ghp_teste",
    }),
    /Configuração MCP duplicada/,
  );
});
