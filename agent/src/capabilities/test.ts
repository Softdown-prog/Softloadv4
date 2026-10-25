import type { PermissionGuard, WorkspaceRoot, CommandPolicyGuard } from "./capability-types.js";

export interface TestTask {
  type: string;
  command?: string;
  timeoutMs?: number;
}

interface TestCandidate {
  ecosystem: "node" | "python" | "php";
  command: string;
}

import fs from "node:fs/promises";
import { parseCommand } from "../utils/parse-command.js";
import { runCommand } from "../utils/run-command.js";

const TEST_TIMEOUT_MS_DEFAULT = 300000; // 5 min

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<{ scripts?: { test?: string } } | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * TestCapability: detecta a suíte de testes existente do projeto
 * (test.detect) e a executa (test.run), sempre através de comandos
 * pré-aprovados — nunca executando texto livre sem validação.
 *
 * Mesmo um comando vindo de `test.detect` (que já é uma lista fixa
 * interna) passa de novo pela `commandPolicy` dedicada antes de
 * rodar, e um `task.command` explícito (se o chamador quiser
 * sobrescrever a detecção) passa pela MESMA validação — não há
 * caminho que pule a CommandPolicy.
 */
export class TestCapability {
  declare workspace: WorkspaceRoot;
  declare permissions: PermissionGuard;
  declare commandPolicy: CommandPolicyGuard;

  constructor({ workspace, permissions, commandPolicy }: {
    workspace: WorkspaceRoot;
    permissions: PermissionGuard;
    commandPolicy: CommandPolicyGuard;
  }) {
    if (!commandPolicy) {
      throw new Error(
        "TestCapability exige commandPolicy (allowlist dedicada de comandos de teste)",
      );
    }

    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
  }

  async execute(task: TestTask) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "test.detect":
        return this.detect();
      case "test.run":
        return this.run(task);
      default:
        throw new Error(`Operação test desconhecida: ${task.type}`);
    }
  }

  /**
   * Detecta candidatos de comando de teste a partir de arquivos de
   * configuração conhecidos do projeto. NUNCA deriva um comando a
   * partir de conteúdo arbitrário — só confirma a presença de
   * arquivos/chaves conhecidas e sugere um comando de uma lista fixa.
   */
  async detect() {
    const root = this.workspace.root;
    const candidates: TestCandidate[] = [];

    const pkg = await readJsonSafe(`${root}/package.json`);
    if (pkg?.scripts?.test) {
      candidates.push({ ecosystem: "node", command: "npm test" });
    }

    if (
      (await fileExists(`${root}/pytest.ini`)) ||
      (await fileExists(`${root}/pyproject.toml`)) ||
      (await fileExists(`${root}/setup.cfg`))
    ) {
      candidates.push({ ecosystem: "python", command: "pytest" });
    }

    if (
      (await fileExists(`${root}/phpunit.xml`)) ||
      (await fileExists(`${root}/phpunit.xml.dist`))
    ) {
      candidates.push({
        ecosystem: "php",
        command: (await fileExists(`${root}/vendor/bin/phpunit`))
          ? "./vendor/bin/phpunit"
          : "composer test",
      });
    }

    return { candidates, detected: candidates.length > 0 };
  }

  async run(task: TestTask) {
    let command = task.command;

    if (!command) {
      const detection = await this.detect();
      if (!detection.detected) {
        throw new Error(
          "Nenhum comando de teste detectado e nenhum 'command' foi informado",
        );
      }
      command = detection.candidates[0].command;
    }

    // Validação obrigatória — nunca contorna a CommandPolicy dedicada
    // desta capability, seja o comando detectado automaticamente ou
    // informado explicitamente pelo chamador.
    this.commandPolicy.validate(command);

    const [executable, ...args] = parseCommand(command);

    const result = await runCommand(executable, args, {
      cwd: this.workspace.root,
      // `??`, não `||`: timeoutMs === 0 é "sem timeout" explícito
      // (execa trata 0 como tal), não "não informado" — ver shell.js.
      timeoutMs: task.timeoutMs ?? TEST_TIMEOUT_MS_DEFAULT,
    });

    return { command, ...result };
  }
}
