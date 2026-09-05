const runtimeView = document.getElementById('runtime-view');
const runtimeNav = document.getElementById('tab-nav-runtime');
const projectSelect = document.getElementById('runtime-project-select');
const startButton = document.getElementById('runtime-start-btn');
const cooperativeToggle = document.getElementById('runtime-coop-toggle');
const parallelSelect = document.getElementById('runtime-parallel-select');
const pressureLabel = document.getElementById('runtime-pressure');
const pressureSub = document.getElementById('runtime-pressure-sub');
const generatorLabel = document.getElementById('runtime-generators');
const budgetSub = document.getElementById('runtime-budget-sub');
const agentsHost = document.getElementById('runtime-agents');
const liveSummary = document.getElementById('runtime-live-summary');
const quickCard = document.getElementById('runtime-quick-card');
const quickTitle = document.getElementById('runtime-quick-title');
const quickSub = document.getElementById('runtime-quick-sub');

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
  const previous = projectSelect?.value || '';
  if (!projectSelect) return projects;

  projectSelect.replaceChildren();
  const blank = document.createElement('option');
  blank.value = '';
  blank.textContent = projects.length ? 'Chọn project chung…' : 'Chưa có project trong Project Vault';
  projectSelect.appendChild(blank);

  for (const project of projects) {
    const option = document.createElement('option');
    option.value = project.id;
    option.textContent = project.name;
    projectSelect.appendChild(option);
  }

  if ([...projectSelect.options].some(option => option.value === previous)) {
    projectSelect.value = previous;
  }
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

function connectedCount(snapshot = {}) {
  return Object.values(snapshot.tabs || {}).filter(entry => entry?.connected).length;
}

function updateQuickCard(snapshot = {}, settings = {}, chromeTabs = []) {
  if (!quickTitle || !quickSub) return;
  const connected = connectedCount(snapshot);
  const total = chromeTabs.length;
  const generating = Number(snapshot.generatingCount || 0);
  const protectedCount = Number(snapshot.protectedCount || 0);
  const pressure = String(snapshot.memory?.level || 'unknown').toUpperCase();
  const projectName = settings.projectName || '';

  quickTitle.textContent = projectName
    ? `Adaptive Workspace · ${projectName}`
    : 'Adaptive Workspace · chưa gắn project';

  const connectionNote = connected < total ? ` · ${total - connected} chưa kết nối` : '';
  quickSub.textContent = `${total} tab mở · ${connected} runtime · ${generating} generating · ${protectedCount} protected · ${pressure}${connectionNote}`;
  quickCard?.classList.toggle('has-warning', connected < total || pressure === 'HIGH' || pressure === 'CRITICAL');
}

function renderTabs(snapshot, chromeTabs) {
  if (!agentsHost) return;
  const runtimeEntries = snapshot?.tabs || {};
  const tabs = chromeTabs.slice().sort((a, b) => {
    const score = tab => {
      const entry = runtimeEntries[String(tab.id)] || {};
      if (tab.active) return 5;
      if (entry.connected && entry.state === 'generating') return 4;
      if (entry.connected && entry.state === 'typing') return 3;
      if (!tab.discarded) return 2;
      return 1;
    };
    return score(b) - score(a) || Number(b.lastAccessed || 0) - Number(a.lastAccessed || 0);
  });

  agentsHost.replaceChildren();
  if (tabs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'runtime-empty';
    empty.textContent = 'Chưa có tab ChatGPT nào.';
    agentsHost.appendChild(empty);
    return;
  }

  for (const tab of tabs) {
    const entry = runtimeEntries[String(tab.id)] || null;
    const tracked = Boolean(entry?.connected);
    const modeName = tab.discarded ? 'sleeping' : (tracked ? (entry.mode || 'eco') : 'untracked');
    const stateName = tab.discarded ? 'sleeping' : (tracked ? (entry.state || 'idle') : 'untracked');

    const card = document.createElement('article');
    card.className = `runtime-agent-card mode-${modeName}`;

    const header = document.createElement('div');
    header.className = 'runtime-agent-head';
    const title = document.createElement('strong');
    title.textContent = (tab.title || 'ChatGPT').replace(/ - ChatGPT$/i, '');
    const mode = document.createElement('span');
    mode.className = `runtime-mode-pill ${modeName}`;
    mode.textContent = modeName;
    header.append(title, mode);

    const meta = document.createElement('div');
    meta.className = 'runtime-agent-meta';
    const pieces = [stateName];
    if (entry?.protectedFromDiscard) pieces.push('🛡 protected');
    if (entry?.projectName) pieces.push(entry.projectName);
    const heap = formatHeap(entry?.heapUsed);
    if (heap) pieces.push(heap);
    if (!tracked && !tab.discarded) pieces.push('reload tab để kết nối runtime');
    if (tab.discarded) pieces.push('💤 discarded');
    meta.textContent = pieces.join(' · ');

    const controls = document.createElement('div');
    controls.className = 'runtime-agent-controls runtime-agent-controls-single';
    const focus = document.createElement('button');
    focus.className = 'runtime-small-btn';
    focus.textContent = tab.discarded ? 'Mở & reload' : 'Mở tab';
    focus.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: tab.id }));
    controls.appendChild(focus);

    card.append(header, meta, controls);
    agentsHost.appendChild(card);
  }
}

