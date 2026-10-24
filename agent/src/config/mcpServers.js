import { z } from "zod";

/**
 * Fonte única de configuração dos servidores MCP (Model Context
 * Protocol) que o Worker Agent pode consumir como cliente — ver
 * `capabilities/mcp-client.js`.
 *
 * Deliberadamente NÃO é um arquivo estático versionado (diferente de
 * `solaris-allowed-domains.js`): cada servidor tem uma URL e,
 * possivelmente, um cabeçalho de autenticação por ambiente (dev vs
 * produção), então mora numa env var (`MCP_SERVERS_JSON`), no mesmo
 * espírito de `SANDBOX_SERVICE_URL`/`SOLARIS_RAG_SEARCH_URL` — a
 * diferença é que aqui pode haver vários servidores nomeados de uma
 * vez, então um único JSON é mais prático que uma env var por campo
 * por servidor.
 *
 * Formato esperado (mesma forma usada por `claude_desktop_config.json`
 * do Claude Desktop, propositalmente — reduz a distância entre
 * configurar um servidor MCP aqui e em qualquer outro cliente MCP):
 *
 *   MCP_SERVERS_JSON='{
 *     "docs": {
 *       "url": "https://meu-servidor-mcp.exemplo.com/mcp",
 *       "headers": { "Authorization": "Bearer xyz" }
 *     }
 *   }'
 *
 * É exatamente este arquivo que permite plugar um servidor MCP novo
 * sem tocar em nenhum código: só editando a env var em produção. Os
 * presets opcionais de GitHub e Supabase, no fim deste arquivo, são
 * apenas atalhos seguros para os endpoints oficiais desses provedores.
 */
const mcpServerConfigSchema = z
  .object({
    url: z.string().url(),
    // Cabeçalhos extras (tipicamente autenticação) enviados em toda
    // requisição a este servidor — nunca logados/expostos por
    // mcp-client.js (ver McpClientCapability.listServers()).
    headers: z.record(z.string().min(1), z.string()).optional(),
    // Allowlist estrita, por nome exato. Se ausente, a permissão MCP
    // continua sendo a fronteira principal; se presente, o agente nem
    // lista nem chama ferramentas fora dela.
    allowedTools: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

const mcpServersConfigSchema = z.record(
  z.string().min(1),
  mcpServerConfigSchema,
);

/**
 * Faz o parse/validação de uma string JSON crua (o valor bruto da env
 * var) para o mapa `{ nome: { url, headers? } }`.
 *
 * String vazia/ausente é um caso válido (nenhum servidor configurado
 * ainda) — não um erro, já que a env var é opcional até o primeiro
 * servidor MCP real ser plugado.
 */
export function parseMcpServersConfig(rawJson) {
  if (rawJson === undefined || rawJson === null || rawJson.trim() === "") {
    return {};
  }

  let parsed;

  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    throw new Error(
      `MCP_SERVERS_JSON inválido: não é um JSON válido (${error.message})`,
    );
  }

  const result = mcpServersConfigSchema.safeParse(parsed);

  if (!result.success) {
    throw new Error(
      `MCP_SERVERS_JSON inválido: ${JSON.stringify(result.error.issues)}`,
    );
  }

  return result.data;
}

function optionalEnv(env, name) {
  const value = env[name];
  return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
}

function parseAllowedTools(raw, envName) {
  if (raw === undefined) return undefined;

  const tools = raw.split(",").map((tool) => tool.trim()).filter(Boolean);
  if (tools.length === 0) {
    throw new Error(`${envName} precisa conter ao menos uma ferramenta MCP.`);
  }
  if (new Set(tools).size !== tools.length) {
    throw new Error(`${envName} não pode repetir ferramentas MCP.`);
  }
  return tools;
}

function requireHttpsUrl(rawUrl, envName) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${envName} precisa ser uma URL HTTPS válida.`);
  }
  if (url.protocol !== "https:") {
    throw new Error(`${envName} precisa usar HTTPS.`);
  }
  return url;
}

function addPreset(servers, name, config) {
  if (servers[name]) {
    throw new Error(
      `Configuração MCP duplicada para "${name}": use MCP_SERVERS_JSON ou as env vars do preset, não ambos.`,
    );
  }
  servers[name] = config;
}

function addGithubPreset(servers, env) {
  const token = optionalEnv(env, "GITHUB_MCP_TOKEN");
  const urlOverride = optionalEnv(env, "GITHUB_MCP_URL");
  const allowedTools = parseAllowedTools(optionalEnv(env, "GITHUB_MCP_ALLOWED_TOOLS"), "GITHUB_MCP_ALLOWED_TOOLS");

  if (!token) {
    if (urlOverride || allowedTools) {
      throw new Error("GITHUB_MCP_TOKEN é obrigatório ao configurar GitHub MCP.");
    }
    return;
  }

  const url = requireHttpsUrl(urlOverride || "https://api.githubcopilot.com/mcp/", "GITHUB_MCP_URL");
  addPreset(servers, "github", {
    url: url.toString(),
    headers: { Authorization: `Bearer ${token}` },
    ...(allowedTools ? { allowedTools } : {}),
  });
}

function addSupabasePreset(servers, env) {
  const token = optionalEnv(env, "SUPABASE_MCP_ACCESS_TOKEN");
  const projectRef = optionalEnv(env, "SUPABASE_MCP_PROJECT_REF");
  const urlOverride = optionalEnv(env, "SUPABASE_MCP_URL");
  const features = optionalEnv(env, "SUPABASE_MCP_FEATURES") || "database,docs";
  const allowedTools = parseAllowedTools(optionalEnv(env, "SUPABASE_MCP_ALLOWED_TOOLS"), "SUPABASE_MCP_ALLOWED_TOOLS");
  const readOnly = optionalEnv(env, "SUPABASE_MCP_READ_ONLY") || "true";

  const hasAnySupabaseSetting = Boolean(token || projectRef || urlOverride || allowedTools || optionalEnv(env, "SUPABASE_MCP_READ_ONLY") || optionalEnv(env, "SUPABASE_MCP_FEATURES"));
  if (!hasAnySupabaseSetting) return;
  if (!token) throw new Error("SUPABASE_MCP_ACCESS_TOKEN é obrigatório ao configurar Supabase MCP.");
  if (!projectRef) throw new Error("SUPABASE_MCP_PROJECT_REF é obrigatório para limitar o Supabase MCP a um projeto.");
  if (readOnly !== "true" && readOnly !== "false") {
    throw new Error("SUPABASE_MCP_READ_ONLY precisa ser \"true\" ou \"false\".");
  }

  const url = requireHttpsUrl(urlOverride || "https://mcp.supabase.com/mcp", "SUPABASE_MCP_URL");
  url.searchParams.set("project_ref", projectRef);
  url.searchParams.set("read_only", readOnly);
  url.searchParams.set("features", features);
  addPreset(servers, "supabase", {
    url: url.toString(),
    headers: { Authorization: `Bearer ${token}` },
    ...(allowedTools ? { allowedTools } : {}),
  });
}

/**
 * Lê e valida `MCP_SERVERS_JSON` do ambiente informado (por padrão,
 * `process.env`). `env` é injetável só para permitir testar sem mexer
 * em variáveis de ambiente globais do processo.
 */
export function loadMcpServersConfig(env = process.env) {
  const servers = parseMcpServersConfig(env.MCP_SERVERS_JSON);
  addGithubPreset(servers, env);
  addSupabasePreset(servers, env);
  return servers;
}
