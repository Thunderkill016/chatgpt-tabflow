import {
  classifyMemoryPressure,
  deriveExecutionMode,
  normalizeRole,
  recommendedParallelGenerators,
  RUNTIME_STATES
} from './policy.js';
import { RUNTIME_SESSION_KEY } from './protection.js';
import { buildStagePrompt, nextPipelineRole } from './pipeline.js';
import {
  clearRuntimeTasks,
  createRuntimeTask,
  getRuntimeTask,
  listQueuedTasksForTab,
  listRuntimeTasks,
  updateRuntimeTask
} from './task-store.js';

const PORT_NAME = 'TABFLOW_RUNTIME_CLIENT';
const SETTINGS_KEY = 'tabflowRuntimeSettingsV3';
const DEFAULT_SETTINGS = Object.freeze({
  cooperativeEnabled: true,
  maxParallelGenerators: 2,
  projectId: '',
  projectName: ''
});

const portsByTab = new Map();
const discardabilityByTab = new Map();
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
    currentTaskId: String(patch.currentTaskId ?? previous.currentTaskId ?? '').slice(0, 240),
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
  if (!port) return false;
  try {
    port.postMessage(message);
    return true;
  } catch {
    return false;
  }
}

async function syncAutoDiscardable(entry) {
  if (!Number.isInteger(entry?.tabId)) return;
  const productive = entry.state === RUNTIME_STATES.GENERATING || entry.state === RUNTIME_STATES.TYPING;
  const desired = !productive;
  if (discardabilityByTab.get(entry.tabId) === desired) return;
  try {
    await chrome.tabs.update(entry.tabId, { autoDiscardable: desired });
    discardabilityByTab.set(entry.tabId, desired);
  } catch {}
}

async function recomputeAndBroadcast() {
  return withMutation(async () => {
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
      syncAutoDiscardable(entry).catch(() => {});
    }

    snapshot.tabs = Object.fromEntries(entries.map(entry => [String(entry.tabId), entry]));
    snapshot.memory = pressure;
    snapshot.parallelBudget = parallelBudget;
    snapshot.generatingCount = generatingCount;
    snapshot.cooperativeEnabled = settings.cooperativeEnabled;
    snapshot.updatedAt = Date.now();
    await writeSnapshot(snapshot);
    return { snapshot, settings };
  });
}

function findRoleEntry(snapshot, role, projectId) {
  return Object.values(snapshot?.tabs || {}).find(entry =>
    entry.role === role && (!projectId || entry.projectId === projectId)
  ) || null;
}

function pipelineId() {
  const suffix = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `pipeline_${Date.now()}_${suffix}`;
}

async function deliverTask(task) {
  if (!task || !Number.isInteger(task.toTabId)) return false;
  await mutationTail.catch(() => undefined);
  const snapshot = await readSnapshot();
  const entry = snapshot.tabs[String(task.toTabId)];
  if (!entry || entry.state === RUNTIME_STATES.GENERATING || entry.state === RUNTIME_STATES.TYPING) return false;
  if (!portsByTab.has(task.toTabId)) return false;

  try {
    await chrome.tabs.update(task.toTabId, { autoDiscardable: false });
    discardabilityByTab.set(task.toTabId, false);
  } catch {}

  const delivered = await updateRuntimeTask(task.id, {
    status: 'delivered',
    startedAt: Date.now(),
    error: ''
  });
  if (!delivered) return false;

  const posted = postToTab(task.toTabId, {
    type: 'RUNTIME_TASK',
    task: {
      id: delivered.id,
      pipelineId: delivered.pipelineId,
      projectId: delivered.projectId,
      projectName: delivered.projectName,
      stage: delivered.stage,
      toRole: delivered.toRole,
      prompt: delivered.prompt
    }
  });

  if (!posted) {
    await updateRuntimeTask(task.id, { status: 'queued', startedAt: 0, error: 'Target tab disconnected before delivery' });
    return false;
  }
  return true;
}

