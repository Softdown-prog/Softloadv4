import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AssetForgeCapability } from './asset-forge.js';
import { Workspace } from '../core/workspace.js';
import { Permissions } from '../security/permissions.js';
import { createCoderPermissions, createExplorerPermissions, createValidatorPermissions } from '../security/role-permissions.js';
import { TaskRouter } from '../core/task-router.js';
import { parseTaskRequest, getSupportedOperations } from '../protocol/protocol.js';

test('Forge router, protocol and permissions expose only scoped asset generation', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-forge-'));
  try {
    const workspace = new Workspace({ root });
    const permissions = new Permissions();
    const forge = new AssetForgeCapability({ workspace, permissions });
    assert.ok((await forge.execute({ type: 'forge.catalog' })).recipes.length > 50);
    await assert.rejects(forge.execute({ type: 'forge.render', id: 'engine', command: 'html5-runtime' }), /Permissão negada/);
    assert.equal(createCoderPermissions().permissions.can('forge.render'), true);
    assert.equal(createExplorerPermissions().permissions.can('forge.render'), false);
    assert.equal(createValidatorPermissions().permissions.can('forge.render'), false);
    permissions.grant('forge.render');
    assert.equal(new TaskRouter({ capabilities: { forge } }).resolve({ type: 'forge.render' }).capabilityName, 'forge');
    await forge.execute({ type: 'forge.render', id: 'engine', command: 'html5-runtime' });
    assert.ok((await fs.stat(path.join(root, 'assets/engine/runtime.mjs'))).isFile());
    await assert.rejects(forge.execute({ type: 'forge.render', id: 'bad', command: 'html5-runtime', outputPath: '../outside' }));
    assert.ok(getSupportedOperations().forge.includes('render'));
    const parsed = parseTaskRequest({ request_id: 'forge', task: 'execute', actions: [{ id: 'a', capability: 'forge', operation: 'render', input: { id: 'engine2', command: 'html5-runtime' } }] });
    assert.ok(parsed);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
