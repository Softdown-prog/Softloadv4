import type { PermissionGuard, WorkspaceRoot, CommandPolicyGuard } from "./capability-types.js";

export interface PackageTask {
  type: string;
  ecosystem?: string;
  package?: string;
  timeoutMs?: number;
}

import fs from "node:fs/promises";
import { parseCommand } from "../utils/parse-command.js";
import { runCommand } from "../utils/run-command.js";

const PACKAGE_TIMEOUT_MS_DEFAULT = 300000; // 5 min

// Nome de pacote tem que bater com isto: não pode começar com "-"
// (evita que vire uma flag do gerenciador de pacotes) e só aceita os
// caracteres normalmente válidos em nomes de pacote npm/pip/composer
// (incluindo escopo "@org/nome" do npm e "vendor/nome" do composer).
const SAFE_PACKAGE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._@/-]{0,213}$/;

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * PackageCapability: instala dependências (package.install, a partir
 * do manifest/lockfile já existente) ou adiciona um pacote específico
 * (package.add, com o nome validado por regex antes de qualquer
 * execução) — para npm, Composer ou pip.
 *
 * A validação do nome do pacote é a defesa PRIMÁRIA contra injeção
 * de flags via nome (ex: um "pacote" chamado "--registry=evil.com").
 * A CommandPolicy dedicada é uma segunda camada, não a única.
 */
export class PackageCapability {
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
        "PackageCapability exige commandPolicy (allowlist dedicada de comandos de pacote)",
      );
    }

    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
  }

  async execute(task: PackageTask) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "package.install":
        return this.install(task);
      case "package.add":
        return this.add(task);
      default:
        throw new Error(`Operação package desconhecida: ${task.type}`);
    }
  }

  async detectEcosystem(explicit: string | undefined) {
    if (explicit) return explicit;

    const root = this.workspace.root;
    if (await fileExists(`${root}/package.json`)) return "npm";
    if (await fileExists(`${root}/composer.json`)) return "composer";
    if (await fileExists(`${root}/requirements.txt`)) return "pip";

    throw new Error(
      "Não foi possível detectar o gerenciador de pacotes (esperado package.json, composer.json ou requirements.txt)",
    );
  }

  async install(task: PackageTask) {
    const ecosystem = await this.detectEcosystem(task.ecosystem);

    const commands: Record<string, string> = {
      npm: "npm ci",
      composer: "composer install",
      pip: "pip install -r requirements.txt",
    };

    const command = commands[ecosystem];
    if (!command) {
      throw new Error(`Ecossistema não suportado: ${ecosystem}`);
    }

    return this.runPackageCommand(command, task.timeoutMs);
  }

  async add(task: PackageTask) {
    if (!task.package || typeof task.package !== "string") {
      throw new Error("package.add exige 'package' (string)");
    }
    if (!SAFE_PACKAGE_NAME.test(task.package)) {
      throw new Error(
        `Nome de pacote inválido/não permitido: ${task.package}`,
      );
    }

    const ecosystem = await this.detectEcosystem(task.ecosystem);

    const commands: Record<string, string> = {
      npm: `npm install ${task.package} --save`,
      composer: `composer require ${task.package}`,
      pip: `pip install ${task.package}`,
    };

    const command = commands[ecosystem];
    if (!command) {
      throw new Error(`Ecossistema não suportado: ${ecosystem}`);
    }

    return this.runPackageCommand(command, task.timeoutMs);
  }

  async runPackageCommand(command: string, timeoutMs?: number) {
    this.commandPolicy.validate(command);

    const [executable, ...args] = parseCommand(command);

    const result = await runCommand(executable, args, {
      cwd: this.workspace.root,
      // `??`, não `||`: timeoutMs === 0 é "sem timeout" explícito
      // (execa trata 0 como tal), não "não informado" — ver shell.js.
      timeoutMs: timeoutMs ?? PACKAGE_TIMEOUT_MS_DEFAULT,
    });

    return { command, ...result };
  }
}
