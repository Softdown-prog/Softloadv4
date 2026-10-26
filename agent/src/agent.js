import { TaskRouter } from "./core/task-router.js";
import { TaskRunner } from "./core/task-runner.js";
import { Workspace } from "./core/workspace.js";

import { FileSystemCapability } from "./capabilities/filesystem.js";
import { ShellCapability } from "./capabilities/shell.js";
import { GitCapability } from "./capabilities/git.js";
import { GithubCapability } from "./capabilities/github.js";
import { StorageCapability } from "./capabilities/storage.js";
import { ArtifactsCapability } from "./capabilities/artifacts.js";
import { BuildCapability } from "./capabilities/build.js";
import { TestCapability } from "./capabilities/test.js";
import { PackageCapability } from "./capabilities/package.js";
import { ProcessCapability } from "./capabilities/process.js";
import { CodeAnalysisCapability } from "./capabilities/code-analysis.js";
import { CodeSearchCapability } from "./capabilities/code-search.js";
import { ProjectInspectorCapability } from "./capabilities/project-inspector.js";
import { WebSearchCapability } from "./capabilities/web-search.js";
import { WebFetchCapability } from "./capabilities/web-fetch.js";
import { EscalationCapability } from "./capabilities/escalation.js";
import { KnowledgeSearchCapability } from "./capabilities/knowledge-search.js";
import { McpClientCapability } from "./capabilities/mcp-client.js";
import { AssetForgeCapability } from "./capabilities/asset-forge.js";

import { CommandPolicy } from "./security/command-policy.js";
import { Permissions } from "./security/permissions.js";

import { createLogger } from "./utils/logger.js";

/**
 * Agent: orquestra o worker do Solaris.
 *
 * Responsável por montar o workspace, aplicar as políticas de
 * permissão/segurança, instanciar as capabilities (as "ferramentas"
 * que o agent pode usar) e conectar tudo isso ao TaskRouter/TaskRunner,
 * que decidem e executam as tarefas recebidas.
 */
