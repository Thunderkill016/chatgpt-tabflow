import assert from 'node:assert/strict';
import {
  classifyMemoryPressure,
  deriveExecutionMode,
  isProductiveStateFresh,
  PRODUCTIVE_STATE_STALE_MS,
  recommendedParallelGenerators,
  shouldProtectFromDiscard
} from '../runtime/policy.js';

const normal = classifyMemoryPressure({ capacity: 16, availableCapacity: 8 });
assert.equal(normal.level, 'normal');
assert.equal(normal.ratio, 0.5);

assert.equal(classifyMemoryPressure({ capacity: 100, availableCapacity: 25 }).level, 'medium');
assert.equal(classifyMemoryPressure({ capacity: 100, availableCapacity: 18 }).level, 'high');
assert.equal(classifyMemoryPressure({ capacity: 100, availableCapacity: 8 }).level, 'critical');
assert.equal(classifyMemoryPressure({ capacity: 0, availableCapacity: 0 }).level, 'unknown');

// Workspace size không bị đóng khung ở 3 tab. Budget chỉ điều tiết số generation đồng thời.
assert.equal(recommendedParallelGenerators('normal', 2, 1), 1);
assert.equal(recommendedParallelGenerators('normal', 2, 12), 2);
assert.equal(recommendedParallelGenerators('normal', 6, 12), 6);
assert.equal(recommendedParallelGenerators('normal', 99, 20), 8);
assert.equal(recommendedParallelGenerators('medium', 6, 12), 2);
assert.equal(recommendedParallelGenerators('high', 6, 12), 1);
assert.equal(recommendedParallelGenerators('critical', 8, 50), 1);
assert.equal(recommendedParallelGenerators('unknown', 8, 50), 2);

const now = 1_000_000;
assert.equal(shouldProtectFromDiscard({ state: 'generating', updatedAt: now }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'typing', updatedAt: now }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'idle', protectUntil: now + 1 }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'idle', protectUntil: now - 1 }, now), false);
assert.equal(shouldProtectFromDiscard(null, now), false);

assert.equal(
  isProductiveStateFresh({ state: 'generating', updatedAt: now - PRODUCTIVE_STATE_STALE_MS + 1 }, now),
  true
);
assert.equal(
  isProductiveStateFresh({ state: 'generating', updatedAt: now - PRODUCTIVE_STATE_STALE_MS - 1 }, now),
  false
);
assert.equal(
  shouldProtectFromDiscard({ state: 'generating', updatedAt: now - PRODUCTIVE_STATE_STALE_MS - 1 }, now),
  false
);
assert.equal(
  shouldProtectFromDiscard({
    state: 'generating',
    updatedAt: now - PRODUCTIVE_STATE_STALE_MS - 1,
    protectUntil: now + 1000
  }, now),
  true
);

assert.equal(deriveExecutionMode(
  { state: 'typing', visible: true, focused: true },
  { generatingCount: 8, parallelBudget: 1 }
), 'interactive');
assert.equal(deriveExecutionMode(
  { state: 'generating', visible: false, focused: false },
  { generatingCount: 1, parallelBudget: 6 }
), 'producer');
assert.equal(deriveExecutionMode(
  { state: 'generating', visible: false, focused: false },
  { generatingCount: 7, parallelBudget: 6 }
), 'strained');
assert.equal(deriveExecutionMode(
  { state: 'idle', visible: false, focused: false },
  { generatingCount: 1, parallelBudget: 2 }
), 'eco');
assert.equal(deriveExecutionMode(
  { state: 'idle', visible: true, focused: false },
  { generatingCount: 0, parallelBudget: 2 }
), 'interactive');

console.log('✅ runtime-policy.test.mjs passed');
