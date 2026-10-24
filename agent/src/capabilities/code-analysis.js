import fs from "node:fs/promises";

const MAX_FILES_DEFAULT = 2000;
const MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024; // 2MB por arquivo
const ANALYSIS_TIMEOUT_MS = 30000; // limite de tempo de parede (wall clock)
const MAX_TODOS = 200;
const MAX_LARGEST_FILES = 20;
const IGNORED_DIRS = new Set([
  "node_modules",
  ".git",
  "vendor",
  ".artifacts",
  "dist",
  "build",
]);
const TODO_PATTERN = /\b(TODO|FIXME|XXX)\b[:\s]?(.*)/;

/**
 * CodeAnalysisCapability: estatísticas estáticas do código-fonte
 * (contagem de linhas por extensão, TODOs/FIXMEs, maiores arquivos).
 * Puramente read-only, não executa nenhum processo — por isso não
 * precisa de CommandPolicy nem de timeout de subprocesso; em vez
 * disso, respeita um prazo de parede (ANALYSIS_TIMEOUT_MS) e um teto
 * de arquivos (maxFiles) para não travar em repositórios enormes.
 */
export class CodeAnalysisCapability {
  constructor({ workspace, permissions }) {
    this.workspace = workspace;
    this.permissions = permissions;
  }

  async execute(task) {
    this.permissions.require(task.type);

    if (task.type !== "code.analyze") {
      throw new Error(`Operação code-analysis desconhecida: ${task.type}`);
    }

    return this.analyze(task);
  }

  async analyze(task) {
    const root = await this.workspace.resolve(task.path || ".");
    const maxFiles = Math.min(
      task.maxFiles || MAX_FILES_DEFAULT,
      MAX_FILES_DEFAULT,
    );
    const deadline = Date.now() + ANALYSIS_TIMEOUT_MS;

    const stats = {
      filesScanned: 0,
      totalLines: 0,
      byExtension: {},
      todos: [],
      largestFiles: [],
    };

    let truncated = false;

    const shouldStop = () =>
      truncated || stats.filesScanned >= maxFiles || Date.now() > deadline;

    const walk = async (dir) => {
      if (shouldStop()) {
        truncated = true;
        return;
      }

      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (shouldStop()) {
          truncated = true;
          return;
        }
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

        stats.filesScanned++;

        const ext = fullPath.includes(".")
          ? fullPath.split(".").pop()
          : "sem-extensao";
        stats.byExtension[ext] = (stats.byExtension[ext] || 0) + 1;

        stats.largestFiles.push({ path: fullPath, bytes: stat.size });

        let content;
        try {
          content = await fs.readFile(fullPath, "utf8");
        } catch {
          continue; // provavelmente binário
        }

        const lines = content.split("\n");
        stats.totalLines += lines.length;

        for (let i = 0; i < lines.length; i++) {
          const match = TODO_PATTERN.exec(lines[i]);
          if (match && stats.todos.length < MAX_TODOS) {
            stats.todos.push({
              path: fullPath,
              line: i + 1,
              tag: match[1],
              text: match[2].trim().slice(0, 300),
            });
          }
        }
      }
    };

    await walk(root);

    stats.largestFiles.sort((a, b) => b.bytes - a.bytes);
    stats.largestFiles = stats.largestFiles.slice(0, MAX_LARGEST_FILES);

    return { ...stats, truncated };
  }
}
