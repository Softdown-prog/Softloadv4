import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { Permissions } from "../security/permissions.js";
import { McpClientCapability } from "./mcp-client.js";

// Fakes injetáveis (ClientClass/TransportClass) -- nenhum destes
// testes bate em rede real. O teste de ponta a ponta genuíno (SDK
// real + servidor MCP real) mora em mcp-client.e2e.test.js.
class FakeTransport {
  constructor(url, options) {
    this.url = url;
    this.options = options;
    FakeTransport.lastInstance = this;
  }
}

class FakeClient {
  constructor(clientInfo, options) {
    this.clientInfo = clientInfo;
    this.options = options;
    this.connected = false;
    this.closed = false;
  }

  async connect(transport) {
    this.transport = transport;
    this.connected = true;

    if (FakeClient.connectShouldThrow) {
      throw new Error("falha simulada de conexão");
    }
  }

  async listTools() {
    return FakeClient.listToolsResult;
  }

  async callTool(params) {
    FakeClient.lastCallToolParams = params;

    if (FakeClient.callToolShouldThrow) {
      throw new Error("falha simulada na chamada da ferramenta");
    }

    return FakeClient.callToolResult;
  }

  async close() {
    this.closed = true;
    FakeClient.closeCallCount += 1;
  }
}

function permissiveMcpPermissions() {
  return new Permissions({
    permissions: {
      "mcp.list_servers": true,
      "mcp.list_tools": true,
      "mcp.call_tool": true,
    },
  });
}

beforeEach(() => {
  FakeClient.connectShouldThrow = false;
  FakeClient.callToolShouldThrow = false;
  FakeClient.closeCallCount = 0;
  FakeClient.lastCallToolParams = undefined;
  FakeClient.listToolsResult = {
    tools: [
      {
        name: "echo",
        description: "Devolve o texto recebido",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ],
  };
  FakeClient.callToolResult = {
    content: [{ type: "text", text: "ok" }],
    isError: false,
  };
});

function buildCapability({ permissions, servers } = {}) {
  return new McpClientCapability({
    permissions: permissions || permissiveMcpPermissions(),
    mcpServersConfig: servers || {
      docs: { url: "https://mcp-docs.exemplo.com/mcp" },
      privado: {
        url: "https://mcp-privado.exemplo.com/mcp",
        headers: { Authorization: "Bearer segredo-123" },
      },
    },
    ClientClass: FakeClient,
    TransportClass: FakeTransport,
  });
}

test("execute: nega ação sem permissão (fail-closed)", async () => {
  const capability = buildCapability({
    permissions: new Permissions({ permissions: { "mcp.list_servers": false } }),
  });

  await assert.rejects(
    () => capability.execute({ type: "mcp.list_servers" }),
    /Permissão negada/,
  );
});

test("execute: tipo de task desconhecido lança erro (mode full pra passar da checagem de permissão)", async () => {
  const capability = buildCapability({
    permissions: new Permissions({ mode: "full" }),
  });

  await assert.rejects(
    () => capability.execute({ type: "mcp.algo_inventado" }),
    /Operação MCP desconhecida/,
  );
});

test("mcp.list_servers: retorna nome+url, NUNCA headers", async () => {
  const capability = buildCapability();

  const result = await capability.execute({ type: "mcp.list_servers" });

  assert.deepEqual(result, {
    servers: [
      { name: "docs", url: "https://mcp-docs.exemplo.com/mcp" },
      { name: "privado", url: "https://mcp-privado.exemplo.com/mcp" },
    ],
  });

  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("segredo-123"), "headers não devem vazar em list_servers");
});

test("mcp.list_servers: nenhum servidor configurado retorna lista vazia", async () => {
  const capability = buildCapability({ servers: {} });

  const result = await capability.execute({ type: "mcp.list_servers" });

  assert.deepEqual(result, { servers: [] });
});

test("mcp.list_tools: exige server (string)", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "mcp.list_tools" }),
    /exige server/,
  );
});

test("mcp.list_tools: servidor desconhecido lista os servidores configurados no erro", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "mcp.list_tools", server: "inexistente" }),
    /Servidor MCP desconhecido: "inexistente".*docs.*privado/s,
  );
});

