import {
  classifyMemoryPressure,
  deriveExecutionMode,
  normalizeRole,
  recommendedParallelGenerators,
  RUNTIME_STATES
} from './policy.js';
import { RUNTIME_SESSION_KEY } from './protection.js';

const PORT_NAME = 'TABFLOW_RUNTIME_CLIENT';
const SETTINGS_KEY = 'tabflowRuntimeSettingsV3';
const DEFAULT_SETTINGS = Object.freeze({
  cooperativeEnabled: true,
  maxParallelGenerators: 2,
  projectId: '',
  projectName: ''
});

const portsByTab = new Map();
let memorySample = { level: 'unknown', ratio: null, capacity: 0, availableCapacity: 0, sampledAt: 0 };
let memorySamplePromise = null;
let mutationTail = Promise.resolve();

async function loadSettings() {
  const data = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(data[SETTINGS_KEY] || {}) };
}

async function saveSettings(patch) {
  const current = await loadSettings();
  const next = {
    ...current,
    ...patch,
    cooperativeEnabled: patch.cooperativeEnabled === undefined ? current.cooperativeEnabled : Boolean(patch.cooperativeEnabled),
    maxParallelGenerators: Math.max(1, Math.min(2, Number(patch.maxParallelGenerators ?? current.maxParallelGenerators ?? 2)))
  };
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  await recomputeAndBroadcast();
  return next;
}

async function readSnapshot() {
  const data = await chrome.storage.session.get(RUNTIME_SESSION_KEY);
  const raw = data[RUNTIME_SESSION_KEY];
  return raw && typeof raw === 'object'
    ? { ...raw, tabs: raw.tabs && typeof raw.tabs === 'object' ? raw.tabs : {} }
    : { tabs: {} };
}

async function writeSnapshot(snapshot) {
  await chrome.storage.session.set({ [RUNTIME_SESSION_KEY]: snapshot });
}

function withMutation(task) {
  const current = mutationTail.catch(() => undefined).then(task);
  mutationTail = current.catch(() => undefined);
  return current;
}

function sanitizeEntry(tabId, previous = {}, patch = {}) {
  const state = Object.values(RUNTIME_STATES).includes(patch.state) ? patch.state : (previous.state || RUNTIME_STATES.IDLE);
  return {
    tabId,
    title: String(patch.title ?? previous.title ?? 'ChatGPT').slice(0, 500),
    url: String(patch.url ?? previous.url ?? '').slice(0, 4000),
    conversationId: String(patch.conversationId ?? previous.conversationId ?? '').slice(0, 500),
    state,
    visible: patch.visible === undefined ? Boolean(previous.visible) : Boolean(patch.visible),
    focused: patch.focused === undefined ? Boolean(previous.focused) : Boolean(patch.focused),
    role: normalizeRole(patch.role ?? previous.role),
    projectId: String(patch.projectId ?? previous.projectId ?? '').slice(0, 200),
    projectName: String(patch.projectName ?? previous.projectName ?? '').slice(0, 240),
    heapUsed: Number(patch.heapUsed ?? previous.heapUsed ?? 0) || 0,
    lastActivityAt: Number(patch.lastActivityAt ?? previous.lastActivityAt ?? Date.now()) || Date.now(),
    protectUntil: Math.max(Number(previous.protectUntil || 0), Number(patch.protectUntil || 0)),
    updatedAt: Date.now(),
    mode: previous.mode || 'eco'
  };
}

async function sampleMemory(force = false) {
  const now = Date.now();
  if (!force && now - memorySample.sampledAt < 5000) return memorySample;
  if (memorySamplePromise) return memorySamplePromise;
  memorySamplePromise = (async () => {
    try {
      if (!chrome.system?.memory?.getInfo) return memorySample;
      const info = await chrome.system.memory.getInfo();
      const pressure = classifyMemoryPressure(info);
      memorySample = {
        level: pressure.level,
        ratio: pressure.ratio,
        capacity: Number(info.capacity || 0),
        availableCapacity: Number(info.availableCapacity || 0),
        sampledAt: Date.now()
      };
    } catch (error) {
      console.warn('[TabFlow Runtime] system.memory sample failed:', error?.message || error);
    } finally {
      memorySamplePromise = null;
    }
    return memorySample;
  })();
  return memorySamplePromise;
}

async function mutateTab(tabId, patch) {
  return withMutation(async () => {
    const snapshot = await readSnapshot();
    const previous = snapshot.tabs[String(tabId)] || {};
    const next = sanitizeEntry(tabId, previous, patch);
    snapshot.tabs[String(tabId)] = next;
    snapshot.updatedAt = Date.now();
    await writeSnapshot(snapshot);
    return next;
  });
}