async function refreshRuntime() {
  const [runtime, tabsData] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'RUNTIME_GET_STATE' }),
    chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' })
  ]);
  if (!runtime?.success || !tabsData?.success) return;

  const snapshot = runtime.snapshot || { tabs: {} };
  const settings = runtime.settings || {};
  const tabs = tabsData.tabs || [];
  updateQuickCard(snapshot, settings, tabs);

  if (!runtimeView || runtimeView.style.display === 'none') return;

  const pressure = pressureText(snapshot.memory);
  pressureLabel.textContent = pressure.label;
  pressureLabel.className = pressure.className;

  const available = Number(snapshot.memory?.availableCapacity || 0);
  const total = Number(snapshot.memory?.capacity || 0);
  pressureSub.textContent = total > 0
    ? `${(available / 1024 ** 3).toFixed(1)} / ${(total / 1024 ** 3).toFixed(1)} GB RAM còn trống`
    : 'Không đọc được physical memory';

  const generating = Number(snapshot.generatingCount || 0);
  const protectedCount = Number(snapshot.protectedCount || 0);
  generatorLabel.textContent = `${generating} generating · ${protectedCount} protected`;
  if (budgetSub) budgetSub.textContent = `Recommended budget: ${snapshot.parallelBudget || 1}`;

  cooperativeToggle.checked = settings.cooperativeEnabled !== false;
  parallelSelect.value = String(settings.maxParallelGenerators || 2);
  if (settings.projectId && [...projectSelect.options].some(option => option.value === settings.projectId)) {
    projectSelect.value = settings.projectId;
  }

  const connected = connectedCount(snapshot);
  if (liveSummary) liveSummary.textContent = `${tabs.length} mở · ${connected} runtime`;
  renderTabs(snapshot, tabs);
}

async function bindAllTabsToWorkspace() {
  const projectId = projectSelect.value;
  if (!projectId) {
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

    const tabs = (tabsData.tabs || []).filter(tab => Number.isInteger(tab.id));
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

    let bound = 0;
    let failed = 0;
    for (const tab of tabs) {
      try {
        await memoryRpc('BIND_PROJECT', { tabId: tab.id, tabUrl: tab.url, project });
        await chrome.runtime.sendMessage({
          type: 'RUNTIME_ASSIGN_ROLE',
          tabId: tab.id,
          role: 'unassigned',
          projectId: project.id,
          projectName: project.name
        });
        bound += 1;
      } catch {
        failed += 1;
      }
    }

    showRuntimeToast(failed > 0
      ? `Đã gắn ${bound}/${tabs.length} tab; ${failed} tab cần reload rồi thử lại.`
      : `Đã gắn toàn bộ ${bound} tab vào ${project.name}.`);
    await refreshRuntime();
  } catch (error) {
    showRuntimeToast(`Không bật được workspace: ${error.message}`);
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

  if (runtimeView) runtimeView.style.display = 'flex';
  loadProjects().then(refreshRuntime).catch(() => {});
}

function hideRuntimeView() {
  runtimeNav?.classList.remove('active');
  if (runtimeView) runtimeView.style.display = 'none';
}

runtimeNav?.addEventListener('click', showRuntimeView);
quickCard?.addEventListener('click', showRuntimeView);
for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects', 'tab-nav-memory']) {
  document.getElementById(id)?.addEventListener('click', hideRuntimeView);
}

startButton?.addEventListener('click', bindAllTabsToWorkspace);
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

loadProjects().then(refreshRuntime).catch(() => {});
refreshTimer = setInterval(() => refreshRuntime().catch(() => {}), 5000);
window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
