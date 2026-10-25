/**
 * Contratos tipados das permissões do Agent. Sem alterar o comportamento
 * fail-closed do modo restrito nem o bypass explícito do modo full.
 */
export interface PermissionsOptions {
  mode?: string;
  role?: string;
  permissions?: Record<string, boolean>;
}
export interface PermissionsSnapshot {
  mode: string;
  role: string;
  [action: string]: string | boolean;
}

/**
 * Permissions: controla quais ações (identificadas pelo mesmo `type`
 * usado no TASK_MAP do TaskRouter) o agent tem autorização para
 * executar.
 *
 * Duas camadas de controle:
 * 1. `mode`: se for "full", TODAS as ações são permitidas,
 *    independente do que estiver no mapa `permissions` (bypass
 *    total — ver observação em `can()`).
 * 2. `permissions`: mapa de allowlist/denylist granular por ação,
 *    usado sempre que `mode` não for "full".
 */
// Configuração padrão de permissões, uma entrada por tipo de task
// suportado (deve ficar em sincronia com o TASK_MAP do TaskRouter).
// Ações potencialmente perigosas ou irreversíveis (delete,
// shell.execute, git.commit, github.*create, artifact.push) vêm
// desabilitadas por padrão — modelo "seguro por padrão" (fail
// closed). Extraído para uma constante de módulo (em vez de ficar
// só dentro do construtor) para que os presets por papel em
// role-permissions.js possam partir dela via spread, sem duplicar a
// lista inteira.
const DEFAULT_PERMISSIONS: Record<string, boolean> = {
  "forge.catalog": true,
  "forge.recipe": true,
  // Only the Coder may generate files; no shell permission is needed.
  "forge.render": false,
  "file.read": true,
  "file.write": true,
  "file.edit": true,
  // diff só CALCULA (lê o atual + recebe o conteúdo alvo, nunca
  // escreve) -- mesmo risco de file.read; patch ESCREVE (aplica um
  // patch já calculado) -- mesmo risco de file.write/file.edit,
  // então acompanha o mesmo default `true` dos dois.
  "file.diff": true,
  "file.patch": true,
  "file.delete": false,
  "file.list": true,
  "file.search": true,

  "shell.execute": false,

  "git.status": true,
  "git.diff": true,
  "git.log": true,
  "git.branch": true,
  "git.commit": false,

  "github.issue_create": false,
  "github.issue_get": true,
  "github.pull_request_create": false,
  "github.pull_request_get": true,
  "github.repository_get": true,

  "storage.read": true,
  "storage.write": true,
  "storage.delete": false,
  "storage.list": true,

  "artifact.build": false,
  "artifact.push": false,
  "artifact.list": true,

  // Detecção/inspeção/busca são só leitura, nunca executam nada —
  // mesmo critério já usado acima para git.status/diff/log/branch e
  // file.list/file.search (seguro por padrão). "Rodar" um comando de
  // build/test/pacote/processo já é uma ação com custo/efeito real
  // (mesma categoria de shell.execute), então fica negada por padrão
  // — o preset do Validador (createValidatorPermissions) libera
  // build.run/test.run explicitamente, já que essa é a única razão
  // dele existir.
  "build.detect": true,
  "build.run": false,

  "test.detect": true,
  "test.run": false,

  "package.install": false,
  "package.add": false,

  "process.start": false,
  // status/output são consulta read-only sobre um processo que já
  // foi iniciado por ESTE MESMO agent (cada Agent tem seu próprio
  // Map de processos — sem process.start bem-sucedido antes, nunca
  // existe um processId válido pra consultar de qualquer forma).
  "process.status": true,
  "process.output": true,
  "process.kill": false,

  // Mesmo critério de process.start/status/output/kill acima:
  // request/respond têm efeito real (cria/resolve uma pendência,
  // dispara webhook), get/list são só consulta — ver escalation.js.
  "escalation.request": false,
  "escalation.respond": false,
  "escalation.get": true,
  "escalation.list": true,

  "code.analyze": true,
  "code.search": true,
  "project.inspect": true,

  // Chama uma API externa paga (Gemini) com custo/quota reais — não
  // é só leitura local, então fica negada por padrão como
  // shell.execute/artifact.build, mesmo não sendo uma ação
  // "perigosa" no sentido de dano ao sistema.
  "web.search": false,

  // Busca uma URL ARBITRÁRIA diretamente (GET), não mediada por
  // nenhuma API paga com filtro de domínio embutido (diferente de
  // web.search, que só consulta a Gemini API). Superfície de risco
  // real: mesmo com a proteção contra SSRF embutida em web-fetch.js
  // (host bloqueado, IP privado/reservado, revalidação a cada
  // redirecionamento), é a única capability deste agent que aceita
  // qualquer URL http(s) publicamente alcançável passada pelo
  // chamador. Negada por padrão, mesmo critério de web.search.
  "web.fetch": false,

  // Roda um container isolado (sandbox-efemoro/) em Cloud Run —
  // custo real de compute/rede, mesma categoria de web.search/
  // build.run/test.run. Só o preset do Validador
  // (createValidatorPermissions) libera isto, mesmo raciocínio de
  // build.run/test.run: é o papel cujo trabalho É auditar o
  // resultado (aqui, visualmente/acessibilidade, via navegador real).
  "websandbox.run": false,

  // Extração segura de ZIP -- roda no MESMO serviço isolado
  // sandbox-efemoro/ de websandbox.run (container/credenciais
  // separados, ver capabilities/archive.js), mesma categoria de
  // custo de compute/rede. Continua negada no preset default
  // (fail closed); role-permissions.js a libera somente para o Coder,
  // que já pode ler e gravar arquivos no workspace. Outros papéis
  // ainda precisam de permissions.grant() pontual.
  "archive.extract_zip": false,

  // Consulta vetorial: o modelo de embeddings Python é local,
  // mas a busca consome CPU/rede e operações no Firestore. O default
  // continua negado; presets técnicos liberam leitura pontualmente.
  "knowledge.search": false,

  // Cliente MCP genérico (mcp-client.js) — fala com QUALQUER servidor
  // MCP de terceiros configurado em MCP_SERVERS_JSON, não com um
  // serviço isolado próprio da Softload (diferente de websandbox.run/
  // knowledge.search). Superfície de risco desconhecida por natureza
  // (a ferramenta exposta por um servidor MCP externo pode fazer
  // qualquer coisa), então tratado com a MESMA cautela de
  // knowledge.search: transversal, deliberadamente NÃO liberado em
  // nenhum preset de role.js, disponível só via permissions.grant()
  // pontual. "list_servers" só lê configuração local (sem custo/rede),
  // mas mantido igualmente negado por padrão por simplicidade — não
  // há necessidade prática de abrir uma exceção só pra essa operação.
  "mcp.list_servers": false,
  "mcp.list_tools": false,
  "mcp.call_tool": false,

  // Negado por padrão: só o preset do Orquestrador
  // (createOrchestratorPermissions) libera isto.
  "agent.dispatch": false,

  // Fan-out de agent.dispatch (N dispatches em paralelo, isolados em
  // git worktrees por padrão) — mesmo critério de agent.dispatch:
  // negado por padrão, só o preset do Orquestrador libera.
  "agent.dispatch_parallel": false,

  // Registro EM MEMÓRIA de progresso (plan-tracker.js) — mesmo
  // critério de agent.dispatch/agent.dispatch_parallel: negado por
  // padrão, só o preset do Orquestrador libera (sub-agentes não têm
  // motivo pra tocar o plano diretamente).
  "plan.create": false,
  "plan.add_item": false,
  "plan.update_item": false,
  "plan.list": false,
  "plan.get": false,
};

