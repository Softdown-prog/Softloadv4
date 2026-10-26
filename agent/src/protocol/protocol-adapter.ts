import type { AgentTask } from "../core/task-router.js";

export interface ProtocolAction {
  id: string;
  capability: string;
  operation: string;
  input: Record<string, unknown>;
}
export interface ProtocolRequest {
  actions: ProtocolAction[];
}

import { ProtocolError } from "./protocol.js";

// Prefixo de `task.type` usado internamente pelo TaskRouter, por
// capability. Na maioria dos casos é igual ao nome da capability —
// a exceção é "artifacts", cujo prefixo interno é o singular
// "artifact" (ver nota em task-router.js). Centralizar isso aqui
// evita que essa particularidade fique espalhada/duplicada em
// vários lugares do código.
const TASK_TYPE_PREFIX: Record<string, string> = {
  forge: "forge",
  filesystem: "file",
  shell: "shell",
  git: "git",
  github: "github",
  storage: "storage",
  artifacts: "artifact",
  build: "build",
  test: "test",
  package: "package",
  process: "process",
  // "code-analysis" e "code-search" compartilham o mesmo prefixo
  // "code" (mas capabilities/task.type diferentes — "code.analyze"
  // vs "code.search" — sem colisão, já que a operação depois do
  // ponto é diferente).
  "code-analysis": "code",
  "code-search": "code",
  "project-inspector": "project",
  // "web-search" e "web-fetch" compartilham o prefixo "web" (mesmo
  // raciocínio de "code-analysis"/"code-search" acima) -- task.type
  // vira "web.search" e "web.fetch" respectivamente, sem colisão.
  "web-search": "web",
  "web-fetch": "web",
  "knowledge-search": "knowledge",
  mcp: "mcp",
  escalation: "escalation",
};

// Alguns campos do protocolo usam snake_case (convenção comum em
// APIs JSON), enquanto o código interno usa camelCase (convenção do
// JS). Este mapa traduz nome-do-campo-no-protocolo ->
// nome-do-campo-interno, por capability. Só precisa listar os
// campos que realmente mudam de nome — os demais são copiados como
// estão.
const FIELD_RENAMES: Record<string, Record<string, string>> = {
  forge: { recipe_id: 'recipeId', recipe_json: 'receitaJson', output_path: 'outputPath' },
  filesystem: {
    old_string: "oldString",
    new_string: "newString",
    replace_all: "replaceAll",
    new_content: "newContent",
  },
  github: {
    issue_number: "issueNumber",
    pull_number: "pullNumber",
  },
  shell: {
    timeout_ms: "timeoutMs",
  },
  git: {
    add_all: "addAll",
  },
  build: {
    timeout_ms: "timeoutMs",
  },
  test: {
    timeout_ms: "timeoutMs",
  },
  package: {
    timeout_ms: "timeoutMs",
  },
  process: {
    timeout_ms: "timeoutMs",
    process_id: "processId",
    callback_url: "callbackUrl",
    callback_secret: "callbackSecret",
  },
  "code-analysis": {
    max_files: "maxFiles",
  },
  "code-search": {
    max_results: "maxResults",
    case_sensitive: "caseSensitive",
  },
  "web-search": {
    max_results: "maxResults",
    allowed_domains: "allowedDomains",
  },
  "web-fetch": {
    max_bytes: "maxBytes",
    timeout_ms: "timeoutMs",
  },
  escalation: {
    callback_url: "callbackUrl",
    callback_secret: "callbackSecret",
    escalation_id: "escalationId",
  },  "knowledge-search": {
    top_k: "topK",
  },
};

/**
 * Converte uma action já validada pelo protocolo (parseTaskRequest)
 * no formato de task esperado por Agent.execute() / TaskRouter.
 *
 * Ex:
 *   { id: "a1", capability: "filesystem", operation: "read",
 *     input: { path: "src/index.js" } }
 *   ->
 *   { type: "file.read", path: "src/index.js" }
 *
 *   { id: "a2", capability: "shell", operation: "execute",
 *     input: { command: "npm test", timeout_ms: 30000 } }
 *   ->
 *   { type: "shell.execute", command: "npm test", timeoutMs: 30000 }
 */
export function actionToTask(action: ProtocolAction): AgentTask {
  const prefix = TASK_TYPE_PREFIX[action.capability];

  if (!prefix) {
    // Só aconteceria se uma nova capability fosse adicionada ao
    // protocolo (actionSchema/CAPABILITY_OPERATIONS) sem atualizar
    // este mapa — erro de configuração, não de input do usuário.
    throw new ProtocolError(
      `Nenhum prefixo de task.type configurado para capability: ${action.capability}`,
      "TASK_TYPE_PREFIX_NOT_FOUND",
    );
  }

  const type = `${prefix}.${action.operation}`;

  const renames = FIELD_RENAMES[action.capability] || {};

  const renamedInput: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(action.input)) {
    const renamedKey = renames[key] || key;
    renamedInput[renamedKey] = value;
  }

  return {
    type,
    ...renamedInput,
  };
}

/**
 * Converte uma request inteira (já validada por parseTaskRequest)
 * em uma lista de tasks prontas para Agent.execute(), preservando a
 * referência ao `id` original de cada action — necessário para
 * o chamador (ex: endpoint HTTP) casar cada resultado de volta com
 * a action que o gerou, já que Agent.execute() não sabe nada sobre
 * "id" de protocolo.
 */
export function requestToTasks(request: ProtocolRequest) {
  return request.actions.map((action) => ({
    actionId: action.id,
    task: actionToTask(action),
  }));
}