export class Agent {
  constructor(options = {}) {
    // Rótulo opcional do papel deste agent (ex: "explorer", "coder",
    // "validator", "packager") — usado só para nomear o logger e
    // facilitar rastrear de qual sub-agente cada log/erro veio.
    this.role = options.role || "default";

    this.logger = createLogger(`agent:${this.role}`);

    // Workspace: diretório de trabalho isolado do agent. Aceita uma
    // instância já pronta via `options.workspace` (útil quando
    // vários sub-agentes precisam compartilhar exatamente o mesmo
    // diretório/estado, ex: Programador e Validador atuando no
    // mesmo checkout de código); caso contrário, cria uma nova a
    // partir de `options.workspaceRoot`, de uma env var, ou de um
    // default fixo.
    this.workspace =
      options.workspace ||
      new Workspace({
        root:
          options.workspaceRoot ||
          process.env.WORKSPACE_ROOT ||
          "/workspace",
      });

    // Permissions: controla o que o agent tem autorização para
    // fazer. Aceita uma instância customizada via `options.permissions`
    // (ex: um preset de role-permissions.js, com um mapa granular
    // por papel) — se não vier, cria a padrão (modo "restricted" por
    // padrão, ou o valor de AGENT_PERMISSION_MODE).
    this.permissions =
      options.permissions ||
      new Permissions({
        mode: process.env.AGENT_PERMISSION_MODE || "restricted",
        role: this.role,
      });

    // CommandPolicy: regras específicas de validação/bloqueio de
    // comandos de shell. Aceita uma instância customizada via
    // `options.commandPolicy` (ex: allowlist restrita a comandos de
    // teste para o papel Validador) — se não vier, usa a política
    // padrão (allowlist genérica de desenvolvimento).
    this.commandPolicy =
      options.commandPolicy || new CommandPolicy();

    // Capabilities: cada uma encapsula uma área de atuação do agent
    // (arquivos, shell, git, github, storage, artifacts, build,
    // test, package, process, análise/busca de código, inspeção de
    // projeto, busca na web, busca de URL específica, sandbox de
    // navegador, busca semântica no RAG, servidores MCP externos,
    // escalonamento humano). Todas recebem `permissions` para poder
    // checar autorização antes de agir; algumas também recebem
    // `workspace` (por operarem sobre arquivos locais) e a shell
    // recebe também `commandPolicy`.
    this.capabilities = {
      forge: new AssetForgeCapability({ workspace: this.workspace, permissions: this.permissions }),
      filesystem: new FileSystemCapability({
        workspace: this.workspace,
        permissions: this.permissions,
      }),

      shell: new ShellCapability({
        workspace: this.workspace,
        permissions: this.permissions,
        commandPolicy: this.commandPolicy,
      }),

      git: new GitCapability({
        workspace: this.workspace,
        permissions: this.permissions,
      }),

      // Github e Storage não recebem `workspace`: presumivelmente
      // operam via API remota, sem depender de arquivos locais.
      github: new GithubCapability({
        permissions: this.permissions,
      }),

      storage: new StorageCapability({
        permissions: this.permissions,
      }),

      artifacts: new ArtifactsCapability({
        permissions: this.permissions,
      }),

      // Build/Test/Package/Process rodam comandos reais (via
      // runCommand/execa, mesmo padrão de segurança do shell.js —
      // sem shell:true) e por isso exigem `commandPolicy`, igual à
      // ShellCapability — cada uma valida o comando contra a MESMA
      // allowlist/prefixos antes de rodar (BuildCapability/
      // TestCapability/PackageCapability/ProcessCapability lançam na
      // hora se não receberem commandPolicy).
      build: new BuildCapability({
        workspace: this.workspace,
        permissions: this.permissions,
        commandPolicy: this.commandPolicy,
      }),

      test: new TestCapability({
        workspace: this.workspace,
        permissions: this.permissions,
        commandPolicy: this.commandPolicy,
      }),

      package: new PackageCapability({
        workspace: this.workspace,
        permissions: this.permissions,
        commandPolicy: this.commandPolicy,
      }),

      process: new ProcessCapability({
        workspace: this.workspace,
        permissions: this.permissions,
        commandPolicy: this.commandPolicy,
      }),

      // CodeAnalysis/CodeSearch/ProjectInspector são só leitura (não
      // rodam nenhum processo além do fallback opcional em `rg` por
      // baixo de code-search.js, que já usa runCommand com a mesma
      // política de segurança) — não precisam de commandPolicy.
      codeAnalysis: new CodeAnalysisCapability({
        workspace: this.workspace,
        permissions: this.permissions,
      }),

      codeSearch: new CodeSearchCapability({
        workspace: this.workspace,
        permissions: this.permissions,
      }),

      projectInspector: new ProjectInspectorCapability({
        workspace: this.workspace,
        permissions: this.permissions,
      }),

      // WebSearch não opera sobre o workspace local — só chama a API
      // Gemini (GEMINI_API_KEY via env, ver web-search.js).
      webSearch: new WebSearchCapability({
        permissions: this.permissions,
      }),

      // WebFetch busca uma URL específica diretamente (GET), diferente
      // de webSearch (que nunca acessa uma URL arbitrária). Proteção
      // contra SSRF embutida na própria capability, ver web-fetch.js.
      webFetch: new WebFetchCapability({
        permissions: this.permissions,
      }),

      // WebSandbox e Archive foram retirados junto do serviço isolado.
      // NUNCA executar conteúdos web/ZIP não confiáveis no Agent.

      // KnowledgeSearch fala via HTTP com o app principal (que já tem
      // credencial de Firestore) — o agent/ continua sem nenhuma
      // credencial de Firestore/Gemini pra isso, ver knowledge-search.js.
      knowledgeSearch: new KnowledgeSearchCapability({
        permissions: this.permissions,
      }),

      // Mcp fala com servidores MCP (Model Context Protocol) externos
      // via Streamable HTTP, configurados em MCP_SERVERS_JSON (ver
      // config/mcpServers.js) — não com um serviço isolado próprio da
      // Softload, e sim com QUALQUER servidor MCP de terceiros
      // configurado ali. É o adaptador genérico que evita precisar
      // escrever uma capability nova (como github.js/storage.js) para
      // cada integração externa futura.
      mcp: new McpClientCapability({
        permissions: this.permissions,
      }),

      // Escalation: canal de escalonamento pra humano (pergunta ->
      // webhook opcional -> resposta assíncrona via POST
      // /escalations/:id/respond, ver server.js). Diferente de
      // mcp/dispatch/plan, é uma capability PADRÃO (não só via
      // extraCapabilities do Orquestrador) porque a rota HTTP nova
      // precisa dela disponível no Agent de produção mesmo sem
      // nenhum preset de role aplicado — ver escalation.js.
      escalation: new EscalationCapability({
        permissions: this.permissions,
      }),

      // Capabilities adicionais, além das 17 padrão — usado pelo
      // Orquestrador para incluir a AgentDispatchCapability (chave
      // "dispatch", batendo com o TASK_MAP em task-router.js). Um
      // spread vazio (`{}`) se `options.extraCapabilities` não for
      // passado, então isso não afeta agents que não usam esse
      // recurso.
      ...(options.extraCapabilities || {}),
    };

    // TaskRouter: decide qual capability (ou fluxo) deve tratar uma
    // task recebida, com base no conteúdo/tipo da task.
    this.taskRouter = new TaskRouter({
      capabilities: this.capabilities,
    });

    // TaskRunner: executa a task já roteada, coordenando o uso das
    // capabilities necessárias.
    this.taskRunner = new TaskRunner({
      router: this.taskRouter,
      capabilities: this.capabilities,
    });

    // Flag de estado: indica se o agent está ativo. Usada por
    // `execute()` (para bloquear uso antes do start) e por `wait()`
    // (para saber quando parar de aguardar).
    this.running = false;
  }

  /**
   * Inicializa o agent: prepara o workspace em disco e marca o agent
   * como "rodando". Deve ser chamado antes de `execute()`.
   */
  async start() {
    await this.workspace.initialize();

    this.running = true;

    this.logger.info("Workspace inicializado", {
      root: this.workspace.root,
    });

    this.logger.info("Capabilities carregadas", {
      capabilities: Object.keys(this.capabilities),
    });
  }

  /**
   * Executa uma task através do TaskRunner.
   * Lança erro se o agent ainda não tiver sido iniciado com start().
   */
  async execute(task) {
    if (!this.running) {
      throw new Error("Agent ainda não foi iniciado");
    }

    return this.taskRunner.execute(task);
  }

  /**
   * Mantém o processo "vivo" enquanto o agent estiver rodando.
   * Implementado com polling simples (checa `this.running` a cada
   * 1 segundo). Isso significa que, após stop() ser chamado, pode
   * levar até ~1s para wait() de fato resolver.
   */
  async wait() {
    while (this.running) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  /**
   * Para o agent, fazendo com que o loop de `wait()` termine na
   * próxima verificação (até 1s de atraso, ver observação acima).
   */
  async stop() {
    this.running = false;

    this.logger.info("Worker Agent encerrado");
  }
}

