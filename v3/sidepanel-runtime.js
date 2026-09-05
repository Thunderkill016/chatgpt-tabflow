const runtimeView = document.getElementById('runtime-view');
const runtimeNav = document.getElementById('tab-nav-runtime');
const projectSelect = document.getElementById('runtime-project-select');
const startButton = document.getElementById('runtime-start-btn');
const cooperativeToggle = document.getElementById('runtime-coop-toggle');
const parallelSelect = document.getElementById('runtime-parallel-select');
const pressureLabel = document.getElementById('runtime-pressure');
const pressureSub = document.getElementById('runtime-pressure-sub');
const generatorLabel = document.getElementById('runtime-generators');
const agentsHost = document.getElementById('runtime-agents');

const ROLE_ORDER = ['architect', 'implementer', 'reviewer'];
const ROLE_LABELS = {
  architect: '🏗 Architect',
  implementer: '💻 Implementer',
  reviewer: '🧪 Reviewer',
  unassigned: '— Chưa phân vai —'
};

let refreshTimer = null;
let memoryPort = null;
let memorySeq = 0;
const memoryPending = new Map();

function showRuntimeToast(message) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function connectMemory() {
  if (memoryPort) return memoryPort;
  const port = chrome.runtime.connect({ name: 'TABFLOW_MEMORY_CLIENT' });
  memoryPort = port;
  port.onMessage.addListener(message => {
    const pending = memoryPending.get(message?.requestId);
    if (!pending) return;
    memoryPending.delete(message.requestId);
    clearTimeout(pending.timer);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message?.error?.message || 'Memory RPC failed'));
  });
  port.onDisconnect.addListener(() => {
    if (memoryPort === port) memoryPort = null;
    for (const pending of memoryPending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('Memory port disconnected'));
    }
    memoryPending.clear();
  });
  return port;
}

