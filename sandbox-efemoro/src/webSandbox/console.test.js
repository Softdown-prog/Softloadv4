import { test } from "node:test";
import assert from "node:assert/strict";
import { attachConsoleListeners, MAX_EVENTS } from "./console.js";

test("console de erros e avisos permanece limitado a 100 eventos cada", () => {
  const events = new Map();
  const result = { console: { errors: [], warnings: [] } };
  attachConsoleListeners({ on: (name, listener) => events.set(name, listener) }, result);
  for (let i = 0; i < MAX_EVENTS + 5; i++) {
    events.get("console")({ type: () => "error", text: () => "erro", location: () => ({ url: "test", lineNumber: 1, columnNumber: 1 }) });
    events.get("console")({ type: () => "warning", text: () => "aviso", location: () => ({ url: "test", lineNumber: 1, columnNumber: 1 }) });
  }
  events.get("pageerror")(new Error("depois do limite"));
  assert.equal(result.console.errors.length, MAX_EVENTS);
  assert.equal(result.console.warnings.length, MAX_EVENTS);
  assert.equal(result.console.errors[0].text, "erro");
});

test("pageerror preserva texto e stack", () => {
  const events = new Map();
  const result = { console: { errors: [], warnings: [] } };
  attachConsoleListeners({ on: (name, listener) => events.set(name, listener) }, result);
  events.get("pageerror")(new Error("falha"));
  assert.match(result.console.errors[0].text, /Page Error: falha/);
  assert.equal(typeof result.console.errors[0].stack, "string");
});
