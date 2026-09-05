import assert from 'node:assert/strict';
import {
  clearMemoryBindingsForTab,
  memoryActorKey,
  memoryBindingLookupKeys
} from '../memory/binding-identity.js';

assert.equal(memoryActorKey(7, 0, 'doc-top'), '7:0', 'top frame survives document reloads');
assert.equal(memoryActorKey(7, 3, 'doc-a'), '7:3:doc-a', 'subframe identity includes document id');
assert.equal(memoryActorKey(7, 3, ''), '7:3', 'subframe falls back to frame id when document id is unavailable');
assert.equal(memoryActorKey(-1, 0), '', 'invalid tab id is rejected');

assert.deepEqual(memoryBindingLookupKeys(7, 0, 'ignored'), ['7:0', '7'], 'top frame can migrate legacy tab-only binding');
assert.deepEqual(memoryBindingLookupKeys(7, 3, 'doc-a'), ['7:3:doc-a'], 'subframe never inherits top-frame legacy binding');

const bindings = {
  '7': { projectId: 'legacy' },
  '7:0': { projectId: 'top' },
  '7:3:doc-a': { projectId: 'pane-a' },
  '8:0': { projectId: 'other' }
};
const cleared = clearMemoryBindingsForTab(bindings, 7);
assert.deepEqual(cleared, { '8:0': { projectId: 'other' } }, 'closing a tab clears all document/frame actors for that tab');
assert.equal(Object.keys(bindings).length, 4, 'cleanup is immutable');

console.log('✅ memory-binding-identity.test.mjs passed');
