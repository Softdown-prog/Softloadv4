import type { PermissionGuard, WorkspaceRoot } from "./capability-types.js";

export interface GitTask {
  type: string;
  message?: string;
  files?: string[];
  addAll?: boolean;
}

import { execa } from "execa";

/**
 * GitCapability: expõe operações Git ao agent, todas rodando dentro
 * do workspace (`cwd: this.workspace.root`).
 *
 * Assim como o ShellCapability, usa `execa` com um array de
 * argumentos (sem `shell: true`), então valores como `task.message`
 * são passados como argumentos literais ao processo `git` — sem
 * risco de injeção de comando, mesmo que contenham espaços, aspas
 * ou caracteres especiais de shell.
 */
export class GitCapability {
  declare workspace: WorkspaceRoot;
  declare permissions: PermissionGuard;

  constructor({
    workspace,
    permissions,
  }: { workspace: WorkspaceRoot; permissions: PermissionGuard }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  /**
   * Ponto de entrada, chamado pelo TaskRunner. Verifica permissão
   * (por tipo de operação) antes de despachar para o comando git
   * correspondente.
   */
  async execute(task: GitTask) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "git.status":
        // --short: saída compacta (uma linha por arquivo), mais
        // fácil de parsear/exibir do que o formato verboso padrão.
        return this.run(["status", "--short"]);

      case "git.diff":
        return this.run(["diff"]);

      case "git.log":
        // --oneline: um commit por linha; -20: limita aos 20 mais
        // recentes, evitando histórico gigante em repositórios
        // grandes.
        return this.run([
          "log",
          "--oneline",
          "-20",
        ]);

      case "git.branch":
        // -a: lista branches locais E remotas.
        return this.run([
          "branch",
          "-a",
        ]);

      case "git.commit":
        return this.commit(task);

      default:
        throw new Error(
          `Operação Git desconhecida: ${task.type}`,
        );
    }
  }

  /**
   * Executa `git <args>` dentro do workspace e retorna um resultado
   * padronizado. `reject: false` evita que exit code != 0 (ex: "git
   * diff" sem mudanças, ou algum erro de git) vire uma exceção —
   * quem chama decide o que fazer com base em `exitCode`/`stderr`.
   */
  async run(args: string[]) {
    const result = await execa(
      "git",
      args,
      {
        cwd: this.workspace.root,
        reject: false,
      },
    );

    return {
      command: `git ${args.join(" ")}`,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  /**
   * Cria um commit com a mensagem fornecida.
   *
   * Suporta duas formas opcionais de fazer `git add` antes do
   * commit:
   *   - `task.files`: array de paths específicos a adicionar
   *     (ex: ["src/index.js", "README.md"])
   *   - `task.addAll: true`: adiciona todas as mudanças (`git add -A`)
   *
   * Se nenhum dos dois for informado, o comportamento é o original:
   * commita apenas o que já estiver staged (sem rodar `add`).
   *
   * `task.files` tem prioridade sobre `task.addAll` se ambos vierem
   * preenchidos, por ser a opção mais específica/segura.
   */
  async commit(task: GitTask) {
    if (!task.message) {
      throw new Error(
        "git.commit exige message",
      );
    }

    if (Array.isArray(task.files) && task.files.length > 0) {
      if (!task.files.every((file) => typeof file === "string")) {
        throw new Error(
          "git.commit: files deve ser um array de strings (paths)",
        );
      }

      // "--" separa as flags dos paths, evitando que um nome de
      // arquivo começando com "-" seja interpretado como opção do
      // git (ex: um arquivo literalmente chamado "-rf").
      const addResult = await this.run([
        "add",
        "--",
        ...task.files,
      ]);

      if (addResult.exitCode !== 0) {
        throw new Error(
          `git add falhou: ${addResult.stderr || "erro desconhecido"}`,
        );
      }
    } else if (task.addAll) {
      const addResult = await this.run(["add", "-A"]);

      if (addResult.exitCode !== 0) {
        throw new Error(
          `git add -A falhou: ${addResult.stderr || "erro desconhecido"}`,
        );
      }
    }

    return this.run([
      "commit",
      "-m",
      task.message,
    ]);
  }
}
