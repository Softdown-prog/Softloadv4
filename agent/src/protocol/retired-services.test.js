import { test } from "node:test";
import assert from "node:assert/strict";
import { getSupportedOperations, parseTaskRequest } from "./protocol.js";
import { Agent } from "../agent.js";

test("Solaris Agent retains GitHub and MCP but not browser/archive", () => {
  const supported = getSupportedOperations();
  for (const removed of ["web-sandbox", "archive"]) {
    assert.equal(Object.hasOwn(supported, removed), false, removed);
  }
  for (const retained of ["git", "github", "mcp", "forge", "filesystem"]) {
    assert.ok(Object.hasOwn(supported, retained), retained);
  }

  const agent = new Agent({ workspaceRoot: "/tmp/softload-small-project-test" });
  for (const removed of ["webSandbox", "archive"]) {
    assert.equal(Object.hasOwn(agent.capabilities, removed), false, removed);
  }
  for (const retained of ["git", "github", "mcp", "forge", "filesystem"]) {
    assert.ok(Object.hasOwn(agent.capabilities, retained), retained);
  }
});

test("protocolo rejeita capabilities de navegador e ZIP descontinuadas", () => {
  for (const capability of ["web-sandbox", "archive"]) {
    assert.throws(() => parseTaskRequest({
      request_id: "legacy-capability",
      task: "execute",
      actions: [{ id: "a1", capability, operation: "run", input: {} }],
    }));
  }
});
