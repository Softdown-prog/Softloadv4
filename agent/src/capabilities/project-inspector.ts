import type { PermissionGuard, WorkspaceRoot } from "./capability-types.js";

export interface ProjectInspectTask {
  type: string;
}

export interface ProjectReport {
  languages: string[];
  packageManager: string | null;
  framework: string | null;
  scripts: Record<string, string>;
  tests: { detected: boolean; framework: string | null };
  build: { detected: boolean; command: string | null };
  structure: Array<{ name: string; type: string }>;
}

interface Manifest {
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  require?: Record<string, string>;
}

import fs from "node:fs/promises";

async function fileExists(path: string) {
  try {
    await fs.access(path);
    return true;
  } catch {
    return false;
  }
}

async function readJsonSafe(path: string): Promise<Manifest | null> {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * ProjectInspectorCapability: detecta linguagem(ns), framework,
 * package manager, scripts, testes, build e estrutura de topo do
 * projeto — puramente por leitura de arquivos de configuração
 * conhecidos (package.json, composer.json, requirements.txt/
 * pyproject.toml, artisan). Não executa nada, não modifica nada.
 */
export class ProjectInspectorCapability {
  declare workspace: WorkspaceRoot;
  declare permissions: PermissionGuard;

  constructor({ workspace, permissions }: {
    workspace: WorkspaceRoot;
    permissions: PermissionGuard;
  }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  async execute(task: ProjectInspectTask) {
    this.permissions.require(task.type);

    if (task.type !== "project.inspect") {
      throw new Error(
        `Operação project-inspector desconhecida: ${task.type}`,
      );
    }

    return this.inspect();
  }

  async inspect() {
    const root = this.workspace.root;

    const result: ProjectReport = {
      languages: [],
      packageManager: null,
      framework: null,
      scripts: {},
      tests: { detected: false, framework: null },
      build: { detected: false, command: null },
      structure: [],
    };

    const pkg = await readJsonSafe(`${root}/package.json`);
    if (pkg) {
      result.languages.push("javascript");
      result.packageManager = "npm";
      result.scripts = pkg.scripts || {};

      if (pkg.scripts?.test) {
        result.tests.detected = true;
        result.tests.framework = "npm-script";
      }
      if (pkg.scripts?.build) {
        result.build.detected = true;
        result.build.command = "npm run build";
      }

      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps?.next) result.framework = "next.js";
      else if (deps?.react) result.framework = "react";
      else if (deps?.express) result.framework = "express";
      else if (deps?.vue) result.framework = "vue";
    }

    const composer = await readJsonSafe(`${root}/composer.json`);
    if (composer) {
      result.languages.push("php");
      result.packageManager = result.packageManager
        ? `${result.packageManager}+composer`
        : "composer";

      if (composer.require?.["laravel/framework"]) {
        result.framework = "laravel";
      }
      if (composer.scripts?.test) {
        result.tests.detected = true;
        result.tests.framework = "composer-script";
      }
    }

    if (
      (await fileExists(`${root}/phpunit.xml`)) ||
      (await fileExists(`${root}/phpunit.xml.dist`))
    ) {
      result.tests.detected = true;
      result.tests.framework = result.tests.framework || "phpunit";
    }

    const hasPython =
      (await fileExists(`${root}/requirements.txt`)) ||
      (await fileExists(`${root}/pyproject.toml`));

    if (hasPython) {
      result.languages.push("python");
      result.packageManager = result.packageManager
        ? `${result.packageManager}+pip`
        : "pip";
    }

    if (
      (await fileExists(`${root}/pytest.ini`)) ||
      (await fileExists(`${root}/pyproject.toml`))
    ) {
      result.tests.detected = true;
      result.tests.framework = result.tests.framework || "pytest";
    }

    let topLevel: ProjectReport["structure"] = [];
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      topLevel = entries
        .filter((entry) => !entry.name.startsWith("."))
        .map((entry) => ({
          name: entry.name,
          type: entry.isDirectory() ? "directory" : "file",
        }));
    } catch {
      // workspace vazio/inacessível — não é fatal para a inspeção
    }
    result.structure = topLevel;

    return result;
  }
}
