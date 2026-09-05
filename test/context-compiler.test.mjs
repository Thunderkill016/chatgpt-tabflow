import assert from 'node:assert/strict';
import { buildStructuralCandidates, compileContext } from '../memory/context-compiler.js';

const estimateTokens = text => Math.max(1, Math.ceil(String(text).length / 4));

const candidates = [
  { id: 'a1', tier: 'authority', priority: 100, text: 'A'.repeat(160) },
  { id: 'c1', tier: 'continuity', priority: 100, text: 'C'.repeat(160) },
  { id: 'p1', tier: 'profile', priority: 100, text: 'P'.repeat(80) },
  { id: 's1', tier: 'structural', priority: 100, text: 'S'.repeat(120) },
  { id: 'r1', tier: 'retrieval', priority: 100, score: 10, text: 'R'.repeat(320) },
  { id: 'r2', tier: 'retrieval', priority: 90, score: 9, text: 'r'.repeat(320) }
];

const compiled = compileContext({ maxTokens: 200, candidates, estimateTokens });
assert.ok(compiled.usedTokens <= 200, 'compiler never exceeds global budget');
assert.ok(compiled.selected.some(item => item.tier === 'authority'), 'authority tier survives retrieval pressure');
assert.ok(compiled.selected.some(item => item.tier === 'continuity'), 'continuity tier survives retrieval pressure');
assert.ok(compiled.selected.some(item => item.tier === 'profile'), 'profile tier receives reserved budget');
assert.ok(compiled.selected.some(item => item.tier === 'structural'), 'structural map receives reserved budget');

const spill = compileContext({
  maxTokens: 120,
  candidates: [
    { id: 'authority', tier: 'authority', text: 'rule' },
    { id: 'retrieval-1', tier: 'retrieval', score: 2, text: 'x'.repeat(160) },
    { id: 'retrieval-2', tier: 'retrieval', score: 1, text: 'y'.repeat(160) }
  ],
  estimateTokens
});
assert.ok(spill.selected.some(item => item.id === 'retrieval-1'), 'unused empty-tier quota spills into retrieval');
assert.ok(spill.usedTokens <= 120, 'spillover stays inside budget');

const stable = compileContext({
  maxTokens: 80,
  candidates: [
    { id: 'low', tier: 'retrieval', priority: 1, score: 1, text: 'a'.repeat(80) },
    { id: 'high', tier: 'retrieval', priority: 2, score: 1, text: 'b'.repeat(80) }
  ],
  estimateTokens
});
assert.ok(stable.selected.findIndex(item => item.id === 'high') < stable.selected.findIndex(item => item.id === 'low'), 'higher priority is deterministic');

const structural = buildStructuralCandidates([
  { kind: 'code', path: 'src/auth.ts', language: 'typescript', symbols: ['login', 'refreshToken'], score: 8, conversationId: 'c1' },
  { kind: 'code', path: 'src/auth.ts', language: 'typescript', symbols: ['logout', 'login'], score: 7, conversationId: 'c1' },
  { kind: 'code', path: 'src/api.ts', language: 'typescript', symbols: ['request'], score: 3, conversationId: 'c2' },
  { kind: 'assistant-message', path: '', score: 99, content: 'not structural' }
]);
assert.equal(structural.length, 2);
assert.equal(structural[0].id, 'structure:src/auth.ts');
assert.match(structural[0].text, /login/);
assert.match(structural[0].text, /refreshToken/);
assert.match(structural[0].text, /logout/);
assert.equal(new Set(structural[0].citation.symbols).size, structural[0].citation.symbols.length, 'symbols deduplicate');

console.log('✅ context-compiler.test.mjs passed');
