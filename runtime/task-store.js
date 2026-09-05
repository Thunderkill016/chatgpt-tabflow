const TASKS_KEY = 'tabflowRuntimeTasksV3';
const MAX_TASKS = 120;
const MAX_PROMPT_CHARS = 64000;
const MAX_OUTPUT_CHARS = 70000;

let mutationTail = Promise.resolve();

function withMutation(task) {
  const current = mutationTail.catch(() => undefined).then(task);
  mutationTail = current.catch(() => undefined);
  return current;
}

function clip(value, max) {
  return String(value || '').replace(/\u0000/g, '').slice(0, max);
}

async function readAll() {
  const data = await chrome.storage.local.get(TASKS_KEY);
  return Array.isArray(data[TASKS_KEY]) ? data[TASKS_KEY] : [];
}

async function writeAll(tasks) {
  await chrome.storage.local.set({ [TASKS_KEY]: tasks.slice(-MAX_TASKS) });
}

function taskId() {
  const random = typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
  return `task_${Date.now()}_${random}`;
}

export async function createRuntimeTask(input = {}) {
  return withMutation(async () => {
    const tasks = await readAll();
    const now = Date.now();
    const record = {
      id: taskId(),
      pipelineId: clip(input.pipelineId || '', 200),
      projectId: clip(input.projectId || '', 200),
      projectName: clip(input.projectName || '', 240),
      stage: clip(input.stage || input.toRole || 'architect', 40),
      fromRole: clip(input.fromRole || 'user', 40),
      toRole: clip(input.toRole || 'architect', 40),
      fromTabId: Number.isInteger(input.fromTabId) ? input.fromTabId : null,
      toTabId: Number.isInteger(input.toTabId) ? input.toTabId : null,
      rootPrompt: clip(input.rootPrompt || '', MAX_PROMPT_CHARS),
      prompt: clip(input.prompt || '', MAX_PROMPT_CHARS),
      output: '',
      status: 'queued',
      error: '',
      autoAdvance: input.autoAdvance !== false,
      createdAt: now,
      updatedAt: now,
      startedAt: 0,
      completedAt: 0
    };
    tasks.push(record);
    await writeAll(tasks);
    return record;
  });
}

export async function updateRuntimeTask(id, patch = {}) {
  return withMutation(async () => {
    const tasks = await readAll();
    const index = tasks.findIndex(task => task.id === id);
    if (index < 0) return null;
    const previous = tasks[index];
    const next = {
      ...previous,
      ...patch,
      id: previous.id,
      pipelineId: previous.pipelineId,
      rootPrompt: previous.rootPrompt,
      prompt: patch.prompt === undefined ? previous.prompt : clip(patch.prompt, MAX_PROMPT_CHARS),
      output: patch.output === undefined ? previous.output : clip(patch.output, MAX_OUTPUT_CHARS),
      error: patch.error === undefined ? previous.error : clip(patch.error, 4000),
      updatedAt: Date.now()
    };
    tasks[index] = next;
    await writeAll(tasks);
    return next;
  });
}

export async function getRuntimeTask(id) {
  const tasks = await readAll();
  return tasks.find(task => task.id === id) || null;
}

export async function listRuntimeTasks({ projectId = '', pipelineId = '', limit = 40 } = {}) {
  let tasks = await readAll();
  if (projectId) tasks = tasks.filter(task => task.projectId === projectId);
  if (pipelineId) tasks = tasks.filter(task => task.pipelineId === pipelineId);
  tasks.sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  return tasks.slice(0, Math.max(1, Math.min(120, Number(limit || 40))));
}

export async function listQueuedTasksForTab(tabId) {
  const tasks = await readAll();
  return tasks
    .filter(task => task.toTabId === tabId && task.status === 'queued')
    .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));
}

export async function clearRuntimeTasks(projectId = '') {
  return withMutation(async () => {
    const tasks = await readAll();
    const next = projectId ? tasks.filter(task => task.projectId !== projectId) : [];
    await writeAll(next);
    return { removed: tasks.length - next.length };
  });
}