async function removeTab(tabId) {
  return withMutation(async () => {
    const snapshot = await readSnapshot();
    if (!Object.hasOwn(snapshot.tabs, String(tabId))) return;
    delete snapshot.tabs[String(tabId)];
    snapshot.updatedAt = Date.now();
    await writeSnapshot(snapshot);
  });
}

function postToTab(tabId, message) {
  const port = portsByTab.get(tabId);
  if (!port) return;
  try {
    port.postMessage(message);
  } catch {}
}

async function recomputeAndBroadcast() {
  await mutationTail.catch(() => undefined);
  const [snapshot, settings, pressure] = await Promise.all([
    readSnapshot(),
    loadSettings(),
    sampleMemory()
  ]);

  const entries = Object.values(snapshot.tabs || {});
  const generatingCount = entries.filter(entry => entry.state === RUNTIME_STATES.GENERATING).length;
  const parallelBudget = settings.cooperativeEnabled
    ? recommendedParallelGenerators(pressure.level, settings.maxParallelGenerators)
    : 2;

  for (const entry of entries) {
    const mode = settings.cooperativeEnabled
      ? deriveExecutionMode(entry, { generatingCount, parallelBudget })
      : (entry.focused || entry.visible ? 'interactive' : 'producer');
    entry.mode = mode;
    postToTab(entry.tabId, {
      type: 'RUNTIME_MODE',
      mode,
      pressure: pressure.level,
      parallelBudget,
      generatingCount,
      cooperativeEnabled: settings.cooperativeEnabled
    });
  }

  snapshot.tabs = Object.fromEntries(entries.map(entry => [String(entry.tabId), entry]));
  snapshot.memory = pressure;
  snapshot.parallelBudget = parallelBudget;
  snapshot.generatingCount = generatingCount;
  snapshot.cooperativeEnabled = settings.cooperativeEnabled;
  snapshot.updatedAt = Date.now();
  await writeSnapshot(snapshot);
  return { snapshot, settings };
}

async function handlePortMessage(port, message) {
  const tabId = port.sender?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  const type = message?.type;
  if (type === 'HELLO' || type === 'STATUS') {
    await mutateTab(tabId, message.payload || {});
    await recomputeAndBroadcast();
  } else if (type === 'SUBMIT_INTENT') {
    await mutateTab(tabId, {
      ...(message.payload || {}),
      state: RUNTIME_STATES.GENERATING,
      protectUntil: Date.now() + 45000,
      lastActivityAt: Date.now()
    });
    await recomputeAndBroadcast();
  }
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== PORT_NAME) return;
  const tabId = port.sender?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  portsByTab.set(tabId, port);
  port.onMessage.addListener(message => {
    handlePortMessage(port, message).catch(error => console.warn('[TabFlow Runtime] Port message failed:', error));
  });
  port.onDisconnect.addListener(() => {
    if (portsByTab.get(tabId) === port) portsByTab.delete(tabId);
  });
});

chrome.tabs.onRemoved.addListener(tabId => {
  portsByTab.delete(tabId);
  removeTab(tabId).catch(() => {});
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== 'tabflow-auto-check') return;
  sampleMemory(true).then(() => recomputeAndBroadcast()).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message?.type?.startsWith('RUNTIME_')) return false;
  (async () => {
    try {
      if (message.type === 'RUNTIME_GET_STATE') {
        const result = await recomputeAndBroadcast();
        sendResponse({ success: true, snapshot: result.snapshot, settings: result.settings });
        return;
      }
      if (message.type === 'RUNTIME_SET_SETTINGS') {
        const settings = await saveSettings(message.settings || {});
        sendResponse({ success: true, settings });
        return;
      }
      if (message.type === 'RUNTIME_ASSIGN_ROLE') {
        if (!Number.isInteger(message.tabId)) throw new Error('Missing tabId');
        const entry = await mutateTab(message.tabId, {
          role: normalizeRole(message.role),
          projectId: message.projectId || '',
          projectName: message.projectName || ''
        });
        await recomputeAndBroadcast();
        sendResponse({ success: true, entry });
        return;
      }
      sendResponse({ success: false, error: `Unknown runtime message: ${message.type}` });
    } catch (error) {
      sendResponse({ success: false, error: error?.message || String(error) });
    }
  })();
  return true;
});

sampleMemory(true).then(() => recomputeAndBroadcast()).catch(() => {});
