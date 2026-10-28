import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

// Offline contract: the Agent may deploy without Google credentials, and the
// dependency update must not make importing the Agent fail at boot.
test('Artifact Registry v5 exposes the expected v1 client without credentials', () => {
  const registry = require('@google-cloud/artifact-registry');
  const Client = registry.v1?.ArtifactRegistryClient
    ?? registry.ArtifactRegistryClient;
  assert.equal(typeof Client, 'function', 'ArtifactRegistryClient export missing');
  assert.equal(typeof Client.prototype.getRepository, 'function');
  assert.equal(typeof Client.prototype.listRepositories, 'function');
  // No requests are issued, and no Google Application Default Credentials
  // are required just to load the SDK or create its client.
  const client = new Client({
    projectId: 'softload-local-test',
    fallback: true,
  });
  assert.equal(typeof client.getRepository, 'function');
  assert.equal(typeof client.close, 'function');
});
