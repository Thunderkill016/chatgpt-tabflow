import { RUNTIME_STATES, shouldProtectFromDiscard } from './policy.js';

export const RUNTIME_SESSION_KEY = 'tabflowRuntimeStateV3';
const RUNTIME_PROBE_MESSAGE = 'TABFLOW_RUNTIME_PROBE';
const VALID_RUNTIME_STATES = new Set(Object.values(RUNTIME_STATES));

export async function readRuntimeSnapshot() {
  if (typeof chrome === 'undefined' || !chrome.storage?.session) return { tabs: {} };
  const data = await chrome.storage.session.get(RUNTIME_SESSION_KEY);
  const snapshot = data[RUNTIME_SESSION_KEY];
  if (!snapshot || typeof snapshot !== 'object') return { tabs: {} };
  return {
    ...snapshot,
    tabs: snapshot.tabs && typeof snapshot.tabs === 'object' ? snapshot.tabs : {}
  };
}

export async function getRuntimeTabEntry(tabId) {
  if (!Number.isInteger(tabId)) return null;
  const snapshot = await readRuntimeSnapshot();
  return snapshot.tabs[String(tabId)] || null;
}

async function probeRuntimeTab(tabId) {
  if (typeof chrome === 'undefined' || !chrome.tabs?.sendMessage) return null;
  try {
    const response = await chrome.tabs.sendMessage(tabId, { type: RUNTIME_PROBE_MESSAGE });
    const payload = response?.success ? response.payload : null;
    if (!payload || !VALID_RUNTIME_STATES.has(payload.state)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function canDiscardRuntimeTab(tabId, now = Date.now()) {
  const entry = await getRuntimeTabEntry(tabId);

  // Fail-safe: if this tab never reported runtime state, never infer idle.
  if (!entry) return false;

  // Destructive tab lifecycle decisions require a live renderer probe. Storage
  // is useful for coordination/UI, but can be stale after a service-worker
  // restart. If the content script cannot answer, the state is unknown and the
  // tab stays protected instead of being discarded on a stale idle snapshot.
  const live = await probeRuntimeTab(tabId);
  if (!live) return false;

  const reconciled = {
    ...entry,
    ...live,
    tabId,
    connected: true,
    updatedAt: now
  };
  return !shouldProtectFromDiscard(reconciled, now);
}
