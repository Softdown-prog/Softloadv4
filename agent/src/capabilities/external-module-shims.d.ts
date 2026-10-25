/**
 * Contratos usados apenas pela checagem TS do Agent.
 * Runtime real continua usando forge/index.cjs e execa da instalação npm.
 */
declare module "*.cjs" {
  const forge: {
    catalog(): unknown;
    readRecipe(recipeId?: string): unknown;
    render(task: {
      type: string;
      id?: string;
      command?: string;
      recipe?: unknown;
      receitaJson?: string;
      recipeId?: string;
    }, options: { baseDir: string }): Promise<unknown>;
  };
  export default forge;
}

declare module "execa" {
  export function execa(
    executable: string,
    args: string[],
    options: { cwd?: string; reject: false; timeout?: number },
  ): Promise<{
    exitCode: number | undefined;
    stdout: string;
    stderr: string;
    failed: boolean;
  }>;
}

/** Subconjunto tipado do Octokit exigido pelas operações do Agent. */
declare module "@octokit/rest" {
  export class Octokit {
    constructor(options: { auth: string });
    rest: import("./github.js").GithubClient["rest"];
  }
}

/** Limitador assíncrono tipado; nenhuma dependência extra em produção. */
declare module "p-limit" {
  export default function pLimit(concurrency: number): <T>(fn: () => Promise<T>) => Promise<T>;
}

/** Tipos transitórios mínimos: Node 22 ESM conserva os pacotes atuais. */
declare module "html-to-text" {
  export function convert(html: string, options: { wordwrap: false }): string;
}
declare module "@modelcontextprotocol/sdk/client/index.js" {
  export class Client {
    constructor(info: { name: string; version: string }, options: { capabilities: Record<string, never> });
    connect(transport: unknown): Promise<void>;
    close(): Promise<void>;
    listTools(a: undefined, b: undefined, options: { timeout: number }): Promise<{ tools: import("./mcp-client.js").McpTool[] }>;
    callTool(a: { name: string; arguments: Record<string, unknown> }, b: undefined, options: { timeout: number }): Promise<{ isError?: boolean; content: unknown; structuredContent?: unknown }>;
  }
}
declare module "@modelcontextprotocol/sdk/client/streamableHttp.js" {
  export class StreamableHTTPClientTransport {
    constructor(url: URL, options: { fetch: typeof fetch; requestInit?: { headers: Record<string, string> } });
  }
}
