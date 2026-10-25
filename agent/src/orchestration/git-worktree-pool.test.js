import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createWorktree, removeWorktree } from "./git-worktree-pool.js";

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

test("git worktrees: dispatches isolados em HEAD detached e limpeza independente", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "softload-worktrees-"));
  const repoRoot = path.join(base, "repo");
  const worktreesRoot = path.join(base, "dispatch");
  await fs.mkdir(repoRoot);
  const active = [];
  try {
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base"]);
    const first = await createWorktree({ repoRoot, worktreesRoot });
    active.push(first.path);
    const second = await createWorktree({ repoRoot, worktreesRoot });
    active.push(second.path);

    assert.notEqual(first.path, second.path);
    assert.equal(git(first.path, ["rev-parse", "HEAD"]), git(repoRoot, ["rev-parse", "HEAD"]));
    assert.equal(git(second.path, ["rev-parse", "--abbrev-ref", "HEAD"]), "HEAD");
    await fs.writeFile(path.join(first.path, "only-first.txt"), "isolated");
    await assert.rejects(() => fs.access(path.join(second.path, "only-first.txt")));

    await removeWorktree({ repoRoot, worktreePath: first.path });
    active.shift();
    await assert.rejects(() => fs.access(first.path));
    assert.equal(git(second.path, ["rev-parse", "--is-inside-work-tree"]), "true");

    await removeWorktree({ repoRoot, worktreePath: second.path });
    active.shift();
    await assert.rejects(() => fs.access(second.path));
    const registered = git(repoRoot, ["worktree", "list", "--porcelain"]);
    assert.equal((registered.match(/^worktree /gm) || []).length, 1);
  } finally {
    for (const worktreePath of active) {
      try { await removeWorktree({ repoRoot, worktreePath }); } catch {}
    }
    await fs.rm(base, { recursive: true, force: true });
  }
});

test("git worktrees: ref inexistente rejeitado sem criar worktree registrado", async () => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "softload-worktree-invalid-"));
  const repoRoot = path.join(base, "repo");
  try {
    await fs.mkdir(repoRoot);
    git(repoRoot, ["init", "-q"]);
    git(repoRoot, ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--allow-empty", "-qm", "base"]);
    await assert.rejects(
      () => createWorktree({ repoRoot, worktreesRoot: path.join(base, "dispatch"), ref: "ref-que-nao-existe" }),
      /git worktree add falhou/,
    );
    assert.equal((git(repoRoot, ["worktree", "list", "--porcelain"]).match(/^worktree /gm) || []).length, 1);
  } finally {
    await fs.rm(base, { recursive: true, force: true });
  }
});
