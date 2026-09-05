import assert from 'node:assert/strict';
import { BM25ProjectIndex } from '../memory/bm25.js';
import { isStaleObservation, monotonicObservedAt, newestObservedAt } from '../memory/versioning.js';
import {
  chunkCode,
  chunkProse,
  estimateTokens,
  extractSymbols,
  inferPathFromCode,
  normalizePath,
  tokenize
} from '../memory/text.js';

function testTokenizer() {
  const tokens = tokenize('src/auth.ts refreshAccessToken user_session OAuth2');
  assert(tokens.includes('auth'));
  assert(tokens.includes('refresh'));
  assert(tokens.includes('access'));
  assert(tokens.includes('token'));
  assert(tokens.includes('user_session'));
}

function testPathSafety() {
  assert.equal(normalizePath('/src/../src/auth.ts'), 'src/auth.ts');
  assert.equal(normalizePath('../../etc/passwd'), 'etc/passwd');
  assert.equal(inferPathFromCode('// src/auth.ts\nexport function login() {}', '', 'typescript'), 'src/auth.ts');
}

function testChunking() {
  const code = Array.from({ length: 220 }, (_, i) => i === 5 ? 'export function login() {' : `const x${i} = ${i};`).join('\n');
  const chunks = chunkCode(code, 'typescript');
  assert(chunks.length >= 3);
  assert(chunks[0].lineStart === 1);
  assert(chunks.some(chunk => chunk.symbols.includes('login')));

  const prose = 'Architecture constraint. '.repeat(200);
  const proseChunks = chunkProse(prose, { maxChars: 500, overlapChars: 50 });
  assert(proseChunks.length > 1);
}

function testBm25() {
  const index = new BM25ProjectIndex('p1');
  index.add({
    id: 'auth',
    kind: 'code',
    path: 'src/auth/refresh-token.ts',
    symbols: ['refreshAccessToken'],
    content: 'export async function refreshAccessToken(session) { return rotate(session.refreshToken); }',
    updatedAt: Date.now()
  });
  index.add({
    id: 'ui',
    kind: 'code',
    path: 'src/ui/button.tsx',
    symbols: ['PrimaryButton'],
    content: 'export function PrimaryButton() { return <button>Save</button>; }',
    updatedAt: Date.now()
  });
  index.add({
    id: 'decision',
    kind: 'user-message',
    path: '',
    symbols: [],
    content: 'Use refresh token rotation and never store access tokens in localStorage.',
    updatedAt: Date.now()
  });

  const results = index.search('fix refreshAccessToken token rotation', { limit: 3 });
  assert.equal(results[0].id, 'auth');
  assert(results.some(item => item.id === 'decision'));
}

function testBudgetEstimate() {
  assert(estimateTokens('a'.repeat(280), 'code') >= 100);
  assert(estimateTokens('a'.repeat(400), 'prose') >= 100);
}

function testObservationVersioning() {
  const evidence = [
    { updatedAt: 1000 },
    { updatedAt: 3000 },
    { observedAt: 2500 }
  ];
  assert.equal(newestObservedAt(evidence), 3000);
  assert.equal(isStaleObservation(evidence, 2000), true, 'older archive must be rejected');
  assert.equal(isStaleObservation(evidence, 3000), false, 'same observation time is not stale');
  assert.equal(isStaleObservation(evidence, 4000), false, 'newer live observation must be accepted');
  assert.equal(isStaleObservation([], 1), false, 'first historical observation remains ingestible');
  assert.equal(monotonicObservedAt(5000, 1000), 5000, 'timestamps never regress');
  assert.equal(monotonicObservedAt(1000, 5000), 5000, 'newer timestamp advances state');
  assert.equal(monotonicObservedAt(0, 0, 7), 7, 'fallback timestamp is supported');
}

testTokenizer();
testPathSafety();
testChunking();
testBm25();
testBudgetEstimate();
testObservationVersioning();
console.log('memory-core.test.mjs: all tests passed');
