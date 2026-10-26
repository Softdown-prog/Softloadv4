import type { ProtocolAction, ProtocolRequest } from "./protocol-adapter.js";

/** Uma operacao permite apenas objetos ja validados pelo schema Zod. */
type ValidatedInputSchema = {
  safeParse(input: unknown):
    | { success: true; data: Record<string, unknown> }
    | { success: false; error: { issues: unknown[] } };
};

import { z } from "zod";

// ── Schemas de input por capability ─────────────────────────────
// Cada schema define os campos aceitos para AQUELA capability como
// um todo (não por operação específica). `.strict()` rejeita
// qualquer campo extra não listado, evitando que dados inesperados
// passem adiante silenciosamente.

// Formato do patch gerado por FileSystemCapability.diff() / esperado
// por FileSystemCapability.patch() -- espelha exatamente a estrutura
// escrita por `writePatch()` em Power-up/diff_patch_engine.cpp
// (formato "structural-token-diff-v2"). Validado aqui na borda do
// protocolo por defesa em profundidade -- o binário C++ já rejeita
// (exit 20) qualquer JSON que não bata com isso, mas validar cedo
// aqui evita gastar um subprocesso inteiro só pra descobrir que o
// campo `ops` nem é um array.
const diffPatchOpSchema = z.object({
  op: z.enum(["equal", "delete", "insert"]),
  text: z.string(),
}).strict();

const diffPatchSchema = z.object({
  format: z.string().min(1),
  sourceHash: z.string().min(1),
  ops: z.array(diffPatchOpSchema),
}).strict();

const filesystemInput = z.object({
  // Opcional aqui (mesma observação de schema-por-capability, não por
  // operação, já documentada abaixo pra old_string/new_string): "list"
  // e "search" já tratam path ausente como "." na própria capability
  // (ver filesystem.js) -- torná-lo obrigatório aqui bloquearia essas
  // duas operações mesmo sem nenhuma razão técnica (achado real,
  // pego rodando o servidor HTTP de ponta a ponta contra
  // filesystem.list). "read"/"write"/"edit"/"delete" continuam
  // exigindo path de fato -- a checagem fica dentro de cada método da
  // capability, igual ao resto das exigências específicas de operação.
  path: z.string().min(1).optional(),
  content: z.string().optional(),
  pattern: z.string().optional(),
  // Campos específicos de "edit" (substituição de string exata, ver
  // filesystem.js:edit()) — opcionais aqui porque o schema é por
  // capability, não por operação (mesma observação já documentada
  // acima para `gitInput.message`).
  old_string: z.string().min(1).optional(),
  new_string: z.string().optional(),
  replace_all: z.boolean().optional(),
  // Campos específicos de "diff" (ver filesystem.js:diff()) e "patch"
  // (ver filesystem.js:patch()) — mesma observação de schema-por-
  // capability já feita acima: opcionais aqui, exigidos dentro do
  // método específico.
  new_content: z.string().optional(),
  patch: diffPatchSchema.optional(),
  // Campos específicos de "read" (paginação por linha, ver
  // filesystem.js:read()). Teto de 10000 aqui é só defesa em
  // profundidade adicional na borda do protocolo — o default
  // aplicado sem `limit` é bem menor (DEFAULT_READ_LIMIT_LINES, 2000).
  offset: z.number().int().positive().optional(),
  limit: z.number().int().positive().max(10000).optional(),
}).strict();

const shellInput = z.object({
  command: z.string().min(1),
  // Limite máximo de 10 minutos (600000ms) para o timeout que o
  // chamador pode pedir — evita que uma action tente travar um
  // processo indefinidamente.
  timeout_ms: z.number().int().positive().max(600000).optional(),
}).strict();

const gitInput = z.object({
  // Nota: `message` é opcional aqui, mas a operação "commit"
  // realmente precisa dele (GitCapability.commit() já valida isso
  // internamente). Como o schema é por capability, não por
  // operação, esse tipo de exigência específica não é pega neste
  // nível — só mais adiante, dentro da capability real.
  message: z.string().min(1).optional(),
  branch: z.string().min(1).optional(),
  // Espelham as opções adicionadas em GitCapability.commit():
  // arquivos específicos para `git add`, ou tudo (`git add -A`).
  files: z.array(z.string().min(1)).optional(),
  add_all: z.boolean().optional(),
}).strict();

const githubInput = z.object({
  owner: z.string().min(1).optional(),
  repository: z.string().min(1).optional(),
  issue_number: z.number().int().positive().optional(),
  // pull_number e head/base são específicos de pull_request_get/
  // pull_request_create (ver mesma observação já documentada acima
  // pra gitInput.message sobre schema-por-capability, não por
  // operação).
  pull_number: z.number().int().positive().optional(),
  title: z.string().min(1).optional(),
  body: z.string().optional(),
  head: z.string().min(1).optional(),
  base: z.string().min(1).optional(),
}).strict();

