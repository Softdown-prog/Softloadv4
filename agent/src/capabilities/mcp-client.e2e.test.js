import { test, before, after } from "node:test";
import assert from "node:assert/strict";

import { Permissions } from "../security/permissions.js";
import { McpClientCapability } from "./mcp-client.js";
import { startMcpEchoServer } from "./__testUtils__/mcpEchoServer.js";

/**
 * Teste de ponta a ponta GENUÍNO: nenhuma classe do SDK MCP é
 * substituída por fake aqui (diferente de mcp-client.test.js, que usa
 * ClientClass/TransportClass injetados) — McpClientCapability é
 * construída com os valores PADRÃO (Client + StreamableHTTPClientTransport
 * reais, do próprio @modelcontextprotocol/sdk) e conversa via HTTP de
 * verdade com um servidor MCP real (mcpEchoServer.js, também SDK
 * oficial do lado do servidor) rodando localmente.
 *
 * Isso prova que a infraestrutura genérica funciona de fato —
 * handshake JSON-RPC, listagem de ferramentas, chamada de ferramenta,
 * fechamento de conexão — não só que o roteamento interno (task type
 * -> capability -> método) está correto, que é tudo que
 * mcp-client.test.js consegue provar sozinho.
 */
let echoServer;

before(async () => {
  echoServer = await startMcpEchoServer();
});

after(async () => {
  await echoServer.close();
});

function buildRealCapability() {
  return new McpClientCapability({
    permissions: new Permissions({ mode: "full" }),
    mcpServersConfig: {
      echo: { url: echoServer.url },
    },
  });
}

test("e2e: mcp.list_servers reflete a configuração local, sem tocar a rede", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({ type: "mcp.list_servers" });

  assert.deepEqual(result, {
    servers: [{ name: "echo", url: echoServer.url }],
  });
});

test("e2e: mcp.list_tools contra um servidor MCP real devolve as ferramentas de verdade", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "mcp.list_tools",
    server: "echo",
  });

  assert.equal(result.server, "echo");

  const nomes = result.tools.map((t) => t.name).sort();
  assert.deepEqual(nomes, ["add", "echo"]);

  const echoTool = result.tools.find((t) => t.name === "echo");
  assert.equal(echoTool.description, "Devolve o texto recebido, sem alterações");
  assert.equal(echoTool.inputSchema.type, "object");
  assert.ok(echoTool.inputSchema.properties.text);
});

test("e2e: mcp.call_tool (echo) roda de verdade via JSON-RPC/HTTP e devolve o resultado real", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "mcp.call_tool",
    server: "echo",
    tool: "echo",
    arguments: { text: "olá do teste de ponta a ponta" },
  });

  assert.equal(result.server, "echo");
  assert.equal(result.tool, "echo");
  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [
    { type: "text", text: "olá do teste de ponta a ponta" },
  ]);
});

test("e2e: mcp.call_tool (add) com números reais soma corretamente", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "mcp.call_tool",
    server: "echo",
    tool: "add",
    arguments: { a: 17, b: 25 },
  });

  assert.equal(result.isError, false);
  assert.deepEqual(result.content, [{ type: "text", text: "42" }]);
});

test("e2e: mcp.call_tool com argumento de tipo errado -> isError:true (validado pelo servidor real)", async () => {
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "mcp.call_tool",
    server: "echo",
    tool: "add",
    arguments: { a: "não é número", b: 2 },
  });

  assert.equal(result.isError, true);
});

test("e2e: mcp.call_tool contra ferramenta inexistente -> isError:true (não rejeita)", async () => {
  // Achado real, verificado rodando contra o servidor real antes de
  // escrever esta asserção: "ferramenta desconhecida" é um erro de
  // NÍVEL DE PROTOCOLO MCP (JSON-RPC -32602), que o SDK client
  // resolve como um resultado normal de call_tool com isError:true —
  // não como uma promise rejeitada. Só uma falha de INFRAESTRUTURA
  // (servidor fora do ar, timeout, HTTP não-2xx) rejeitaria de fato.
  const capability = buildRealCapability();

  const result = await capability.execute({
    type: "mcp.call_tool",
    server: "echo",
    tool: "ferramenta-que-nao-existe",
    arguments: {},
  });

  assert.equal(result.isError, true);
  assert.ok(
    result.content.some((c) => c.type === "text" && c.text.includes("not found")),
  );
});

test("e2e: chamadas concorrentes contra o mesmo servidor não interferem entre si (conexão nova por chamada)", async () => {
  const capability = buildRealCapability();

  const [somaResult, echoResult] = await Promise.all([
    capability.execute({
      type: "mcp.call_tool",
      server: "echo",
      tool: "add",
      arguments: { a: 10, b: 5 },
    }),
    capability.execute({
      type: "mcp.call_tool",
      server: "echo",
      tool: "echo",
      arguments: { text: "concorrente" },
    }),
  ]);

  assert.deepEqual(somaResult.content, [{ type: "text", text: "15" }]);
  assert.deepEqual(echoResult.content, [{ type: "text", text: "concorrente" }]);
});