test("mcp.list_tools: caminho feliz devolve ferramentas mapeadas e fecha a conexão", async () => {
  const capability = buildCapability();

  const result = await capability.execute({
    type: "mcp.list_tools",
    server: "docs",
  });

  assert.deepEqual(result, {
    server: "docs",
    tools: [
      {
        name: "echo",
        description: "Devolve o texto recebido",
        inputSchema: { type: "object", properties: { text: { type: "string" } } },
      },
    ],
  });

  assert.equal(FakeClient.closeCallCount, 1);
});

test("mcp.list_tools: ferramenta sem description vira null (não undefined)", async () => {
  FakeClient.listToolsResult = {
    tools: [{ name: "sem-descricao", inputSchema: { type: "object" } }],
  };

  const capability = buildCapability();

  const result = await capability.execute({
    type: "mcp.list_tools",
    server: "docs",
  });

  assert.equal(result.tools[0].description, null);
});

test("mcp.call_tool: exige tool (string)", async () => {
  const capability = buildCapability();

  await assert.rejects(
    () => capability.execute({ type: "mcp.call_tool", server: "docs" }),
    /exige tool/,
  );
});

test("mcp.call_tool: repassa server/tool/arguments corretamente e devolve o resultado", async () => {
  const capability = buildCapability();

  const result = await capability.execute({
    type: "mcp.call_tool",
    server: "docs",
    tool: "echo",
    arguments: { text: "olá" },
  });

  assert.deepEqual(FakeClient.lastCallToolParams, {
    name: "echo",
    arguments: { text: "olá" },
  });

  assert.deepEqual(result, {
    server: "docs",
    tool: "echo",
    isError: false,
    content: [{ type: "text", text: "ok" }],
    structuredContent: undefined,
  });
});

test("mcp.call_tool: arguments ausente vira objeto vazio", async () => {
  const capability = buildCapability();

  await capability.execute({ type: "mcp.call_tool", server: "docs", tool: "echo" });

  assert.deepEqual(FakeClient.lastCallToolParams, { name: "echo", arguments: {} });
});

test("mcp.list_tools/mcp.call_tool respeitam allowedTools do servidor", async () => {
  FakeClient.listToolsResult = {
    tools: [
      { name: "echo", inputSchema: { type: "object" } },
      { name: "add", inputSchema: { type: "object" } },
    ],
  };
  const capability = buildCapability({
    servers: {
      docs: {
        url: "https://mcp-docs.exemplo.com/mcp",
        allowedTools: ["echo"],
      },
    },
  });

  const listed = await capability.execute({ type: "mcp.list_tools", server: "docs" });
  assert.deepEqual(listed.tools.map((tool) => tool.name), ["echo"]);

  await assert.rejects(
    () => capability.execute({ type: "mcp.call_tool", server: "docs", tool: "add", arguments: { a: 1, b: 2 } }),
    /Ferramenta MCP não permitida.*add.*echo/s,
  );
});

test("mcp.call_tool: fecha a conexão mesmo quando a chamada falha", async () => {
  FakeClient.callToolShouldThrow = true;

  const capability = buildCapability();

  await assert.rejects(
    () =>
      capability.execute({
        type: "mcp.call_tool",
        server: "docs",
        tool: "echo",
      }),
    /falha simulada na chamada da ferramenta/,
  );

  assert.equal(FakeClient.closeCallCount, 1);
});

test("mcp.call_tool: fecha a conexão mesmo quando connect() falha", async () => {
  FakeClient.connectShouldThrow = true;

  const capability = buildCapability();

  await assert.rejects(
    () =>
      capability.execute({
        type: "mcp.call_tool",
        server: "docs",
        tool: "echo",
      }),
    /falha simulada de conexão/,
  );

  assert.equal(FakeClient.closeCallCount, 1);
});

test("_withClient: repassa headers do servidor configurado pro requestInit do transport", async () => {
  const capability = buildCapability();

  await capability.execute({
    type: "mcp.call_tool",
    server: "privado",
    tool: "echo",
  });

  assert.equal(FakeTransport.lastInstance.url.toString(), "https://mcp-privado.exemplo.com/mcp");
  assert.deepEqual(FakeTransport.lastInstance.options.requestInit.headers, {
    Authorization: "Bearer segredo-123",
  });
});

test("_withClient: servidor sem headers configurados não define requestInit", async () => {
  const capability = buildCapability();

  await capability.execute({
    type: "mcp.call_tool",
    server: "docs",
    tool: "echo",
  });

  assert.equal(FakeTransport.lastInstance.options.requestInit, undefined);
});
