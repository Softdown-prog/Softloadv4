import { execa } from "execa";
import fs from "node:fs/promises";
import { runCommand } from "../utils/run-command.js";

const MAX_RESULTS_DEFAULT = 200;
const MAX_RESULTS_HARD_CAP = 1000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB, só no fallback JS
const SEARCH_TIMEOUT_MS = 30000;
const IGNORED_DIRS = new Set(["node_modules", ".git", "vendor", ".artifacts"]);

// Cache do resultado de "rg está disponível?" — checa uma vez por
// processo, não a cada chamada.
let ripgrepAvailable = null;

async function isRipgrepAvailable() {
  if (ripgrepAvailable !== null) {
    return ripgrepAvailable;
  }

  try {
    await execa("rg", ["--version"], { timeout: 5000, reject: false });
    ripgrepAvailable = true;
  } catch {
    ripgrepAvailable = false;
  }

  return ripgrepAvailable;
}

/**
 * CodeSearchCapability: busca por um padrão (regex) no código-fonte
 * do workspace. Usa `rg` (ripgrep) quando disponível no container
 * (muito mais rápido e já ignora .gitignore); se não estiver
 * instalado, cai num fallback em JS puro que faz a mesma busca de
 * forma mais lenta, mas segura e sem dependências externas.
 */
export class CodeSearchCapability {
  constructor({ workspace, permissions }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);

    if (task.type !== "code.search") {
      throw new Error(`Operação code-search desconhecida: ${task.type}`);
    }

    return this.search(task);
  }

  async search(task) {
    if (!task.pattern || typeof task.pattern !== "string") {
      throw new Error("code.search exige 'pattern' (string)");
    }

    // Contenção: qualquer path fora de /workspace lança erro aqui
    // (Workspace.resolve já faz essa validação).
    const searchRoot = await this.workspace.resolve(task.path || ".");
    const maxResults = Math.min(
      task.maxResults || MAX_RESULTS_DEFAULT,
      MAX_RESULTS_HARD_CAP,
    );

    const params = {
      pattern: task.pattern,
      searchRoot,
      maxResults,
      caseSensitive: Boolean(task.caseSensitive),
      glob: typeof task.glob === "string" ? task.glob : null,
    };

    if (await isRipgrepAvailable()) {
      return this.searchWithRipgrep(params);
    }

    return this.searchWithFallback(params);
  }

  async searchWithRipgrep({ pattern, searchRoot, maxResults, caseSensitive, glob }) {
    const args = [
      "--json",
      "--max-count",
      String(maxResults),
      "--max-filesize",
      "5M",
    ];

    if (!caseSensitive) args.push("--ignore-case");
    if (glob) args.push("--glob", glob);

    // "--" separa flags do pattern/path, evitando que um pattern
    // começando com "-" seja interpretado como flag do rg.
    args.push("--", pattern, searchRoot);

    const result = await runCommand("rg", args, {
      cwd: this.workspace.root,
      timeoutMs: SEARCH_TIMEOUT_MS,
    });

    // rg retorna exit code 1 quando simplesmente não encontra nada —
    // não é um erro de execução.
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(
        `rg falhou (exit ${result.exitCode}): ${result.stderr || "erro desconhecido"}`,
      );
    }

    const matches = [];

    for (const line of result.stdout.split("\n")) {
      if (!line.trim()) continue;

      let entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue;
      }

      if (entry.type !== "match") continue;

      matches.push({
        path: entry.data.path.text,
        line: entry.data.line_number,
        text: (entry.data.lines.text || "").slice(0, 500),
      });

      if (matches.length >= maxResults) break;
    }

    return {
      engine: "ripgrep",
      pattern,
      matches,
      truncated: matches.length >= maxResults,
    };
  }

  async searchWithFallback({ pattern, searchRoot, maxResults, caseSensitive }) {
    let regex;
    try {
      regex = new RegExp(pattern, caseSensitive ? "g" : "gi");
    } catch (error) {
      throw new Error(`Pattern de busca inválido: ${error.message}`);
    }

    const matches = [];
    let truncated = false;

    const walk = async (dir) => {
      if (truncated) return;

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (truncated) return;
        if (IGNORED_DIRS.has(entry.name)) continue;

        const fullPath = `${dir}/${entry.name}`;

        if (entry.isDirectory()) {
          await walk(fullPath);
          continue;
        }

        let stat;
        try {
          stat = await fs.stat(fullPath);
        } catch {
          continue;
        }
        if (stat.size > MAX_FILE_SIZE_BYTES) continue;

        let content;
        try {
          content = await fs.readFile(fullPath, "utf8");
        } catch {
          continue; // provavelmente binário — pula
        }

        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            matches.push({
              path: fullPath,
              line: i + 1,
              text: lines[i].slice(0, 500),
            });

            if (matches.length >= maxResults) {
              truncated = true;
              break;
            }
          }
        }
      }
    };

    await walk(searchRoot);

    return { engine: "fallback-js", pattern, matches, truncated };
  }
}
