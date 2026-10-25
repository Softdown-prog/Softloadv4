import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentDispatchCapability } from "./agent-dispatch-capability.js";

test("dispatch exige permissão antes de acionar o subagente", async () => {
  let invoked = false;
  const capability = new AgentDispatchCapability({
    permissions: { require() { throw new Error("sem permissão"); } },
    dispatchTargets: { explorer: async () => { invoked = true; } },
  });
  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch", targetRole: "explorer" }),
    /sem permissão/,
  );
  assert.equal(invoked, false);
});

test("dispatch rejeita targetRole ausente e desconhecido", async () => {
  const capability = new AgentDispatchCapability({ permissions: { require() {} } });
  await assert.rejects(() => capability.execute({ type: "agent.dispatch" }), /exige targetRole/);
  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch", targetRole: "nao-existe" }),
    (error) => error.code === "TARGET_ROLE_NOT_FOUND",
  );
});

test("dispatch entrega payload ao papel autorizado e preserva o resultado", async () => {
  const seen = [];
  const capability = new AgentDispatchCapability({
    permissions: { require(type) { seen.push(type); } },
    dispatchTargets: { explorer: async payload => { seen.push(payload); return { files: 3 }; } },
  });
  const payload = { path: "." };
  const response = await capability.execute({ type: "agent.dispatch", targetRole: "explorer", payload });
  assert.equal(response.targetRole, "explorer");
  assert.deepEqual(response.result, { files: 3 });
  assert.ok(response.durationMs >= 0);
  assert.deepEqual(seen, ["agent.dispatch", payload]);
});

test("dispatch propaga a falha real do handler sem reformatar", async () => {
  const failure = new Error("falha no validador");
  const capability = new AgentDispatchCapability({
    permissions: { require() {} },
    dispatchTargets: { validator: async () => { throw failure; } },
  });
  await assert.rejects(
    () => capability.execute({ type: "agent.dispatch", targetRole: "validator" }),
    error => error === failure,
  );
});
