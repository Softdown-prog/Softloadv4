import { test } from "node:test";
import assert from "node:assert/strict";
import { validateOptions, hasDangerousExtension } from "./security.js";

test("validateOptions: rejeita entrada que não é objeto", () => {
  assert.throws(() => validateOptions(null), /Options object is required/);
  assert.throws(() => validateOptions([]), /Options object is required/);
});

test("validateOptions: clampa valores fora da faixa pro default", () => {
  const opts = validateOptions({ maxFiles: -1, maxDepth: 9999 });
  assert.equal(opts.maxFiles, 300);
  assert.equal(opts.maxDepth, 12);
});

// ── hasDangerousExtension ────────────────────────────────────────

test("hasDangerousExtension: reconhece todas as extensões da denylist, case-insensitive", () => {
  const extensoes = [
    ".bat",
    ".cmd",
    ".exe",
    ".pif",
    ".scr",
    ".lnk",
    ".vbs",
    ".wsf",
    ".hta",
    ".docm",
    ".xlsm",
  ];

  for (const ext of extensoes) {
    assert.equal(hasDangerousExtension(`arquivo${ext}`), true, `${ext} deveria ser perigoso`);
    assert.equal(
      hasDangerousExtension(`arquivo${ext.toUpperCase()}`),
      true,
      `${ext.toUpperCase()} (maiúsculo) deveria ser perigoso`,
    );
    assert.equal(
      hasDangerousExtension(`sub/dir/arquivo${ext}`),
      true,
      `${ext} dentro de subdiretório deveria ser perigoso`,
    );
  }
});

test("hasDangerousExtension: .env exato é perigoso", () => {
  assert.equal(hasDangerousExtension(".env"), true);
  assert.equal(hasDangerousExtension("sub/.env"), true);
  assert.equal(hasDangerousExtension(".ENV"), true);
});

test("hasDangerousExtension: variantes de .env com sufixo (.env.example, .env.local) NÃO são bloqueadas -- de propósito", () => {
  // .env.example/.env.sample são convenção comum de template sem
  // segredo real, frequentemente versionadas no próprio repositório --
  // ver comentário em security.js. Só o nome exato ".env" é recusado.
  assert.equal(hasDangerousExtension(".env.example"), false);
  assert.equal(hasDangerousExtension(".env.local"), false);
  assert.equal(hasDangerousExtension(".env.production"), false);
});

test("hasDangerousExtension: arquivos e dotfiles comuns não são afetados", () => {
  for (const nome of [
    "app.js",
    "index.html",
    "style.css",
    "package.json",
    "README.md",
    ".gitignore",
    ".editorconfig",
    "sem-extensao",
    "planilha.xlsx", // Excel SEM macro -- diferente de .xlsm
    "documento.docx", // Word SEM macro -- diferente de .docm
  ]) {
    assert.equal(hasDangerousExtension(nome), false, `"${nome}" não deveria ser perigoso`);
  }
});

test("hasDangerousExtension: só olha pro nome do ARQUIVO, não pro caminho -- um diretório chamado 'malware.exe' não conta", () => {
  assert.equal(hasDangerousExtension("malware.exe/app.js"), false);
});
