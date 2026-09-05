import assert from 'node:assert/strict';
import {
  createPaneDiagnostic,
  markExpectedDocumentChange,
  observePaneDiagnostic,
  summarizePaneDiagnostics
} from '../workspace/diagnostics.js';

const first = observePaneDiagnostic(createPaneDiagnostic(), {
  documentToken: 'doc-a',
  href: 'https://chatgpt.com/c/a',
  generationActive: false,
  observedAt: 1_000
});
assert.equal(first.unexpectedRemounts, 0, 'first observation is never a remount');

const spa = observePaneDiagnostic(first, {
  documentToken: 'doc-a',
  href: 'https://chatgpt.com/c/b',
  generationActive: true,
  observedAt: 2_000
});
assert.equal(spa.spaNavigations, 1, 'same document token + new href is SPA navigation');
assert.equal(spa.generationActive, true, 'generation state is tracked without layout reads');

const fullNavigation = observePaneDiagnostic(spa, {
  documentToken: 'doc-b',
  href: 'https://chatgpt.com/c/c',
  generationActive: false,
  observedAt: 3_000
});
assert.equal(fullNavigation.fullNavigations, 1, 'new document token + new href is full navigation');
assert.equal(fullNavigation.unexpectedRemounts, 0, 'legitimate full navigation is not a same-URL remount');

const unexpected = observePaneDiagnostic(fullNavigation, {
  documentToken: 'doc-c',
  href: 'https://chatgpt.com/c/c',
  generationActive: false,
  observedAt: 4_000
});
assert.equal(unexpected.unexpectedRemounts, 1, 'same URL with a new document token is an unexpected remount');

const expectedArmed = markExpectedDocumentChange(unexpected, 5_000, 10_000);
const expected = observePaneDiagnostic(expectedArmed, {
  documentToken: 'doc-d',
  href: 'https://chatgpt.com/c/c',
  generationActive: false,
  observedAt: 6_000
});
assert.equal(expected.expectedReloads, 1, 'explicit reload is recorded separately');
assert.equal(expected.unexpectedRemounts, 1, 'explicit reload does not increase unexpected-remount count');
assert.equal(expected.expectedDocumentChangeUntil, 0, 'reload expectation is consumed by document change');

const expiredArm = markExpectedDocumentChange(expected, 7_000, 1_000);
const expired = observePaneDiagnostic(expiredArm, {
  documentToken: 'doc-e',
  href: 'https://chatgpt.com/c/c',
  generationActive: true,
  observedAt: 9_000
});
assert.equal(expired.unexpectedRemounts, 2, 'expired reload expectation fails closed as unexpected remount');

const totals = summarizePaneDiagnostics([
  expired,
  { ...createPaneDiagnostic(), generationActive: true, unexpectedRemounts: 2, spaNavigations: 3 }
]);
assert.deepEqual(totals, {
  generating: 2,
  unexpectedRemounts: 4,
  fullNavigations: 1,
  spaNavigations: 4
});

console.log('✅ workspace-diagnostics.test.mjs passed');
