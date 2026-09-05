import assert from 'node:assert/strict';
import { computeGrid, densityWarning } from '../workspace/layout.js';

for (const count of [1, 2, 3, 4, 5, 8, 12, 20, 50]) {
  const grid = computeGrid(count, 1920, 1000, 'auto');
  assert.ok(grid.columns >= 1, `${count}: columns >= 1`);
  assert.ok(grid.rows >= 1, `${count}: rows >= 1`);
  assert.ok(grid.columns * grid.rows >= count, `${count}: grid contains every pane`);
  assert.ok(Number.isFinite(grid.paneWidth) && grid.paneWidth > 0, `${count}: pane width valid`);
  assert.ok(Number.isFinite(grid.paneHeight) && grid.paneHeight > 0, `${count}: pane height valid`);
}

const forced = computeGrid(11, 1600, 900, '4');
assert.equal(forced.columns, 4);
assert.equal(forced.rows, 3);

const one = computeGrid(1, 1200, 800, 'overview');
assert.deepEqual(one, { columns: 1, rows: 1, paneWidth: 1200, paneHeight: 800 });

assert.equal(densityWarning({ paneWidth: 700, paneHeight: 500 }), '');
assert.ok(densityWarning({ paneWidth: 250, paneHeight: 180 }).length > 0);

console.log('✅ workspace-layout.test.mjs passed');
