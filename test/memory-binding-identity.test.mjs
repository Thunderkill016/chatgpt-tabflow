import assert from 'node:assert/strict';
import {
  clearMemoryBindingsForTab,
  memoryActorKey,
  memoryBindingLookupKeys
} from '../memory/binding-identity.js';
import {
  isWorkspaceMemorySender,
  selectWorkspaceProject
} from '../memory/workspace-inheritance.js';

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

const workspaceUrl = 'chrome-extension://tabflow-test/workspace/index.html';
assert.equal(isWorkspaceMemorySender({
  frameId: 3,
  url: 'https://chatgpt.com/',
  tab: { url: workspaceUrl }
}, workspaceUrl), true, 'ChatGPT subframe inside the TabFlow workspace is authorized for project inheritance');
assert.equal(isWorkspaceMemorySender({
  frameId: 0,
  url: 'https://chatgpt.com/',
  tab: { url: 'https://chatgpt.com/' }
}, workspaceUrl), false, 'top-frame ChatGPT never receives workspace default inheritance');
assert.equal(isWorkspaceMemorySender({
  frameId: 3,
  url: 'https://chatgpt.com/',
  tab: { url: 'chrome-extension://tabflow-test/options/options.html' }
}, workspaceUrl), false, 'other extension pages cannot authorize workspace inheritance');
assert.equal(isWorkspaceMemorySender({
  frameId: 3,
  url: 'https://example.com/',
  tab: { url: workspaceUrl }
}, workspaceUrl), false, 'non-ChatGPT subframes are rejected');

const selected = selectWorkspaceProject(
  { projectId: 'project-a', projectName: 'Stale label' },
  [
    { id: 'project-a', name: 'Project A', stack: 'TypeScript', rules: 'No eval.' },
    { id: 'project-b', name: 'Project B' }
  ]
);
assert.deepEqual(selected, {
  id: 'project-a',
  name: 'Project A',
  stack: 'TypeScript',
  rules: 'No eval.'
}, 'workspace inheritance resolves the canonical project from Project Vault');
assert.equal(
  selectWorkspaceProject({ projectId: 'deleted-project' }, [{ id: 'project-a', name: 'Project A' }]),
  null,
  'stale runtime settings do not resurrect a deleted project'
);

console.log('✅ memory-binding-identity.test.mjs passed');