const storageInput = z.object({
  bucket: z.string().min(1),
  path: z.string().min(1),
  content: z.string().optional(),
}).strict();

const artifactsInput = z.object({
  name: z.string().min(1),
  path: z.string().min(1).optional(),
}).strict();

// build/test: mesma forma (comando opcional — se omitido, a
// capability detecta um candidato sozinha via build.detect/
// test.detect; timeout_ms com o mesmo teto de shellInput).
const buildInput = z.object({
  command: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(600000).optional(),
}).strict();

const testInput = buildInput;

const packageInput = z.object({
  package: z.string().min(1).optional(),
  ecosystem: z.enum(["npm", "composer", "pip"]).optional(),
  timeout_ms: z.number().int().positive().max(600000).optional(),
}).strict();

const processInput = z.object({
  command: z.string().min(1).optional(),
  timeout_ms: z.number().int().positive().max(600000).optional(),
  process_id: z.string().min(1).optional(),
  signal: z.string().min(1).optional(),
  // callback_url/callback_secret: webhook opcional de "processo
  // terminado" (process.start), ver notifications/webhook-delivery.js.
  // Os dois juntos, ou nenhum -- checado dentro de process.js, não
  // aqui (mesmo critério de outras exigências condicionais já
  // documentadas neste arquivo).
  callback_url: z.string().min(1).optional(),
  callback_secret: z.string().min(16).optional(),
}).strict();

const codeAnalysisInput = z.object({
  path: z.string().min(1).optional(),
  max_files: z.number().int().positive().max(2000).optional(),
}).strict();

const codeSearchInput = z.object({
  pattern: z.string().min(1),
  path: z.string().min(1).optional(),
  max_results: z.number().int().positive().max(1000).optional(),
  case_sensitive: z.boolean().optional(),
  glob: z.string().min(1).optional(),
}).strict();

// project-inspector: nenhum campo de input — inspect() só lê o
// workspace inteiro, sem parâmetros.
const projectInspectorInput = z.object({}).strict();

const webSearchInput = z.object({
  query: z.string().min(1).max(1000),
  max_results: z.number().int().positive().max(20).optional(),
  language: z.string().min(1).optional(),
  context: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  allowed_domains: z.array(z.string().min(1)).optional(),
}).strict();

// web-fetch: busca uma URL específica diretamente -- proteção contra
// SSRF (host bloqueado/IP privado, limite de redirecionamento) fica
// dentro de web-fetch.js, não aqui; este schema só garante os tipos.
const webFetchInput = z.object({
  url: z.string().min(1),
  max_bytes: z.number().int().positive().optional(),
  timeout_ms: z.number().int().positive().max(60000).optional(),
}).strict();

// escalation: canal de escalonamento pra humano -- schema por
// capability (não por operação, mesma observação já documentada
// acima pra gitInput.message): "request" exige question, "respond"
// exige escalation_id+decision, "get" exige escalation_id, "list" não
// exige nada -- checado dentro de escalation.js, não aqui.
const escalationInput = z.object({
  question: z.string().min(1).optional(),
  context: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
  callback_url: z.string().min(1).optional(),
  callback_secret: z.string().min(16).optional(),
  escalation_id: z.string().min(1).optional(),
  decision: z.string().min(1).optional(),
  note: z.string().optional(),
}).strict();

// knowledge-search: consulta por palavras-chave ao catálogo RAG do
// Solaris, via endpoint interno do app principal — ver
// knowledge-search.js e src/routes/apiRoutes.js (POST
// /internal/solaris/rag/buscar) no repositório Node principal.
const knowledgeSearchInput = z.object({
  query: z.string().min(1).max(1000),
  top_k: z.number().int().positive().max(20).optional(),
}).strict();

