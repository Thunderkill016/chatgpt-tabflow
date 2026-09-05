import assert from 'node:assert/strict';
import {
  classifyMemoryPressure,
  deriveExecutionMode,
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

assert.equal(recommendedParallelGenerators('normal', 2), 2);
assert.equal(recommendedParallelGenerators('medium', 2), 2);
assert.equal(recommendedParallelGenerators('high', 2), 1);
assert.equal(recommendedParallelGenerators('critical', 2), 1);
assert.equal(recommendedParallelGenerators('normal', 99), 2);

const now = 1_000_000;
assert.equal(shouldProtectFromDiscard({ state: 'generating' }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'typing' }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'idle', protectUntil: now + 1 }, now), true);
assert.equal(shouldProtectFromDiscard({ state: 'idle', protectUntil: now - 1 }, now), false);
assert.equal(shouldProtectFromDiscard(null, now), false);

assert.equal(deriveExecutionMode({ state: 'typing', visible: true, focused: true }, { generatingCount: 2, parallelBudget: 1 }), 'interactive');
assert.equal(deriveExecutionMode({ state: 'generating', visible: false, focused: false }, { generatingCount: 1, parallelBudget: 2 }), 'producer');
assert.equal(deriveExecutionMode({ state: 'generating', visible: false, focused: false }, { generatingCount: 3, parallelBudget: 2 }), 'strained');
assert.equal(deriveExecutionMode({ state: 'idle', visible: false, focused: false }, { generatingCount: 1, parallelBudget: 2 }), 'eco');
assert.equal(deriveExecutionMode({ state: 'idle', visible: true, focused: false }, { generatingCount: 0, parallelBudget: 2 }), 'interactive');

console.log('✅ runtime-policy.test.mjs passed');
