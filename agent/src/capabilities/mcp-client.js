import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { loadMcpServersConfig } from "../config/mcpServers.js";

// Tempo máximo de espera por uma resposta de um servidor MCP externo
// (list_tools ou call_tool) -- mesma ordem de grandeza do teto usado
// em web-sandbox.js (120s) e shellInput/buildInput (600s), mas mais
// conservador: um servidor MCP mal comportado não deveria travar uma
// task por minutos.
const DEFAULT_REQUEST_TIMEOUT_MS = 30000;

/**
 * McpClientCapability: cliente genérico do Model Context Protocol
 * (MCP) — em vez de cada integração nova (github, storage, artifacts)
 * exigir código novo em agent.js + task-router.js + permissions.js +
 * role-permissions.js + protocol.js/protocol-adapter.js, um servidor
 * MCP novo só precisa ser adicionado a `MCP_SERVERS_JSON` (ver
 * config/mcpServers.js) — nenhum código muda.
 *
 * Transport: Streamable HTTP contra servidores MCP remotos (nunca
 * stdio/processo local) — mesmo padrão do resto do agent/, que nunca
 * guarda credenciais diretamente nem spawna processos de terceiros,
 * só fala HTTP com serviços já rodando em outro lugar (sandbox-efemoro,
 * Embedings-python, o app principal via knowledge-search.js).
 *
 * Uma conexão nova é aberta e fechada a cada chamada (list_tools ou
 * call_tool) — sem pool de conexões persistente. Simplicidade
 * deliberada: o volume esperado de chamadas MCP por task não
 * justifica a complexidade extra de gerenciar sessões vivas entre
 * chamadas, e cada Cloud Run request já é, por natureza, de vida
 * curta.
 *
 * `ClientClass`/`TransportClass` são injetáveis no construtor (mesmo
 * padrão de `octokit` em github.js) — testes de unidade nunca
 * precisam de rede real; o teste de ponta a ponta genuíno usa as
 * classes reais contra um servidor MCP de referência local (ver
 * `__testUtils__/mcpEchoServer.js`).
 */
export class McpClientCapability {
  constructor({
    permissions,
    mcpServersConfig,
    ClientClass = Client,
    TransportClass = StreamableHTTPClientTransport,
    fetchImpl = fetch,
  } = {}) {
    this.permissions = permissions;
    this.servers = mcpServersConfig || loadMcpServersConfig();
    this.ClientClass = ClientClass;
    this.TransportClass = TransportClass;
    this.fetchImpl = fetchImpl;
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "mcp.list_servers":
        return this.listServers();

      case "mcp.list_tools":
        return this.listTools(task);

      case "mcp.call_tool":
        return this.callTool(task);

      default:
        throw new Error(`Operação MCP desconhecida: ${task.type}`);
    }
  }

  /**
   * Lista os servidores MCP configurados (nome + URL). NUNCA inclui
   * `headers` — esse campo carrega tipicamente um segredo de
   * autenticação (ver mcpServers.js), e esta operação não faz
   * nenhuma chamada de rede, só lê a configuração local.
   */
  listServers() {
    return {
      servers: Object.entries(this.servers).map(([name, config]) => ({
        name,
        url: config.url,
      })),
    };
  }

  _resolveServer(task) {
    if (typeof task.server !== "string" || task.server.trim() === "") {
      throw new Error(
        `${task.type} exige server (string, nome configurado em MCP_SERVERS_JSON)`,
      );
    }

    const config = this.servers[task.server];

    if (!config) {
      const known = Object.keys(this.servers);

      throw new Error(
        `Servidor MCP desconhecido: "${task.server}"` +
          (known.length > 0
            ? ` (servidores configurados: ${known.join(", ")})`
            : " (nenhum servidor MCP configurado -- defina MCP_SERVERS_JSON)"),
      );
    }

    return config;
  }

  /**
   * Abre uma conexão MCP nova contra `config`, roda `fn(client)` e
   * garante o fechamento da conexão mesmo se `fn` lançar — para que
   * uma falha numa chamada nunca vaze uma sessão HTTP aberta.
   */
  async _withClient(config, fn) {
    const client = new this.ClientClass(
      { name: "softload-worker-agent", version: "1.0.0" },
      { capabilities: {} },
    );

    const transport = new this.TransportClass(new URL(config.url), {
      fetch: this.fetchImpl,
      requestInit: config.headers ? { headers: config.headers } : undefined,
    });

    try {
      await client.connect(transport);

      return await fn(client);
    } finally {
      await client.close().catch(() => {});
    }
  }

  async listTools(task) {
    const config = this._resolveServer(task);

    const result = await this._withClient(config, (client) =>
      client.listTools(undefined, undefined, {
        timeout: DEFAULT_REQUEST_TIMEOUT_MS,
      }),
    );

    return {
      server: task.server,
      tools: result.tools
        .filter((tool) => !config.allowedTools || config.allowedTools.includes(tool.name))
        .map((tool) => ({
          name: tool.name,
          description: tool.description ?? null,
          inputSchema: tool.inputSchema,
        })),
    };
  }

  async callTool(task) {
    const config = this._resolveServer(task);

    const toolName = task.tool;
    if (typeof toolName !== "string" || toolName.trim() === "") {
      throw new Error(
        "mcp.call_tool exige tool (string, nome da ferramenta MCP)",
      );
    }

    if (config.allowedTools && !config.allowedTools.includes(toolName)) {
      throw new Error(
        `Ferramenta MCP não permitida no servidor "${task.server}": "${task.tool}". ` +
          `Permitidas: ${config.allowedTools.join(", ")}`,
      );
    }

    const result = await this._withClient(config, (client) =>
      client.callTool(
        { name: toolName, arguments: task.arguments || {} },
        undefined,
        { timeout: DEFAULT_REQUEST_TIMEOUT_MS },
      ),
    );

    return {
      server: task.server,
      tool: task.tool,
      isError: result.isError ?? false,
      content: result.content,
      structuredContent: result.structuredContent,
    };
  }
}
