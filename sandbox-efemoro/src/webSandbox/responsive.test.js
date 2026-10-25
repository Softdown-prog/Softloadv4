import { test } from "node:test";
import assert from "node:assert/strict";
import { detectResponsiveIssues } from "./responsive.js";

test("detecta overflow horizontal e ausência de meta viewport", async () => {
  const result = await detectResponsiveIssues({ evaluate: async () => ({ hasOverflow: true, scrollWidth: 600, viewportWidth: 360, hasViewportMeta: false, viewportContent: "" }) });
  assert.equal(result.horizontalOverflow, true);
  assert.equal(result.viewportWarnings.length, 2);
});

test("aceita viewport responsiva sem avisos", async () => {
  const result = await detectResponsiveIssues({ evaluate: async () => ({ hasOverflow: false, scrollWidth: 360, viewportWidth: 360, hasViewportMeta: true, viewportContent: "width=device-width, initial-scale=1" }) });
  assert.deepEqual(result.viewportWarnings, []);
});

test("falha de evaluate é retornada como aviso", async () => {
  const result = await detectResponsiveIssues({ evaluate: async () => { throw new Error("page closed"); } });
  assert.match(result.viewportWarnings[0].message, /page closed/);
});
