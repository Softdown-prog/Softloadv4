import fs from "node:fs/promises";
import { parseCommand } from "../utils/parse-command.js";
import { runCommand } from "../utils/run-command.js";

const BUILD_TIMEOUT_MS_DEFAULT = 300000; // 5 min

async function fileExists(path) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * BuildCapability: detecta Node/npm, PHP/Composer, Laravel e Python,
 * e roda apenas comandos de build pré-aprovados (build.run) — nunca
 * um comando arbitrário vindo de fora sem passar pela CommandPolicy
 * dedicada.
 */
export class BuildCapability {
  constructor({ workspace, permissions, commandPolicy }) {
    if (!commandPolicy) {
      throw new Error(
        "BuildCapability exige commandPolicy (allowlist dedicada de comandos de build)",
      );
    }

    this.workspace = workspace;
    this.permissions = permissions;
    this.commandPolicy = commandPolicy;
  }

  async execute(task) {
    this.permissions.require(task.type);

    switch (task.type) {
      case "build.detect":
        return this.detect();
      case "build.run":
        return this.run(task);
      default:
        throw new Error(`Operação build desconhecida: ${task.type}`);
    }
  }

  async detect() {
    const root = this.workspace.root;
    const candidates = [];

    const pkg = await readJsonSafe(`${root}/package.json`);
    if (pkg?.scripts?.build) {
      candidates.push({ ecosystem: "node", command: "npm run build" });
    }

    const composer = await readJsonSafe(`${root}/composer.json`);
    const isLaravel =
      (await fileExists(`${root}/artisan`)) &&
      Boolean(composer?.require?.["laravel/framework"]);

    if (isLaravel) {
      candidates.push({
        ecosystem: "laravel",
        command: "composer install --no-dev --optimize-autoloader",
      });
    } else if (composer) {
      candidates.push({ ecosystem: "php", command: "composer install" });
    }

    if (
      (await fileExists(`${root}/requirements.txt`)) ||
      (await fileExists(`${root}/pyproject.toml`))
    ) {
      candidates.push({
        ecosystem: "python",
        command: "pip install -r requirements.txt",
      });
    }

    return {
      candidates,
      detected: candidates.length > 0,
      isLaravel,
    };
  }

  async run(task) {
    let command = task.command;

    if (!command) {
      const detection = await this.detect();
      if (!detection.detected) {
        throw new Error(
          "Nenhum comando de build detectado e nenhum 'command' foi informado",
        );
      }
      command = detection.candidates[0].command;
    }

    this.commandPolicy.validate(command);

    const [executable, ...args] = parseCommand(command);

    const result = await runCommand(executable, args, {
      cwd: this.workspace.root,
      // `??`, não `||`: timeoutMs === 0 é "sem timeout" explícito
      // (execa trata 0 como tal), não "não informado" — ver shell.js.
      timeoutMs: task.timeoutMs ?? BUILD_TIMEOUT_MS_DEFAULT,
    });

    return { command, ...result };
  }
}
