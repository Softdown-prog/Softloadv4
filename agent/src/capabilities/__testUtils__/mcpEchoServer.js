import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpExpressApp } from "@modelcontextprotocol/sdk/server/express.js";
import { z } from "zod";

/**
 * mcpEchoServer: servidor MCP mínimo, REAL (SDK oficial
 * `@modelcontextprotocol/sdk`, não um mock/fake) — usado SOMENTE em
 * testes, para provar que `McpClientCapability` (mcp-client.js) fala
 * o protocolo de verdade ponta a ponta (handshake JSON-RPC, list
 * tools, call tool) contra um servidor Streamable HTTP real, sem
 * mockar nenhuma camada do SDK. NUNCA implantado em produção — mesmo
 * espírito de `__testUtils__/fakeFirestore.js` (src/solaris/rag/).
 *
 * Duas ferramentas triviais, suficientes para exercitar o caminho
 * feliz e o caminho de erro de `call_tool`:
 *   - "echo": devolve o texto recebido, sem alterações.
 *   - "add": soma dois números — chamado com argumento inválido
 *     (ex: string em vez de number) devolve `isError: true`, provando
 *     que McpClientCapability repassa esse campo sem mascarar.
 *
 * Modo stateless (`sessionIdGenerator: undefined`, padrão oficial do
 * SDK para este cenário — ver
 * examples/server/simpleStatelessStreamableHttp.js): cada requisição
 * HTTP ganha seu próprio McpServer + transport, descartados ao final.
 * Isso casa exatamente com o padrão connect-por-chamada do próprio
 * McpClientCapability (`_withClient`), sem depender de nenhum estado
 * de sessão compartilhado entre chamadas.
 */
function buildEchoMcpServer() {
  const server = new McpServer({
    name: "echo-test-server",
    version: "1.0.0",
  });

  server.registerTool(
    "echo",
    {
      description: "Devolve o texto recebido, sem alterações",
      inputSchema: { text: z.string() },
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
    }),
  );

  server.registerTool(
    "add",
    {
      description: "Soma dois números",
      inputSchema: { a: z.number(), b: z.number() },
    },
    async ({ a, b }) => ({
      content: [{ type: "text", text: String(a + b) }],
    }),
  );

  return server;
}

/**
 * Monta a aplicação Express que expõe o servidor MCP em `POST /mcp`.
 * Separado de `startMcpEchoServer()` só para permitir inspecionar o
 * app sem subir uma porta real, se algum teste futuro precisar disso.
 */
export function buildMcpEchoApp() {
  const app = createMcpExpressApp();

  app.post("/mcp", async (req, res) => {
    const server = buildEchoMcpServer();

    try {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
      });

      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);

      res.on("close", () => {
        transport.close();
        server.close();
      });
    } catch (error) {
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: { code: -32603, message: error.message },
          id: null,
        });
      }
    }
  });

  return app;
}

/**
 * Sobe o servidor numa porta efêmera (0, escolhida pelo SO) e devolve
 * a URL do endpoint MCP + uma função `close()` — usado pelo
 * setup/teardown do teste de ponta a ponta (mcp-client.e2e.test.js).
 */
export async function startMcpEchoServer() {
  const app = buildMcpEchoApp();
  const server = app.listen(0);

  await new Promise((resolve) => server.once("listening", resolve));

  const port = server.address().port;

  return {
    url: `http://127.0.0.1:${port}/mcp`,
    async close() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}