async function drainQueuedTasksForTab(tabId) {
  const snapshot = await readSnapshot();
  const entry = snapshot.tabs[String(tabId)];
  if (!entry || entry.state === RUNTIME_STATES.GENERATING || entry.state === RUNTIME_STATES.TYPING) return;
  const queued = await listQueuedTasksForTab(tabId);
  if (queued.length > 0) await deliverTask(queued[0]);
}

async function startPipeline({ prompt, projectId, projectName }) {
  const rootPrompt = String(prompt || '').trim();
  if (rootPrompt.length < 5) throw new Error('Nhiệm vụ pipeline quá ngắn');
  if (rootPrompt.length > 50000) throw new Error('Nhiệm vụ pipeline vượt 50.000 ký tự');

  const settings = await loadSettings();
  const targetProjectId = String(projectId || settings.projectId || '');
  const targetProjectName = String(projectName || settings.projectName || '');
  if (!targetProjectId) throw new Error('Chưa chọn project chung cho Co-op');

  const snapshot = await readSnapshot();
  const architect = findRoleEntry(snapshot, 'architect', targetProjectId);
  if (!architect) throw new Error('Chưa có tab Architect trong project này');

  const id = pipelineId();
  const task = await createRuntimeTask({
    pipelineId: id,
    projectId: targetProjectId,
    projectName: targetProjectName,
    stage: 'architect',
    fromRole: 'user',
    toRole: 'architect',
    toTabId: architect.tabId,
    rootPrompt,
    prompt: buildStagePrompt({
      role: 'architect',
      rootPrompt,
      projectName: targetProjectName
    }),
    autoAdvance: true
  });
  const delivered = await deliverTask(task);
  return { pipelineId: id, task: await getRuntimeTask(task.id), delivered };
}

async function advancePipeline(completedTask) {
  if (!completedTask?.autoAdvance) return null;
  const nextRole = nextPipelineRole(completedTask.toRole);
  if (!nextRole) return null;

  const snapshot = await readSnapshot();
  const target = findRoleEntry(snapshot, nextRole, completedTask.projectId);
  const pipelineTasks = await listRuntimeTasks({ pipelineId: completedTask.pipelineId, limit: 20 });
  const architectTask = pipelineTasks.find(task => task.toRole === 'architect' && task.status === 'completed');
  const implementerTask = pipelineTasks.find(task => task.toRole === 'implementer' && task.status === 'completed');

  const nextTask = await createRuntimeTask({
    pipelineId: completedTask.pipelineId,
    projectId: completedTask.projectId,
    projectName: completedTask.projectName,
    stage: nextRole,
    fromRole: completedTask.toRole,
    toRole: nextRole,
    fromTabId: completedTask.toTabId,
    toTabId: target?.tabId ?? null,
    rootPrompt: completedTask.rootPrompt,
    prompt: buildStagePrompt({
      role: nextRole,
      rootPrompt: completedTask.rootPrompt,
      projectName: completedTask.projectName,
      architectOutput: architectTask?.output || (completedTask.toRole === 'architect' ? completedTask.output : ''),
      implementerOutput: implementerTask?.output || (completedTask.toRole === 'implementer' ? completedTask.output : '')
    }),
    autoAdvance: true
  });

  if (!target) {
    return updateRuntimeTask(nextTask.id, {
      status: 'failed',
      completedAt: Date.now(),
      error: `Không tìm thấy tab ${nextRole} trong project`
    });
  }
  await deliverTask(nextTask);
  return getRuntimeTask(nextTask.id);
}

