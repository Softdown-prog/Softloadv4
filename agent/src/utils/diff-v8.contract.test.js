import test from 'node:test';
import assert from 'node:assert/strict';
import { createPatch, applyPatch, diffLines } from 'diff';

test('jsdiff v8 round-trips Agent file patches without losing line endings', () => {
  const before = 'export const value = 1;\n';
  const after = 'export const value = 2;\nexport const newLine = true;\n';
  const patch = createPatch('sample.ts', before, after);
  assert.equal(applyPatch(before, patch), after);
  const changes = diffLines(before, after);
  assert.ok(changes.some(entry => entry.added));
  assert.ok(changes.some(entry => entry.removed));
});

test('jsdiff v8 rejects a patch when the original text does not match', () => {
  const patch = createPatch('sample.txt', 'expected\n', 'updated\n');
  assert.equal(applyPatch('unexpected\n', patch), false);
});
