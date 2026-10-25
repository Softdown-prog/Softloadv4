import { test } from "node:test";
import assert from "node:assert/strict";
import { Permissions } from "./permissions.js";
import { CommandPolicy } from "./command-policy.js";

test("security: restricted mode denies unknown and sensitive actions by default", () => {
  const permissions = new Permissions();
  for (const action of [
    "unknown.action",
    "shell.execute",
    "git.commit",
    "github.issue_create",
    "web.fetch",
    "mcp.call_tool",
  ]) {
    assert.equal(permissions.can(action), false, action);
  }
  assert.equal(permissions.can("file.read"), true);
  assert.throws(
    () => permissions.require("shell.execute"),
    (error) => error.code === "PERMISSION_DENIED",
  );
});

test("security: custom overrides, grant/revoke, snapshot isolation", () => {
  const permissions = new Permissions({
    mode: "restricted",
    role: "validator",
    permissions: { "file.read": false },
  });
  assert.equal(permissions.can("file.read"), false);
  permissions.grant("file.read");
  assert.equal(permissions.can("file.read"), true);
  const snapshot = permissions.snapshot();
  snapshot["file.read"] = false;
  assert.equal(permissions.can("file.read"), true);
  assert.equal(snapshot.role, "validator");
  permissions.revoke("file.read");
  assert.equal(permissions.can("file.read"), false);
});

test("security: full mode bypass remains explicit", () => {
  const permissions = new Permissions({ mode: "full" });
  permissions.revoke("shell.execute");
  assert.equal(permissions.can("shell.execute"), true);
});

test("security: commands enforce executable allowlist and exact prefix boundaries", () => {
  const policy = new CommandPolicy({
    allowedCommands: ["npm", "node"],
    allowedPrefixes: ["npm test"],
  });
  assert.deepEqual(policy.validate("npm test"), {
    allowed: true,
    executable: "npm",
  });
  assert.equal(policy.validate("npm test -- --runInBand").allowed, true);
  assert.throws(() => policy.validate("npm testxyz"), /prefixos permitidos/);
  assert.throws(() => policy.validate("npm install"), /prefixos permitidos/);
  assert.throws(() => policy.validate("node --version"), /prefixos permitidos/);
  assert.throws(
    () => new CommandPolicy().validate("sudo node -v"),
    (error) => error.code === "EXECUTABLE_NOT_ALLOWED",
  );
});

test("security: dangerous commands remain blocked even with an allowlisted executable", () => {
  const policy = new CommandPolicy({ allowedCommands: ["rm", "npm"] });
  for (const command of ["rm -rf /", "rm -rf *", "npm reboot"]) {
    assert.throws(
      () => policy.validate(command),
      (error) => error.code === "COMMAND_BLOCKED",
      command,
    );
  }
});
