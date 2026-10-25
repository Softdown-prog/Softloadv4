import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const scriptSource = new URL("./vendorPowerUp.js", import.meta.url);

async function testRepo(withNativeSource) {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "softload-vendor-"));
  const scriptDir = path.join(base, "agent", "scripts");
  await fs.mkdir(scriptDir, { recursive: true });
  await fs.writeFile(path.join(base, "agent", "package.json"), '{"type":"module"}');
  await fs.copyFile(scriptSource, path.join(scriptDir, "vendorPowerUp.js"));
  if (withNativeSource) {
    await fs.mkdir(path.join(base, "Power-up"));
    await fs.writeFile(path.join(base, "Power-up", "diff_patch_engine.cpp"), "// fixture nao compilada\n");
  }
  return { base, script: path.join(scriptDir, "vendorPowerUp.js") };
}

test("vendorPowerUp: copia o arquivo nativo sem alterar os bytes", async () => {
  const { base, script } = await testRepo(true);
  try {
    execFileSync(process.execPath, [script], { cwd: base });
    assert.equal(
      await fs.readFile(path.join(base, "agent", "native", "diff_patch_engine.cpp"), "utf8"),
      "// fixture nao compilada\n",
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("vendorPowerUp: falha sem checkout Power-up e nao gera native", async () => {
  const { base, script } = await testRepo(false);
  try {
    assert.throws(
      () => execFileSync(process.execPath, [script], { cwd: base, stdio: "pipe" }),
      /Command failed/,
    );
    await assert.rejects(
      () => fs.access(path.join(base, "agent", "native", "diff_patch_engine.cpp")),
    );
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
