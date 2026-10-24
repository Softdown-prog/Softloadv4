import { test } from "node:test";
import assert from "node:assert/strict";
import { Permissions } from "./permissions.js";
import {
  createExplorerPermissions,
  createArchitectPermissions,
  createCoderPermissions,
  createValidatorPermissions,
  createPackagerPermissions,
  createOrchestratorPermissions,
} from "./role-permissions.js";

test("archive.extract_zip continua negada no preset default", () => {
  const permissions = new Permissions();

  assert.equal(permissions.can("archive.extract_zip"), false);
});

test("archive.extract_zip é liberada somente para o Coder", () => {
  const presets = [
    ["explorer", createExplorerPermissions],
    ["architect", createArchitectPermissions],
    ["coder", createCoderPermissions],
    ["validator", createValidatorPermissions],
    ["packager", createPackagerPermissions],
    ["orchestrator", createOrchestratorPermissions],
  ];

  for (const [role, createPreset] of presets) {
    const { permissions } = createPreset();

    assert.equal(
      permissions.can("archive.extract_zip"),
      role === "coder",
      `permissão inesperada para o papel ${role}`,
    );
  }
});


test("knowledge.search só é permitida aos papéis técnicos de leitura/código", () => {
  assert.equal(new Permissions().can("knowledge.search"), false);
  const presets = [
    ["explorer", createExplorerPermissions],
    ["architect", createArchitectPermissions],
    ["coder", createCoderPermissions],
    ["validator", createValidatorPermissions],
    ["packager", createPackagerPermissions],
    ["orchestrator", createOrchestratorPermissions],
  ];
  for (const [role, factory] of presets) {
    assert.equal(factory().permissions.can("knowledge.search"),
      ["explorer", "architect", "coder"].includes(role), role);
  }
});