function memoryRpc(type, payload = {}) {
  const port = connectMemory();
  const requestId = `runtime-ui-${Date.now()}-${++memorySeq}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      memoryPending.delete(requestId);
      reject(new Error(`Timeout: ${type}`));
    }, 20000);
    memoryPending.set(requestId, { resolve, reject, timer });
    port.postMessage({ requestId, type, payload });
  });
}

async function loadProjects() {
  const data = await chrome.storage.local.get('projectVault');
  const projects = Array.isArray(data.projectVault) ? data.projectVault : [];
  const previous = projectSelect.value;
  projectSelect.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = projects.length ? 'Chọn project chung…' : 'Chưa có project trong Project Vault';
  projectSelect.appendChild(blank);
  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    option.dataset.stack = project.stack || '';
    option.dataset.rules = project.rules || '';
    projectSelect.appendChild(option);
  }
  if ([...projectSelect.options].some(option => option.value === previous)) projectSelect.value = previous;
  return projects;
}

function pressureText(memory) {
  const level = memory?.level || 'unknown';
  const ratio = typeof memory?.ratio === 'number' ? Math.round(memory.ratio * 100) : null;
  return {
    label: `${level.toUpperCase()}${ratio === null ? '' : ` · ${ratio}% free`}`,
    className: `runtime-pressure ${level}`
  };
}

function formatHeap(bytes) {
  if (!(bytes > 0)) return '';
  return `${Math.round(bytes / 1024 / 1024)} MB JS heap`;
}

function roleSelect(entry) {
  const select = document.createElement('select');
  select.className = 'runtime-role-select';
  for (const role of ['unassigned', ...ROLE_ORDER]) {
    const option = document.createElement('option');
    option.value = role;
    option.textContent = ROLE_LABELS[role];
    option.selected = (entry.role || 'unassigned') === role;
    select.appendChild(option);
  }
  select.addEventListener('change', async () => {
    await chrome.runtime.sendMessage({
      type: 'RUNTIME_ASSIGN_ROLE',
      tabId: entry.tabId,
      role: select.value,
      projectId: entry.projectId || '',
      projectName: entry.projectName || ''
    });
    await refreshRuntime();
  });
  return select;
}

function renderAgents(snapshot, chromeTabs) {
  const runtimeEntries = snapshot?.tabs || {};
  const tabs = chromeTabs.slice().sort((a, b) => Number(b.active) - Number(a.active));
  agentsHost.replaceChildren();
  if (tabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'runtime-empty';
    empty.textContent = 'Chưa có tab ChatGPT nào.';
    agentsHost.appendChild(empty);
    return;
  }

  for (const tab of tabs) {
    const entry = runtimeEntries[String(tab.id)] || {
      tabId: tab.id,
      title: tab.title,
      state: tab.discarded ? 'sleeping' : 'idle',
      mode: tab.discarded ? 'sleeping' : 'eco',
      role: 'unassigned'
    };
    const card = document.createElement('article');
    card.className = `runtime-agent-card mode-${entry.mode || 'eco'}`;

    const header = document.createElement('div');
    header.className = 'runtime-agent-head';
    const title = document.createElement('strong');
    title.textContent = (tab.title || entry.title || 'ChatGPT').replace(/ - ChatGPT$/i, '');
    const mode = document.createElement('span');
    mode.className = `runtime-mode-pill ${entry.mode || 'eco'}`;
    mode.textContent = entry.mode || 'eco';
    header.append(title, mode);

    const meta = document.createElement('div');
    meta.className = 'runtime-agent-meta';
    const pieces = [entry.state || 'idle'];
    if (entry.projectName) pieces.push(entry.projectName);
    const heap = formatHeap(entry.heapUsed);
    if (heap) pieces.push(heap);
    if (tab.discarded) pieces.push('💤 discarded');
    meta.textContent = pieces.join(' · ');

    const controls = document.createElement('div');
    controls.className = 'runtime-agent-controls';
    controls.appendChild(roleSelect(entry));
    const focus = document.createElement('button');
    focus.className = 'runtime-small-btn';
    focus.textContent = 'Mở';
    focus.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: tab.id }));
    controls.appendChild(focus);

    card.append(header, meta, controls);
    agentsHost.appendChild(card);
  }
}

async function refreshRuntime() {
  if (!runtimeView || runtimeView.style.display === 'none') return;
  const [runtime, tabsData] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'RUNTIME_GET_STATE' }),
    chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' })
  ]);
  if (!runtime?.success || !tabsData?.success) return;

  const snapshot = runtime.snapshot || { tabs: {} };
  const settings = runtime.settings || {};
  const pressure = pressureText(snapshot.memory);
  pressureLabel.textContent = pressure.label;
  pressureLabel.className = pressure.className;
  const available = Number(snapshot.memory?.availableCapacity || 0);
  const total = Number(snapshot.memory?.capacity || 0);
  pressureSub.textContent = total > 0
    ? `${(available / 1024 ** 3).toFixed(1)} / ${(total / 1024 ** 3).toFixed(1)} GB RAM còn trống`
    : 'Không đọc được physical memory';
  generatorLabel.textContent = `${snapshot.generatingCount || 0} generating / budget ${snapshot.parallelBudget || 1}`;
  cooperativeToggle.checked = settings.cooperativeEnabled !== false;
  parallelSelect.value = String(settings.maxParallelGenerators || 2);
  if (settings.projectId && [...projectSelect.options].some(option => option.value === settings.projectId)) {
    projectSelect.value = settings.projectId;
  }
  renderAgents(snapshot, tabsData.tabs || []);
}

async function startCooperativeWorkspace() {
  const projectId = projectSelect.value;
  const option = projectSelect.selectedOptions[0];
  if (!projectId || !option) {
    showRuntimeToast('Hãy chọn project chung trước.');
    return;
  }

  startButton.disabled = true;
  try {
    const [projectsData, tabsData] = await Promise.all([
      chrome.storage.local.get('projectVault'),
      chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' })
    ]);
    const projects = Array.isArray(projectsData.projectVault) ? projectsData.projectVault : [];
    const project = projects.find(item => item.id === projectId);
    if (!project) throw new Error('Project không còn tồn tại');
    const tabs = (tabsData.tabs || []).slice().sort((a, b) => Number(b.active) - Number(a.active)).slice(0, 3);
    if (tabs.length === 0) throw new Error('Không có tab ChatGPT');

    await chrome.runtime.sendMessage({
      type: 'RUNTIME_SET_SETTINGS',
      settings: {
        cooperativeEnabled: true,
        maxParallelGenerators: Number(parallelSelect.value || 2),
        projectId: project.id,
        projectName: project.name
      }
    });

    for (let i = 0; i < tabs.length; i += 1) {
      const tab = tabs[i];
      await memoryRpc('BIND_PROJECT', { tabId: tab.id, tabUrl: tab.url, project });
      await chrome.runtime.sendMessage({
        type: 'RUNTIME_ASSIGN_ROLE',
        tabId: tab.id,
        role: ROLE_ORDER[i] || 'unassigned',
        projectId: project.id,
        projectName: project.name
      });
    }
    showRuntimeToast(`Co-op: ${tabs.length} tab đã dùng chung ${project.name}`);
    await refreshRuntime();
  } catch (error) {
    showRuntimeToast(`Không bật được Co-op: ${error.message}`);
  } finally {
    startButton.disabled = false;
  }
}

function showRuntimeView() {
  for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects', 'tab-nav-memory']) {
    document.getElementById(id)?.classList.remove('active');
  }
  runtimeNav?.classList.add('active');
  for (const id of ['active-tabs-view', 'stashed-sessions-view', 'projects-vault-view', 'memory-view', 'search-section']) {
    const node = document.getElementById(id);
    if (node) node.style.display = 'none';
  }
  runtimeView.style.display = 'flex';
  loadProjects().then(refreshRuntime).catch(() => {});
}

function hideRuntimeView() {
  runtimeNav?.classList.remove('active');
  if (runtimeView) runtimeView.style.display = 'none';
}

runtimeNav?.addEventListener('click', showRuntimeView);
for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects', 'tab-nav-memory']) {
  document.getElementById(id)?.addEventListener('click', hideRuntimeView);
}

startButton?.addEventListener('click', startCooperativeWorkspace);
cooperativeToggle?.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'RUNTIME_SET_SETTINGS',
    settings: { cooperativeEnabled: cooperativeToggle.checked }
  });
  await refreshRuntime();
});
parallelSelect?.addEventListener('change', async () => {
  await chrome.runtime.sendMessage({
    type: 'RUNTIME_SET_SETTINGS',
    settings: { maxParallelGenerators: Number(parallelSelect.value || 2) }
  });
  await refreshRuntime();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRuntime().catch(() => {});
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.projectVault) loadProjects().catch(() => {});
});

loadProjects().catch(() => {});
refreshTimer = setInterval(() => refreshRuntime().catch(() => {}), 2500);
window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
