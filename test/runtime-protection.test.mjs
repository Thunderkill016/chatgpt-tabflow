import assert from 'node:assert/strict';

let snapshot = { tabs: {} };
let probeResponse = null;
let probeError = null;
let probeCalls = 0;

globalThis.chrome = {
  storage: {
    session: {
      async get(key) {
        return { [key]: snapshot };
      }
    }
  },
  tabs: {
    async sendMessage(tabId, message) {
      probeCalls += 1;
      assert.equal(tabId, 7);
      assert.equal(message.type, 'TABFLOW_RUNTIME_PROBE');
      if (probeError) throw probeError;
      return probeResponse;
    }
  }
};

const { canDiscardRuntimeTab } = await import('../runtime/protection.js');
const now = 1_000_000;

function setEntry(entry) {
  snapshot = { tabs: entry ? { '7': { tabId: 7, ...entry } } : {} };
}

setEntry(null);
probeCalls = 0;
assert.equal(await canDiscardRuntimeTab(7, now), false, 'missing snapshot entry fails safe');
assert.equal(probeCalls, 0, 'missing entry does not probe an unknown renderer');

setEntry({ state: 'idle', updatedAt: now - 100_000 });
probeResponse = { success: true, payload: { state: 'idle', lastActivityAt: now } };
assert.equal(await canDiscardRuntimeTab(7, now), true, 'live idle renderer can be discarded');

probeResponse = { success: true, payload: { state: 'generating', lastActivityAt: now } };
assert.equal(await canDiscardRuntimeTab(7, now), false, 'live generating renderer is protected');

probeResponse = { success: true, payload: { state: 'typing', lastActivityAt: now } };
assert.equal(await canDiscardRuntimeTab(7, now), false, 'live typing renderer is protected');

setEntry({ state: 'generating', updatedAt: now - 100_000 });
probeResponse = { success: true, payload: { state: 'idle', lastActivityAt: now } };
assert.equal(await canDiscardRuntimeTab(7, now), true, 'live probe overrides stale productive snapshot');

setEntry({ state: 'idle', protectUntil: now + 5000, updatedAt: now - 100_000 });
probeResponse = { success: true, payload: { state: 'idle', lastActivityAt: now } };
assert.equal(await canDiscardRuntimeTab(7, now), false, 'explicit protection window survives live reconciliation');

setEntry({ state: 'idle', updatedAt: now });
probeResponse = { success: true, payload: { state: 'mystery' } };
assert.equal(await canDiscardRuntimeTab(7, now), false, 'invalid live state fails safe');

probeResponse = { success: false };
assert.equal(await canDiscardRuntimeTab(7, now), false, 'negative probe response fails safe');

probeError = new Error('receiver unavailable');
assert.equal(await canDiscardRuntimeTab(7, now), false, 'missing content script fails safe');
probeError = null;

delete globalThis.chrome;
console.log('✅ runtime-protection.test.mjs passed');
