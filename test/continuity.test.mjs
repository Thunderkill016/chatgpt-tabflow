import assert from 'node:assert/strict';
import {
  activeBranchFromGraph,
  buildConversationGraph,
  createContinuityCheckpoint,
  formatContinuityCheckpoint
} from '../memory/continuity.js';

const graph = buildConversationGraph([
  { id: 'root', role: 'system', text: 'system', childrenIds: ['u1'] },
  { id: 'u1', role: 'user', parentId: 'root', text: 'first', childrenIds: ['a1', 'a1b'] },
  { id: 'a1', role: 'assistant', parentId: 'u1', text: 'answer A', childrenIds: ['u2'] },
  { id: 'a1b', role: 'assistant', parentId: 'u1', text: 'answer B', childrenIds: [] },
  { id: 'u2', role: 'user', parentId: 'a1', text: 'continue', childrenIds: ['a2'] },
  { id: 'a2', role: 'assistant', parentId: 'u2', text: 'done', childrenIds: [] }
], 'a2');

assert.equal(graph.currentId, 'a2');
assert.deepEqual(activeBranchFromGraph(graph).map(node => node.id), ['root', 'u1', 'a1', 'u2', 'a2']);
assert.deepEqual([...graph.nodes.get('u1').childrenIds].sort(), ['a1', 'a1b']);

const repaired = buildConversationGraph([
  { id: 'p', role: 'user', text: 'parent', childrenIds: [] },
  { id: 'c', role: 'assistant', parentId: 'p', text: 'child', childrenIds: ['missing'] }
], 'c');
assert.deepEqual(repaired.nodes.get('p').childrenIds, ['c'], 'parent relationship repairs missing child link');
assert.deepEqual(repaired.nodes.get('c').childrenIds, [], 'dangling child ids are removed');

const checkpoint = createContinuityCheckpoint({
  projectId: 'project-1',
  conversationId: 'conversation-1',
  checkpointMessageId: 'a2',
  summary: 'Authentication migration is half complete.',
  constraints: ['Do not change public API', 'Do not change public API'],
  decisions: ['Use refresh token rotation'],
  files: ['src/auth.ts', 'src/api.ts'],
  currentTask: 'Finish refresh token handling',
  unresolved: ['How to migrate old sessions?'],
  nextSteps: ['Add tests', 'Run integration suite'],
  recentMessages: [
    { id: 'u2', role: 'user', text: 'continue' },
    { id: 'a2', role: 'assistant', text: 'done' }
  ],
  createdAt: 12345
});

assert.equal(checkpoint.schemaVersion, 1);
assert.equal(checkpoint.constraints.length, 1, 'checkpoint de-duplicates constraints');
assert.equal(checkpoint.recentTail.length, 2);
assert.match(formatContinuityCheckpoint(checkpoint), /Current task: Finish refresh token handling/);
assert.match(formatContinuityCheckpoint(checkpoint), /Relevant files: src\/auth\.ts, src\/api\.ts/);
assert.match(checkpoint.id, /project-1:checkpoint:conversation-1:a2:12345/);

assert.throws(() => createContinuityCheckpoint({ projectId: '', conversationId: 'x' }), /required/);

console.log('✅ continuity.test.mjs passed');
