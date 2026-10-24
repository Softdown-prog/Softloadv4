import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "./workspace.js";

async function makeTempWorkspace() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "sl-workspace-test-"));
  const root = path.join(base, "workspace");
  const workspace = new Workspace({ root });
  await workspace.initialize();
  return { base, root, workspace };
}

test("write/read/list/exists funcionam normalmente dentro do workspace", async () => {
  const { base, workspace } = await makeTempWorkspace();

  try {
    await workspace.write("sub/dir/arquivo.txt", "conteudo");

    assert.equal(await workspace.exists("sub/dir/arquivo.txt"), true);
    assert.equal(await workspace.read("sub/dir/arquivo.txt"), "conteudo");

    const entries = await workspace.list("sub/dir");
    assert.equal(entries.length, 1);
    assert.equal(entries[0].name, "arquivo.txt");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("resolve() bloqueia path traversal textual (../)", async () => {
  const { base, workspace } = await makeTempWorkspace();

  try {
    await assert.rejects(
      () => workspace.resolve("../../etc/passwd"),
      /Caminho fora do workspace/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("resolve() bloqueia escape via symlink apontando para fora do root", async () => {
  const { base, root, workspace } = await makeTempWorkspace();

  try {
    const outside = path.join(base, "fora-do-workspace");
    await fs.mkdir(outside, { recursive: true });
    await fs.writeFile(path.join(outside, "segredo.txt"), "nao deveria ser lido");

    const linkPath = path.join(root, "link-malicioso");
    await fs.symlink(outside, linkPath, "dir");

    await assert.rejects(
      () => workspace.resolve("link-malicioso/segredo.txt"),
      /symlink escapa do root/,
    );

    await assert.rejects(
      () => workspace.read("link-malicioso/segredo.txt"),
      /symlink escapa do root/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("resolve() permite symlink que aponta para dentro do próprio workspace", async () => {
  const { base, root, workspace } = await makeTempWorkspace();

  try {
    await workspace.write("real/arquivo.txt", "ok");

    const linkPath = path.join(root, "link-interno");
    await fs.symlink(path.join(root, "real"), linkPath, "dir");

    const resolved = await workspace.resolve("link-interno/arquivo.txt");
    assert.ok(resolved.length > 0);
    assert.equal(await workspace.read("link-interno/arquivo.txt"), "ok");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("writeAtomic() escreve o conteúdo e não deixa arquivo temporário para trás", async () => {
  const { base, root, workspace } = await makeTempWorkspace();

  try {
    await workspace.writeAtomic("sub/arquivo.txt", "conteudo atomico");

    assert.equal(await workspace.read("sub/arquivo.txt"), "conteudo atomico");

    const entries = await fs.readdir(path.join(root, "sub"));
    assert.deepEqual(entries, ["arquivo.txt"], "nenhum arquivo .tmp-* deveria sobrar");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("writeAtomic() sobrescreve um arquivo existente por completo", async () => {
  const { base, workspace } = await makeTempWorkspace();

  try {
    await workspace.write("arquivo.txt", "conteudo bem mais longo que o novo");
    await workspace.writeAtomic("arquivo.txt", "novo");

    assert.equal(await workspace.read("arquivo.txt"), "novo");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("writeAtomic() respeita path traversal (mesmo guard de resolve())", async () => {
  const { base, workspace } = await makeTempWorkspace();

  try {
    await assert.rejects(
      () => workspace.writeAtomic("../fora-do-workspace.txt", "x"),
      /Caminho fora do workspace/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("resolve() tolera caminhos que ainda não existem (ex: write novo)", async () => {
  const { base, workspace } = await makeTempWorkspace();

  try {
    const resolved = await workspace.resolve("novo/arquivo/ainda-nao-existe.txt");
    assert.ok(resolved.endsWith(path.join("novo", "arquivo", "ainda-nao-existe.txt")));
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