/**
 * Permissions: controla quais ações (identificadas pelo mesmo `type`
 * usado no TASK_MAP do TaskRouter) o agent tem autorização para
 * executar.
 *
 * Duas camadas de controle:
 * 1. `mode`: se for "full", TODAS as ações são permitidas,
 *    independente do que estiver no mapa `permissions` (bypass
 *    total — ver observação em `can()`).
 * 2. `permissions`: mapa de allowlist/denylist granular por ação,
 *    usado sempre que `mode` não for "full".
 */
export class Permissions {
  declare mode: string;
  declare role: string;
  declare permissions: Record<string, boolean>;

  constructor({ mode = "restricted", permissions, role }: PermissionsOptions = {}) {
    // Qualquer valor diferente de "full" se comporta como
    // "restricted" na prática, já que `can()` só faz um check
    // especial para "full" — não há validação/enum de modos aqui.
    this.mode = mode;

    // Rótulo opcional (ex: "explorer", "coder", "validator"), só
    // para facilitar logging/auditoria — não afeta a lógica de
    // permissão em si.
    this.role = role || "default";

    // Permite passar um mapa customizado (ex: um preset por papel,
    // ver role-permissions.js), mesclado sobre o default: qualquer
    // ação não mencionada no override mantém o valor padrão, em vez
    // de precisar redeclarar o mapa inteiro toda vez.
    this.permissions = {
      ...DEFAULT_PERMISSIONS,
      ...(permissions || {}),
    };
  }

  /**
   * Verifica se uma ação é permitida.
   *
   * IMPORTANTE: em modo "full", retorna `true` para QUALQUER ação,
   * sem sequer consultar `this.permissions`. Isso significa que
   * `revoke()` não tem efeito algum enquanto `mode === "full"`.
   */
  can(action: string) {
    if (this.mode === "full") {
      return true;
    }

    // `=== true` explícito: ações não listadas no mapa retornam
    // `undefined`, que não é `=== true`, então o default para
    // qualquer ação desconhecida é negar (fail closed).
    return this.permissions[action] === true;
  }

  /**
   * Como can(), mas lança um erro (com `code: "PERMISSION_DENIED"`)
   * em vez de retornar false. Útil nas capabilities, que podem
   * chamar `permissions.require("shell.execute")` no início da
   * execução para abortar cedo com um erro padronizado.
   */
  require(action: string) {
    if (!this.can(action)) {
      const error: Error & { code?: string } = new Error(
        `Permissão negada: ${action}`,
      );

      error.code = "PERMISSION_DENIED";

      throw error;
    }
  }

  /**
   * Concede uma permissão em tempo de execução (útil para fluxos
   * onde o usuário aprova uma ação sensível pontualmente).
   * Sem efeito prático se `mode === "full"` (já tudo permitido) —
   * e não altera `mode` em si, então não "promove" o agent, apenas
   * ativa uma entrada específica no mapa.
   */
  grant(action: string) {
    this.permissions[action] = true;
  }

  /**
   * Revoga uma permissão em tempo de execução.
   * ATENÇÃO: não tem efeito se `mode === "full"`, pois `can()`
   * ignora o mapa `permissions` nesse modo.
   */
  revoke(action: string) {
    this.permissions[action] = false;
  }

  /**
   * Retorna uma cópia (shallow) do estado atual de permissões,
   * incluindo o modo — útil para logging/auditoria/debug, sem
   * expor a referência ao objeto interno `this.permissions`.
   */
  snapshot(): PermissionsSnapshot {
    return {
      mode: this.mode,
      role: this.role,
      ...this.permissions,
    };
  }
}

