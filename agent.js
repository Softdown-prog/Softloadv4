import { TaskRouter } from "./core/task-router.js";
import { TaskRunner } from "./core/task-runner.js";
import { Workspace } from "./core/workspace.js";

import { FileSystemCapability } from "./capabilities/filesystem.js";
import { ShellCapability } from "./capabilities/shell.js";
import { GitCapability } from "./capabilities/git.js";
import { GithubCapability } from "./capabilities/github.js";
import { StorageCapability } from "./capabilities/storage.js";
import { ArtifactsCapability } from "./capabilities/artifacts.js";

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
    this.logger = createLogger("agent");

    // Workspace: diretório de trabalho isolado do agent. Pode vir de
    // `options`, de uma env var, ou usar um default fixo.
    this.workspace = new Workspace({
      root: options.workspaceRoot || process.env.WORKSPACE_ROOT || "/workspace",
    });

    // Permissions: controla o que o agent tem autorização para fazer.
    // O modo "restricted" é o default mais seguro caso nenhuma env
    // var seja definida.
    this.permissions = new Permissions({
      mode: process.env.AGENT_PERMISSION_MODE || "restricted",
    });

    // CommandPolicy: regras específicas de validação/bloqueio de
    // comandos de shell (ex: allowlist/denylist de binários,
    // sanitização de argumentos etc.), usado pela ShellCapability.
    this.commandPolicy = new CommandPolicy();

    // Capabilities: cada uma encapsula uma área de atuação do agent
    // (arquivos, shell, git, github, storage, artifacts). Todas
    // recebem `permissions` para poder checar autorização antes de
    // agir; algumas também recebem `workspace` (por operarem sobre
    // arquivos locais) e a shell recebe também `commandPolicy`.
    this.capabilities = {
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
