import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Workspace } from "../core/workspace.js";
import { Permissions } from "../security/permissions.js";
import { FileSystemCapability } from "./filesystem.js";

async function makeCapability(permissionsOverride) {
  const base = await fs.mkdtemp(
    path.join(os.tmpdir(), "sl-filesystem-test-"),
  );
  const root = path.join(base, "workspace");
  const workspace = new Workspace({ root });
  await workspace.initialize();

  const permissions = new Permissions({
    mode: "full",
    ...(permissionsOverride || {}),
  });

  const capability = new FileSystemCapability({ workspace, permissions });

  return { base, workspace, capability };
}

test("file.read sem offset/limit devolve o arquivo inteiro quando ele cabe no default", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "linha1\nlinha2\nlinha3",
    });

    const result = await capability.execute({ type: "file.read", path: "a.txt" });

    assert.equal(result.content, "linha1\nlinha2\nlinha3");
    assert.equal(result.totalLines, 3);
    assert.equal(result.offset, 1);
    assert.equal(result.truncated, false);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.read com limit corta o arquivo e sinaliza truncated", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "l1\nl2\nl3\nl4\nl5",
    });

    const result = await capability.execute({
      type: "file.read",
      path: "a.txt",
      limit: 2,
    });

    assert.equal(result.content, "l1\nl2");
    assert.equal(result.totalLines, 5);
    assert.equal(result.truncated, true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.read com offset pagina a partir da linha pedida (1-indexado)", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "l1\nl2\nl3\nl4\nl5",
    });

    const result = await capability.execute({
      type: "file.read",
      path: "a.txt",
      offset: 3,
      limit: 2,
    });

    assert.equal(result.content, "l3\nl4");
    assert.equal(result.offset, 3);
    assert.equal(result.truncated, true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.read pagina até o fim exato do arquivo sem marcar truncated", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "l1\nl2\nl3",
    });

    const result = await capability.execute({
      type: "file.read",
      path: "a.txt",
      offset: 2,
      limit: 2,
    });

    assert.equal(result.content, "l2\nl3");
    assert.equal(result.truncated, false);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.read aplica DEFAULT_READ_LIMIT_LINES (2000) quando o arquivo é maior e nenhum limit é passado", async () => {
  const { base, capability } = await makeCapability();

  try {
    const linhas = Array.from({ length: 2500 }, (_, i) => `linha${i + 1}`);
    await capability.execute({
      type: "file.write",
      path: "grande.txt",
      content: linhas.join("\n"),
    });

    const result = await capability.execute({ type: "file.read", path: "grande.txt" });

    assert.equal(result.content.split("\n").length, 2000);
    assert.equal(result.totalLines, 2500);
    assert.equal(result.truncated, true);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.read rejeita offset/limit inválidos", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({ type: "file.write", path: "a.txt", content: "x" });

    await assert.rejects(
      () => capability.execute({ type: "file.read", path: "a.txt", offset: 0 }),
      /offset/,
    );
    await assert.rejects(
      () => capability.execute({ type: "file.read", path: "a.txt", offset: -1 }),
      /offset/,
    );
    await assert.rejects(
      () => capability.execute({ type: "file.read", path: "a.txt", offset: 1.5 }),
      /offset/,
    );
    await assert.rejects(
      () => capability.execute({ type: "file.read", path: "a.txt", limit: 0 }),
      /limit/,
    );
    await assert.rejects(
      () => capability.execute({ type: "file.read", path: "a.txt", limit: -1 }),
      /limit/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit troca a única ocorrência de oldString por newString", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "const x = 1;\nconst y = 2;\n",
    });

    const result = await capability.execute({
      type: "file.edit",
      path: "a.txt",
      oldString: "const x = 1;",
      newString: "const x = 100;",
    });

    assert.equal(result.edited, true);
    assert.equal(result.occurrences, 1);

    const { content } = await capability.execute({
      type: "file.read",
      path: "a.txt",
    });
    assert.equal(content, "const x = 100;\nconst y = 2;\n");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit lança erro se oldString não existe no arquivo", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "conteudo original",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.edit",
          path: "a.txt",
          oldString: "isso não existe aqui",
          newString: "x",
        }),
      /não encontrado/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit lança erro se oldString é ambíguo (aparece mais de 1x) sem replaceAll", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "foo\nfoo\nfoo\n",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.edit",
          path: "a.txt",
          oldString: "foo",
          newString: "bar",
        }),
      /ambíguo/,
    );

    // Nada foi alterado -- a checagem de ambiguidade acontece ANTES
    // de qualquer escrita.
    const { content } = await capability.execute({
      type: "file.read",
      path: "a.txt",
    });
    assert.equal(content, "foo\nfoo\nfoo\n");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit com replaceAll:true troca TODAS as ocorrências", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "foo\nfoo\nfoo\n",
    });

    const result = await capability.execute({
      type: "file.edit",
      path: "a.txt",
      oldString: "foo",
      newString: "bar",
      replaceAll: true,
    });

    assert.equal(result.occurrences, 3);

    const { content } = await capability.execute({
      type: "file.read",
      path: "a.txt",
    });
    assert.equal(content, "bar\nbar\nbar\n");
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit rejeita oldString ausente/vazio", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "x",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.edit",
          path: "a.txt",
          oldString: "",
          newString: "y",
        }),
      /oldString/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit rejeita oldString === newString", async () => {
  const { base, capability } = await makeCapability();

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "x",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.edit",
          path: "a.txt",
          oldString: "x",
          newString: "x",
        }),
      /idênticos/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("file.edit respeita Permissions -- negado por padrão quando revogado", async () => {
  const { base, capability } = await makeCapability({
    mode: "restricted",
    permissions: { "file.write": true, "file.edit": false },
  });

  try {
    await capability.execute({
      type: "file.write",
      path: "a.txt",
      content: "x",
    });

    await assert.rejects(
      () =>
        capability.execute({
          type: "file.edit",
          path: "a.txt",
          oldString: "x",
          newString: "y",
        }),
      /Permissão negada/,
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
