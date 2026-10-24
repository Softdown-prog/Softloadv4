import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "./run-command.js";

const DEFAULT_TIMEOUT_MS = 30000;

// Códigos de saída documentados em Power-up/Observações.md (item 16) e
// no cabeçalho de Power-up/diff_patch_engine.cpp -- mapeados aqui pra
// mensagem clara, uma única vez, em vez de espalhar `if (exitCode === X)`
// pelas capabilities que chamam este módulo.
const EXIT_CODE_MESSAGES = {
  10: "arquivo não encontrado",
  20: "patch inválido ou malformado",
  30: "o arquivo mudou desde que o patch foi gerado (hash de origem não confere)",
  40: "o patch não corresponde ao conteúdo atual do arquivo",
};

/**
 * DiffPatchEngineError: erro de uma chamada ao binário
 * `diff_patch_engine` (ver Power-up/diff_patch_engine.cpp). Carrega
 * `exitCode` pra quem chamou decidir o que fazer sem precisar
 * reinterpretar a mensagem de stderr (ex: `exitCode === 30` -> "o
 * arquivo mudou, recalcule o diff e tente de novo").
 */
export class DiffPatchEngineError extends Error {
  constructor(message, exitCode, stderr) {
    super(message);
    this.name = "DiffPatchEngineError";
    this.exitCode = exitCode;
    this.stderr = stderr;
  }
}

/**
 * Caminho do binário compilado (ver agent/Dockerfile, estágio
 * cpp-builder -- fica em /app/bin/diff_patch_engine, já no PATH da
 * imagem final). Lido a cada chamada (não uma vez no import) pra
 * permitir override em teste via `DIFF_PATCH_ENGINE_BIN` apontando
 * pra um binário compilado localmente, sem precisar dele no PATH do
 * sistema (mesmo padrão de outras capabilities que leem
 * `process.env.*` dentro do método, não no topo do módulo -- ver
 * capabilities/archive.js).
 */
function binaryPath() {
  return process.env.DIFF_PATCH_ENGINE_BIN || "diff_patch_engine";
}

async function withTempDir(fn) {
  const dir = await fs.mkdtemp(
    path.join(os.tmpdir(), "diff-patch-engine-"),
  );

  try {
    return await fn(dir);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
}

function throwIfFailed(result, action) {
  if (result.exitCode === 0) {
    return;
  }

  const reason =
    EXIT_CODE_MESSAGES[result.exitCode] ||
    `falha inesperada (exit code ${String(result.exitCode)})`;

  throw new DiffPatchEngineError(
    `diff_patch_engine ${action}: ${reason} -- ${(result.stderr || result.stdout || "").trim()}`,
    result.exitCode,
    result.stderr,
  );
}

/**
 * Calcula o patch estrutural (token a token, algoritmo de Myers) que
 * transforma `sourceContent` em `targetContent`, delegando pro
 * binário `diff_patch_engine diff` via subprocesso -- nunca faz o
 * cálculo em JS. O patch devolvido já embute `sourceHash` (SHA-256 de
 * `sourceContent`, calculado pelo próprio binário) -- ver
 * FileSystemCapability.patch() pra como isso é usado pra confirmar
 * que o arquivo não mudou entre o `diff` e o `apply`.
 *
 * Puramente computacional -- não lê nem escreve nenhum arquivo real
 * do workspace, só os temporários usados pra alimentar o binário
 * (sempre limpos no fim, sucesso ou falha).
 *
 * @returns {Promise<{format: string, sourceHash: string, ops: Array<{op: string, text: string}>}>}
 */
export async function computeDiff(
  sourceContent,
  targetContent,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  return withTempDir(async (dir) => {
    const sourcePath = path.join(dir, "source");
    const targetPath = path.join(dir, "target");

    await fs.writeFile(sourcePath, sourceContent, "utf8");
    await fs.writeFile(targetPath, targetContent, "utf8");

    // `stripFinalNewline: false` nas duas chamadas deste módulo (aqui
    // e em applyPatch, abaixo): o default do execa remove um "\n"
    // final do stdout capturado -- correto pra LOG de comando (uso
    // mais comum de runCommand), mas errado aqui, onde o stdout É o
    // conteúdo de um arquivo (achado real, pego pelo teste de
    // round-trip com arquivo terminando em quebra de linha, o caso
    // comum -- sem isso, `apply` corrompia silenciosamente todo
    // arquivo que termina com "\n").
    const result = await runCommand(
      binaryPath(),
      ["diff", sourcePath, targetPath],
      { timeoutMs, stripFinalNewline: false },
    );

    throwIfFailed(result, "diff");

    try {
      return JSON.parse(result.stdout);
    } catch (err) {
      throw new DiffPatchEngineError(
        `diff_patch_engine diff: saída não é JSON válido -- ${err.message}`,
        result.exitCode,
        result.stderr,
      );
    }
  });
}

/**
 * Aplica `patch` (objeto já parseado, no formato devolvido por
 * `computeDiff`) contra `originalContent`, delegando pro binário
 * `diff_patch_engine apply` via subprocesso. Rejeita (erro
 * `DiffPatchEngineError`, `exitCode` preenchido) em qualquer
 * divergência -- nunca tenta adivinhar (regra de ouro do projeto, ver
 * Power-up/Observações.md seção 21): `exitCode === 30` significa que
 * `originalContent` já não é mais o mesmo que gerou o patch (hash
 * diferente); `exitCode === 40` significa que uma operação específica
 * não bateu com o conteúdo esperado na posição certa.
 *
 * Só devolve a string resultante -- não escreve em lugar nenhum;
 * quem chama decide como/onde persistir (ver
 * Workspace.writeAtomic()).
 *
 * @returns {Promise<string>}
 */
export async function applyPatch(
  originalContent,
  patch,
  { timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  return withTempDir(async (dir) => {
    const originalPath = path.join(dir, "original");
    const patchPath = path.join(dir, "patch.json");

    await fs.writeFile(originalPath, originalContent, "utf8");
    await fs.writeFile(patchPath, JSON.stringify(patch), "utf8");

    const result = await runCommand(
      binaryPath(),
      ["apply", originalPath, patchPath],
      { timeoutMs, stripFinalNewline: false },
    );

    throwIfFailed(result, "apply");

    return result.stdout;
  });
}