async function handleTaskComplete(tabId, message) {
  const taskId = String(message?.taskId || '');
  if (!taskId) return;
  const task = await getRuntimeTask(taskId);
  if (!task || task.toTabId !== tabId) return;

  const completed = await updateRuntimeTask(taskId, {
    status: 'completed',
    output: String(message.output || ''),
    completedAt: Date.now(),
    error: ''
  });
  await mutateTab(tabId, {
    currentTaskId: '',
    state: documentStateAfterTask(message),
    protectUntil: 0,
    lastActivityAt: Date.now()
  });
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    discardabilityByTab.set(tabId, true);
  } catch {}
  await recomputeAndBroadcast();
  if (completed) await advancePipeline(completed);
}

function documentStateAfterTask(message) {
  return message?.focused ? RUNTIME_STATES.INTERACTIVE : RUNTIME_STATES.IDLE;
}

async function handleTaskFailure(tabId, message) {
  const taskId = String(message?.taskId || '');
  if (!taskId) return;
  const task = await getRuntimeTask(taskId);
  if (!task || task.toTabId !== tabId) return;
  await updateRuntimeTask(taskId, {
    status: 'failed',
    error: String(message.error || 'Target tab failed to execute task'),
    completedAt: Date.now()
  });
  await mutateTab(tabId, { currentTaskId: '', protectUntil: 0 });
  try {
    await chrome.tabs.update(tabId, { autoDiscardable: true });
    discardabilityByTab.set(tabId, true);
  } catch {}
  await recomputeAndBroadcast();
}

async function handlePortMessage(port, message) {
  const tabId = port.sender?.tab?.id;
  if (!Number.isInteger(tabId)) return;
  const type = message?.type;

  if (type === 'HELLO' || type === 'STATUS') {
    const entry = await mutateTab(tabId, message.payload || {});
    await recomputeAndBroadcast();
    if (entry.state !== RUNTIME_STATES.GENERATING && entry.state !== RUNTIME_STATES.TYPING) {
      await drainQueuedTasksForTab(tabId);
    }
    return;
  }

  if (type === 'SUBMIT_INTENT') {
    await mutateTab(tabId, {
      ...(message.payload || {}),
      state: RUNTIME_STATES.GENERATING,
      protectUntil: Date.now() + 45000,
      lastActivityAt: Date.now()
    });
    await recomputeAndBroadcast();
    return;
  }

  if (type === 'TASK_ACK') {
    const taskId = String(message.taskId || '');
    if (taskId) {
      await updateRuntimeTask(taskId, { status: 'running', startedAt: Date.now(), error: '' });
      await mutateTab(tabId, { currentTaskId: taskId, protectUntil: Date.now() + 45000 });
      await recomputeAndBroadcast();
    }
    return;
  }

  if (type === 'TASK_COMPLETE') {
    await handleTaskComplete(tabId, message);
    return;
  }

  if (type === 'TASK_FAILED') {
    await handleTaskFailure(tabId, message);
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
  setTimeout(() => drainQueuedTasksForTab(tabId).catch(() => {}), 300);
});

chrome.tabs.onRemoved.addListener(tabId => {
  portsByTab.delete(tabId);
  discardabilityByTab.delete(tabId);
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
        const tasks = await listRuntimeTasks({ projectId: result.settings.projectId || '', limit: 24 });
        sendResponse({ success: true, snapshot: result.snapshot, settings: result.settings, tasks });
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
      if (message.type === 'RUNTIME_START_PIPELINE') {
        const result = await startPipeline({
          prompt: message.prompt,
          projectId: message.projectId,
          projectName: message.projectName
        });
        sendResponse({ success: true, ...result });
        return;
      }
      if (message.type === 'RUNTIME_GET_TASKS') {
        const tasks = await listRuntimeTasks({
          projectId: message.projectId || '',
          pipelineId: message.pipelineId || '',
          limit: message.limit || 40
        });
        sendResponse({ success: true, tasks });
        return;
      }
      if (message.type === 'RUNTIME_CLEAR_TASKS') {
        const result = await clearRuntimeTasks(message.projectId || '');
        sendResponse({ success: true, ...result });
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
