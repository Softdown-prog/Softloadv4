import { test } from "node:test";
import assert from "node:assert/strict";
import { runAccessibilityAudit, AXE_TIMEOUT_MS } from "./accessibility.js";

test("falha na injeção de axe não interrompe a auditoria", async () => {
  const result = await runAccessibilityAudit({ addScriptTag: async () => { throw new Error("inject blocked"); } });
  assert.deepEqual(result.violations, []);
  assert.equal(typeof result.error, "string");
  assert.equal(AXE_TIMEOUT_MS, 15000);
});
