import { shouldProtectFromDiscard } from './policy.js';

export const RUNTIME_SESSION_KEY = 'tabflowRuntimeStateV3';

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

export async function canDiscardRuntimeTab(tabId, now = Date.now()) {
  const entry = await getRuntimeTabEntry(tabId);
  return !shouldProtectFromDiscard(entry, now);
}