// mcp: cliente genérico do Model Context Protocol -- server é o nome
// de um servidor configurado em MCP_SERVERS_JSON (ver
// config/mcpServers.js), nunca uma URL literal (a URL/segredo de
// autenticação ficam só na configuração do lado do agent, nunca no
// protocolo externo). "list_servers" não usa nenhum campo de input
// (mesma observação de schema-por-capability-não-por-operação já
// documentada acima para gitInput.message/githubInput.pull_number):
// server/tool são opcionais aqui, mas "list_tools"/"call_tool" de
// fato exigem server (e "call_tool" também exige tool) -- checado
// dentro de mcp-client.js, não neste nível.
const mcpInput = z.object({
  server: z.string().min(1).optional(),
  tool: z.string().min(1).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).strict();

// ── Schema de uma action individual ─────────────────────────────

const actionSchema = z.object({
  id: z.string().min(1).max(100),

  capability: z.enum([
    "forge",
    "filesystem",
    "shell",
    "git",
    "github",
    "storage",
    "artifacts",
    "build",
    "test",
    "package",
    "process",
    "code-analysis",
    "code-search",
    "project-inspector",
    "web-search",
    "web-fetch",
    "knowledge-search",
    "mcp",
    "escalation",
  ]),

  operation: z.string().min(1).max(100),

  // Validação "grosseira" nesta etapa: apenas garante que é um
  // objeto simples de chaves string -> valor desconhecido. A
  // validação real e específica acontece depois, em
  // validateOperation(), usando o schema correspondente à
  // capability.
  input: z.record(z.string(), z.unknown()).default({}),
}).strict();

// ── Schema da request completa ──────────────────────────────────

const requestSchema = z.object({
  request_id: z.string().min(1).max(200),

  // `z.literal("execute")`: por enquanto só existe um tipo de task
  // suportado no protocolo; usar literal (em vez de enum) já deixa
  // claro que é fixo, e facilita adicionar outros valores no futuro
  // sem quebrar a validação existente.
  task: z.literal("execute"),

  actions: z
    .array(actionSchema)
    .min(1)
    .max(50), // limite superior evita requests com centenas/milhares de actions
}).strict();

// ── Operações válidas por capability ─────────────────────────────
// Funciona como a allowlist de "operation" aceitas para cada
// capability — evita que alguém passe uma capability válida com uma
// operação inventada/typo.

const CAPABILITY_OPERATIONS: Record<string, Set<string>> = {
  forge: new Set(['catalog', 'recipe', 'render']),
  filesystem: new Set([
    "read",
    "write",
    "edit",
    "diff",
    "patch",
    "delete",
    "list",
    "search",
  ]),

  shell: new Set([
    "execute",
  ]),

  git: new Set([
    "status",
    "diff",
    "log",
    "branch",
    "commit",
  ]),

  github: new Set([
    "issue_create",
    "issue_get",
    "pull_request_create",
    "pull_request_get",
    "repository_get",
  ]),

  storage: new Set([
    "read",
    "write",
    "delete",
    "list",
  ]),

  artifacts: new Set([
    "build",
    "push",
    "list",
  ]),

  build: new Set([
    "detect",
    "run",
  ]),

  test: new Set([
    "detect",
    "run",
  ]),

  package: new Set([
    "install",
    "add",
  ]),

  process: new Set([
    "start",
    "status",
    "output",
    "kill",
  ]),

  "code-analysis": new Set([
    "analyze",
  ]),

  "code-search": new Set([
    "search",
  ]),

  "project-inspector": new Set([
    "inspect",
  ]),

  "web-search": new Set([
    "search",
  ]),

  "web-fetch": new Set([
    "fetch",
  ]),


  "knowledge-search": new Set([
    "search",
  ]),

  mcp: new Set([
    "list_servers",
    "list_tools",
    "call_tool",
  ]),

  escalation: new Set([
    "request",
    "respond",
    "get",
    "list",
  ]),
};

// Mapa de capability -> schema de input correspondente, usado em
// validateOperation() para saber qual schema aplicar.
const INPUT_SCHEMAS: Record<string, ValidatedInputSchema> = {
  forge: z.object({
    id: z.string().min(1).max(64).optional(),
    command: z.string().min(1).optional(),
    recipe_id: z.string().min(1).optional(),
    recipe_json: z.string().max(128 * 1024).optional(),
    output_path: z.string().min(1).optional(),
  }).strict(),
  filesystem: filesystemInput,
  shell: shellInput,
  git: gitInput,
  github: githubInput,
  storage: storageInput,
  artifacts: artifactsInput,
  build: buildInput,
  test: testInput,
  package: packageInput,
  process: processInput,
  "code-analysis": codeAnalysisInput,
  "code-search": codeSearchInput,
  "project-inspector": projectInspectorInput,
  "web-search": webSearchInput,
  "web-fetch": webFetchInput,
  "knowledge-search": knowledgeSearchInput,
  mcp: mcpInput,
  escalation: escalationInput,
};

/**
 * Valida uma action já validada estruturalmente pelo actionSchema
 * (capability é um enum válido, operation é string, etc.), mas
 * ainda checando:
 * 1. Se a capability é reconhecida (redundante com o enum do Zod,
 *    mas serve de proteção extra caso o enum mude no futuro).
 * 2. Se a operation é válida PARA aquela capability específica.
 * 3. Se o input bate com o schema específico da capability.
 *
 * Retorna a action com `input` já normalizado/validado pelo Zod
 * (ex: aplicando defaults, coerções, etc. definidos no schema).
 */
function validateOperation(action: ProtocolAction): ProtocolAction {
  const operations =
    CAPABILITY_OPERATIONS[action.capability];

  if (!operations) {
    throw new ProtocolError(
      `Capability não suportada: ${action.capability}`,
      "CAPABILITY_NOT_SUPPORTED",
    );
  }

  if (!operations.has(action.operation)) {
    throw new ProtocolError(
      `Operação não suportada: ${action.capability}.${action.operation}`,
      "OPERATION_NOT_SUPPORTED",
    );
  }

  const schema =
    INPUT_SCHEMAS[action.capability];

  if (!schema) {
    // Não deveria acontecer na prática (toda capability em
    // CAPABILITY_OPERATIONS tem um schema correspondente em
    // INPUT_SCHEMAS), mas protege contra as duas listas ficarem
    // dessincronizadas no futuro (ex: alguém adiciona uma
    // capability em um mapa e esquece do outro).
    throw new ProtocolError(
      `Schema inexistente para capability: ${action.capability}`,
      "INPUT_SCHEMA_NOT_FOUND",
    );
  }

  // safeParse (em vez de parse) permite tratar o erro de forma
  // customizada, incluindo os `issues` detalhados do Zod no
  // ProtocolError, em vez de deixar a exceção nativa do Zod vazar.
  const result = schema.safeParse(action.input);

  if (!result.success) {
    throw new ProtocolError(
      `Input inválido para ${action.capability}.${action.operation}`,
      "INVALID_ACTION_INPUT",
      result.error.issues,
    );
  }

  return {
    ...action,
    input: result.data,
  };
}

/**
 * Ponto de entrada principal: valida um payload bruto (ex: vindo de
 * uma requisição HTTP) contra o protocolo completo.
 *
 * Fail-fast: `actions.map(validateOperation)` interrompe no
 * primeiro erro encontrado — se qualquer action for inválida, a
 * request inteira é rejeitada (nenhuma action é executada
 * parcialmente).
 *
 * Lança ProtocolError em caso de payload inválido; quem chama deve
 * tratar esse erro (ex: responder 400 numa API HTTP).
 */
export function parseTaskRequest(payload: unknown): ProtocolRequest & { request_id: string; task: string } {
  const requestResult =
    requestSchema.safeParse(payload);

  if (!requestResult.success) {
    throw new ProtocolError(
      "Payload do Worker inválido",
      "INVALID_REQUEST",
      requestResult.error.issues,
    );
  }

  const request = requestResult.data;

  const actions = request.actions.map(
    validateOperation,
  );

  return {
    request_id: request.request_id,
    task: request.task,
    actions,
  };
}

/**
 * Versão booleana de parseTaskRequest, útil para checagens rápidas
 * sem precisar de try/catch no código chamador. Descarta os
 * detalhes do erro — usar parseTaskRequest diretamente quando os
 * detalhes importarem (ex: para responder com uma mensagem de erro
 * útil).
 */
export function isValidTaskRequest(payload: unknown): boolean {
  try {
    parseTaskRequest(payload);
    return true;
  } catch {
    return false;
  }
}

/**
 * Retorna um objeto simples { capability: [operations] }, útil para
 * expor via endpoint de introspecção/documentação (ex: um
 * "/capabilities" que lista o que o Worker suporta), já que Sets
 * não serializam bem em JSON diretamente.
 */
export function getSupportedOperations(): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(CAPABILITY_OPERATIONS).map(
      ([capability, operations]) => [
        capability,
        [...operations],
      ],
    ),
  );
}

/**
 * Erro customizado do protocolo, com `code` (string estável, útil
 * para o cliente tratar programaticamente sem parsear a mensagem)
 * e `details` opcional (ex: os `issues` do Zod, com o path exato do
 * campo que falhou).
 *
 * Nota: esta classe é usada por parseTaskRequest/validateOperation,
 * definidos ACIMA dela no arquivo. Isso funciona sem erro porque
 * são function declarations (hoisted) que só referenciam
 * ProtocolError quando de fato chamadas — e, a essa altura, o
 * módulo inteiro (incluindo esta classe) já terminou de ser
 * avaliado. Ainda assim, por clareza de leitura, pode valer mover
 * esta classe para o topo do arquivo ou para um arquivo separado de
 * erros (como o AgentError usado nos outros módulos).
 */
export class ProtocolError extends Error {
  declare code: string;
  declare details: unknown;

  constructor(
    message: string,
    code: string = "PROTOCOL_ERROR",
    details: unknown = undefined,
  ) {
    super(message);

    this.name = "ProtocolError";
    this.code = code;
    this.details = details;
  }
}

