import type { PermissionGuard, WorkspaceRoot, CommandPolicyGuard } from "./capability-types.js";

export interface ShellTask {
  type: string;
  command: string;
  timeoutMs?: number | null;
}

import { execa } from "execa";
import { parseCommand } from "../utils/parse-command.js";

/**
 * ShellCapability: executa comandos de shell autorizados, delegando
 * a validação de permissão para `Permissions` e a validação de
 * conteúdo/allowlist para `CommandPolicy`.
 *
 * Detalhe de segurança importante: `execa` é chamado SEM
 * `shell: true`, ou seja, executa o binário diretamente com um
 * array de argumentos (equivalente a `execFile`/`spawn` sem shell).
 * Isso significa que operadores de shell como `&&`, `;`, `|`,
 * `` ` `` (backticks) e `$()` NÃO são interpretados — viram
 * argumentos literais passados ao binário, e não conseguem
 * encadear/injetar um segundo comando. Essa é a peça que fecha a
 * lacuna de "encadeamento de comandos" mencionada na revisão do
 * CommandPolicy.
 */
export class ShellCapability {
  declare workspace: WorkspaceRoot;
  declare permissions: PermissionGuard;
  declare commandPolicy: CommandPolicyGuard;

  constructor({
    workspace,
    permissions,
    commandPolicy,
  }: { workspace: WorkspaceRoot; permissions: PermissionGuard; commandPolicy: CommandPolicyGuard }) {
    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
  }

  async execute(task: ShellTask) {
    // Verifica permissão genérica de execução de shell (por padrão
    // `false`, conforme visto em Permissions).
    this.permissions.require(
      "shell.execute",
    );

    // Valida o comando contra BLOCKED_PATTERNS e ALLOWED_COMMANDS,
    // retornando o nome do executável já extraído/normalizado.
    const policy =
      this.commandPolicy.validate(
        task.command,
      );

    // Divide o comando em tokens respeitando aspas (o mesmo parser
    // usado pelo CommandPolicy para extrair o executável), evitando
    // o bug anterior em que 'git commit -m "fix bug in login"'
    // virava os argumentos ['-m', '"fix', 'bug', 'in', 'login"']
    // em vez de ['-m', 'fix bug in login'].
    const args = parseCommand(task.command.trim()).slice(1);

    const result = await execa(
      policy.executable,
      args,
      {
        // Executa sempre dentro do workspace do agent.
        cwd: this.workspace.root,

        // `reject: false`: por padrão, execa rejeita (lança) a
        // Promise quando o processo termina com código != 0. Aqui
        // isso é desativado de propósito, para que exit code != 0
        // não seja tratado como "erro" — o chamador decide o que
        // fazer com `exitCode`/`failed`, em vez de cair no catch do
        // TaskRunner.
        reject: false,

        // Timeout configurável por task, com 120s como default. `??`
        // (não `||`): `task.timeoutMs === 0` é um pedido explícito de
        // "sem timeout" — o execa já trata `timeout: 0` exatamente
        // como "sem timeout" (mesmo caminho de `undefined`, ver
        // execa/lib/terminate/timeout.js) — só `undefined`/`null`
        // (timeout não informado) deve cair no default de 120s.
        timeout:
          task.timeoutMs ?? 120000,
      },
    );

    return {
      command: task.command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      // `failed` (do execa) é true se o processo saiu com erro OU
      // foi encerrado por timeout/sinal — útil como flag rápida sem
      // precisar checar exitCode manualmente.
      failed: result.failed,
    };
  }
}
