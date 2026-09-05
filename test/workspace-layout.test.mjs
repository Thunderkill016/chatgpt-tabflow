import assert from 'node:assert/strict';
import { computeGrid, densityWarning } from '../workspace/layout.js';
import {
  DEFAULT_SPOTLIGHT_RATIO,
  MIN_SPOTLIGHT_RATIO,
  MAX_SPOTLIGHT_RATIO,
  spotlightMaxRatio,
  clampSpotlightRatio,
  spotlightRatioFromPointer,
  nudgeSpotlightRatio,
  spotlightRatioCss
} from '../workspace/spotlight-layout.js';

for (const count of [1, 2, 3, 4, 5, 8, 12, 20, 50]) {
  const grid = computeGrid(count, 1920, 1000, 'auto');
  assert.ok(grid.columns >= 1, `${count}: columns >= 1`);
  assert.ok(grid.rows >= 1, `${count}: rows >= 1`);
  assert.ok(grid.columns * grid.rows >= count, `${count}: grid contains every pane`);
  assert.ok(Number.isFinite(grid.paneWidth) && grid.paneWidth > 0, `${count}: pane width valid`);
  assert.ok(Number.isFinite(grid.paneHeight) && grid.paneHeight > 0, `${count}: pane height valid`);
  assert.ok(typeof grid.mode === 'string' && grid.mode.length > 0, `${count}: layout mode present`);
}

const threeAuto = computeGrid(3, 1920, 1000, 'auto');
assert.equal(threeAuto.mode, 'spotlight-3');
assert.equal(threeAuto.columns, 2);
assert.equal(threeAuto.rows, 2);
assert.ok(threeAuto.primaryWidth > threeAuto.paneWidth);

const threeOverview = computeGrid(3, 1920, 1000, 'overview');
assert.equal(threeOverview.mode, 'grid');

const forced = computeGrid(11, 1600, 900, '4');
assert.equal(forced.mode, 'grid');
assert.equal(forced.columns, 4);
assert.equal(forced.rows, 3);

const one = computeGrid(1, 1200, 800, 'overview');
assert.deepEqual(one, {
  mode: 'single',
  columns: 1,
  rows: 1,
  paneWidth: 1200,
  paneHeight: 800
});

assert.equal(densityWarning({ mode: 'grid', paneWidth: 700, paneHeight: 500 }), '');
assert.ok(densityWarning({ mode: 'grid', paneWidth: 250, paneHeight: 180 }).length > 0);
assert.ok(densityWarning(threeAuto).includes('Spotlight'));

assert.equal(clampSpotlightRatio(DEFAULT_SPOTLIGHT_RATIO, 1920), DEFAULT_SPOTLIGHT_RATIO);
assert.equal(clampSpotlightRatio(0.1, 1920), MIN_SPOTLIGHT_RATIO);
assert.equal(clampSpotlightRatio(0.99, 1920), MAX_SPOTLIGHT_RATIO);
assert.ok(spotlightMaxRatio(1080) < MAX_SPOTLIGHT_RATIO, 'narrow viewport preserves secondary minimum width');
assert.equal(clampSpotlightRatio(0.99, 1080), spotlightMaxRatio(1080));
assert.equal(spotlightRatioFromPointer(960, 1920), 0.5);
assert.equal(nudgeSpotlightRatio(0.64, 0.02, 1920), 0.66);
assert.equal(nudgeSpotlightRatio(0.49, -0.05, 1920), MIN_SPOTLIGHT_RATIO);
assert.equal(spotlightRatioCss(0.64, 1920), '64.00%');

console.log('✅ workspace-layout.test.mjs passed');
