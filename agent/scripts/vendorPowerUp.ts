#!/usr/bin/env node
// Copia o código-fonte do diff_patch_engine (pasta Power-up/, na raiz do
// monorepo) para dentro de agent/native/, onde o Dockerfile do agent
// consegue enxergá-lo.
//
// Por quê: a imagem do agent é buildada com contexto = pasta agent/ (ex:
// `cd agent && docker build .`), não a raiz do repo. O Docker nunca
// consegue copiar arquivos de fora do seu contexto de build -- então
// Power-up/diff_patch_engine.cpp, que é uma pasta IRMÃ de agent/, fica
// invisível pro build a menos que seja copiado pra dentro de agent/
// primeiro. Esse script faz essa cópia, e deve rodar no host (onde o
// checkout completo do repo está disponível) ANTES de `docker build`.
//
// Mesmo padrão já usado em scripts/vendorAssets.js (raiz do repo, copia
// node_modules/bootstrap para public/vendor/ via postinstall) -- aqui não
// dá pra usar postinstall porque a fonte não vem do npm, vem de uma pasta
// irmã fora do contexto de build.
//
// agent/native/ nunca é commitado (ver agent/../.gitignore) -- é sempre
// reproduzido a partir da fonte única de verdade em Power-up/.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Node's synchronous filesystem API used by the build preparation script. */
declare const process: { exit(code: number): never };

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const agentRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(agentRoot, "..");

const source = path.join(repoRoot, "Power-up", "diff_patch_engine.cpp");
const destDir = path.join(agentRoot, "native");
const dest = path.join(destDir, "diff_patch_engine.cpp");

if (!fs.existsSync(source)) {
  console.error(
    `vendorPowerUp: fonte não encontrada em "${source}". ` +
      "Este script precisa rodar a partir de um checkout completo do " +
      "monorepo (agent/ e Power-up/ como pastas irmãs), não só da pasta agent/.",
  );
  process.exit(1);
}

fs.mkdirSync(destDir, { recursive: true });
fs.copyFileSync(source, dest);

console.log(`vendorPowerUp: copiado "${source}" -> "${dest}"`);
