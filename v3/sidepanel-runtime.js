const runtimeView = document.getElementById('runtime-view');
const runtimeNav = document.getElementById('tab-nav-runtime');
const projectSelect = document.getElementById('runtime-project-select');
const startButton = document.getElementById('runtime-start-btn');
const cooperativeToggle = document.getElementById('runtime-coop-toggle');
const autoSleepToggle = document.getElementById('runtime-auto-sleep-toggle');
const idleMinutesSelect = document.getElementById('runtime-idle-minutes');
const parallelSelect = document.getElementById('runtime-parallel-select');
const optimizeButton = document.getElementById('runtime-optimize-btn');
const pressureLabel = document.getElementById('runtime-pressure');
const pressureSub = document.getElementById('runtime-pressure-sub');
const generatorLabel = document.getElementById('runtime-generators');
const budgetSub = document.getElementById('runtime-budget-sub');
const agentsHost = document.getElementById('runtime-agents');
const liveSummary = document.getElementById('runtime-live-summary');
const systemSummary = document.getElementById('runtime-system-summary');
const openCount = document.getElementById('runtime-open-count');
const generatingCount = document.getElementById('runtime-generating-count');
const idleCount = document.getElementById('runtime-idle-count');
const sleepingCount = document.getElementById('runtime-sleeping-count');

let refreshTimer = null;
let memoryPort = null;
let memorySeq = 0;
const memoryPending = new Map();

function showRuntimeToast(message, tone = 'info') {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.dataset.tone = tone;
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
  blank.textContent = projects.length ? 'Chọn project chung…' : 'Chưa có project';
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

function connectedCount(snapshot = {}) {
  return Object.values(snapshot.tabs || {}).filter(entry => entry?.connected).length;
}

function pressureDescriptor(level = 'unknown') {
  const descriptors = {
    normal: {
      label: 'Bình thường',
      detail: 'Tài nguyên hệ thống ổn định. Runtime không cần giảm tải.'
    },
    medium: {
      label: 'Đang tiết kiệm',
      detail: 'Runtime đang giảm hoạt động nền để giữ trải nghiệm ổn định.'
    },
    high: {
      label: 'Hệ thống căng',
      detail: 'Runtime đang hạn chế tải nền và giảm mức trả lời song song.'
    },
    critical: {
      label: 'Rất căng',
      detail: 'Runtime ưu tiên chat đang làm việc và giảm mạnh hoạt động nền.'
    },
    unknown: {
      label: 'Đang đọc',
      detail: 'Chưa có đủ dữ liệu để đánh giá tài nguyên hệ thống.'
    }
  };
  return descriptors[level] || descriptors.unknown;
}

function relativeActivity(timestamp) {
  const value = Number(timestamp || 0);
  if (!value) return '';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 45) return 'vừa hoạt động';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.round(minutes / 60);
  return `${hours} giờ trước`;
}

function friendlyTabState(tab, entry) {
  if (tab.discarded) return { label: 'Đang ngủ', className: 'sleeping' };
  if (!entry?.connected) return { label: 'Chưa kết nối', className: 'untracked' };
  if (entry.state === 'generating') return { label: 'Đang trả lời', className: 'generating' };
  if (entry.state === 'typing') return { label: 'Đang gõ', className: 'typing' };
  if (tab.active || entry.focused || entry.visible) return { label: 'Đang dùng', className: 'active' };
  return { label: 'Nhàn rỗi', className: 'idle' };
}

function renderTabs(snapshot, chromeTabs) {
  if (!agentsHost) return;
  const runtimeEntries = snapshot?.tabs || {};
  const tabs = chromeTabs.slice().sort((a, b) => {
    const score = tab => {
      const entry = runtimeEntries[String(tab.id)] || {};
      if (tab.active) return 6;
      if (entry.connected && entry.state === 'generating') return 5;
      if (entry.connected && entry.state === 'typing') return 4;
      if (entry.protectedFromDiscard) return 3;
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
    const state = friendlyTabState(tab, entry);

    const card = document.createElement('article');
    card.className = `runtime-agent-card state-${state.className}`;

    const copy = document.createElement('div');
    copy.className = 'runtime-agent-copy';

    const header = document.createElement('div');
    header.className = 'runtime-agent-head';
    const title = document.createElement('strong');
    title.textContent = (tab.title || 'ChatGPT').replace(/ - ChatGPT$/i, '');
    title.title = title.textContent;
    const status = document.createElement('span');
    status.className = `runtime-state-pill ${state.className}`;
    status.textContent = state.label;
    header.append(title, status);

    const meta = document.createElement('div');
    meta.className = 'runtime-agent-meta';
    const pieces = [];
    if (entry?.projectName) pieces.push(entry.projectName);
    if (entry?.protectedFromDiscard) pieces.push('được bảo vệ');
    const activity = relativeActivity(entry?.lastActivityAt || tab.lastAccessed);
    if (activity) pieces.push(activity);
    if (!entry?.connected && !tab.discarded) pieces.push('reload để Runtime theo dõi');
    if (tab.discarded) pieces.push('sẽ tự tải lại khi mở');
    meta.textContent = pieces.join(' · ') || 'Sẵn sàng';
    copy.append(header, meta);

    const controls = document.createElement('div');
    controls.className = 'runtime-agent-controls';

    const focus = document.createElement('button');
    focus.className = 'runtime-small-btn';
    focus.type = 'button';
    focus.textContent = tab.discarded ? 'Mở lại' : 'Mở';
    focus.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ type: 'ACTIVATE_TAB', tabId: tab.id });
      await refreshRuntime();
    });
    controls.appendChild(focus);

    if (!tab.discarded && !tab.active && entry?.connected && entry.state === 'idle' && !entry.protectedFromDiscard) {
      const sleep = document.createElement('button');
      sleep.className = 'runtime-small-btn';
      sleep.type = 'button';
      sleep.textContent = 'Cho ngủ';
      sleep.addEventListener('click', async () => {
        sleep.disabled = true;
        const result = await chrome.runtime.sendMessage({ type: 'DISCARD_TAB', tabId: tab.id });
        showRuntimeToast(
          result?.success ? 'Đã cho chat nhàn rỗi ngủ.' : 'Chat vừa hoạt động hoặc đang được bảo vệ.',
          result?.success ? 'success' : 'warning'
        );
        await refreshRuntime();
      });
      controls.appendChild(sleep);
    }

    if (!tab.discarded && !entry?.connected) {
      const reload = document.createElement('button');
      reload.className = 'runtime-small-btn';
      reload.type = 'button';
      reload.textContent = 'Reload';
      reload.addEventListener('click', async () => {
        reload.disabled = true;
        try {
          await chrome.tabs.reload(tab.id);
          showRuntimeToast('Đã reload chat để kết nối Runtime.', 'success');
        } finally {
          setTimeout(() => refreshRuntime().catch(() => {}), 1200);
        }
      });
      controls.appendChild(reload);
    }

    card.append(copy, controls);
    agentsHost.appendChild(card);
  }
}

function applyRuntimeControls(runtimeSettings = {}, lifecycleSettings = {}) {
  if (cooperativeToggle) cooperativeToggle.checked = runtimeSettings.cooperativeEnabled !== false;
  if (parallelSelect) parallelSelect.value = String(runtimeSettings.maxParallelGenerators || 2);
  if (autoSleepToggle) autoSleepToggle.checked = lifecycleSettings.autoDiscardEnabled !== false;
  if (idleMinutesSelect) {
    const minutes = String(Math.max(1, Number(lifecycleSettings.discardIdleMinutes || 5)));
    if ([...idleMinutesSelect.options].some(option => option.value === minutes)) {
      idleMinutesSelect.value = minutes;
    }
    idleMinutesSelect.disabled = lifecycleSettings.autoDiscardEnabled === false;
  }
  if (runtimeSettings.projectId && projectSelect && [...projectSelect.options].some(option => option.value === runtimeSettings.projectId)) {
    projectSelect.value = runtimeSettings.projectId;
  }
}

async function refreshRuntime() {
  const [runtime, tabsData, lifecycle] = await Promise.all([
    chrome.runtime.sendMessage({ type: 'RUNTIME_GET_STATE' }),
    chrome.runtime.sendMessage({ type: 'GET_TABS_DATA' }),
    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
  ]);
  if (!runtime?.success || !tabsData?.success) return;

  const snapshot = runtime.snapshot || { tabs: {} };
  const settings = runtime.settings || {};
  const lifecycleSettings = lifecycle?.settings || {};
  const tabs = tabsData.tabs || [];
  const entries = snapshot.tabs || {};
  const connected = connectedCount(snapshot);
  const generating = Number(snapshot.generatingCount || 0);
  const protectedCount = Number(snapshot.protectedCount || 0);
  const sleeping = tabs.filter(tab => tab.discarded).length;
  const idle = tabs.filter(tab => {
    if (tab.discarded) return false;
    const entry = entries[String(tab.id)];
    return entry?.connected && entry.state === 'idle' && !tab.active;
  }).length;

  const pressureLevel = String(snapshot.memory?.level || 'unknown');
  const pressure = pressureDescriptor(pressureLevel);
  if (pressureLabel) {
    pressureLabel.textContent = pressure.label;
    pressureLabel.className = `runtime-system-pill ${pressureLevel}`;
  }
  if (pressureSub) pressureSub.textContent = pressure.detail;
  if (systemSummary) {
    const disconnected = Math.max(0, tabs.length - connected - sleeping);
    const disconnectedNote = disconnected > 0 ? ` · ${disconnected} cần reload` : '';
    systemSummary.textContent = `${connected}/${tabs.length} chat đang được theo dõi · ${protectedCount} đang được bảo vệ${disconnectedNote}`;
  }

  if (openCount) openCount.textContent = String(tabs.length);
  if (generatingCount) generatingCount.textContent = String(generating);
  if (idleCount) idleCount.textContent = String(idle);
  if (sleepingCount) sleepingCount.textContent = String(sleeping);
  if (generatorLabel) generatorLabel.textContent = `${generating} đang trả lời · ${protectedCount} được bảo vệ`;
  if (liveSummary) liveSummary.textContent = `${tabs.length} chat`;

  const budget = Number(snapshot.parallelBudget || 1);
  const ceiling = Number(settings.maxParallelGenerators || 2);
  if (budgetSub) {
    budgetSub.textContent = settings.cooperativeEnabled === false
      ? `Tự động điều phối đang tắt · giới hạn cấu hình ${ceiling} chat.`
      : `Hiện cho phép ${budget} chat trả lời đồng thời · trần ${ceiling}; Runtime tự giảm khi hệ thống căng.`;
  }

  applyRuntimeControls(settings, lifecycleSettings);
  renderTabs(snapshot, tabs);
}

async function bindAllTabsToWorkspace() {
  const projectId = projectSelect?.value || '';
  if (!projectId) {
    showRuntimeToast('Hãy chọn project chung trước.', 'warning');
    return;
  }

  if (startButton) startButton.disabled = true;
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

    showRuntimeToast(
      failed > 0
        ? `Đã gắn ${bound}/${tabs.length} chat; ${failed} chat cần reload.`
        : `Đã gắn ${bound} chat vào ${project.name}.`,
      failed > 0 ? 'warning' : 'success'
    );
    await refreshRuntime();
  } catch (error) {
    showRuntimeToast(`Không gắn được project: ${error.message}`, 'warning');
  } finally {
    if (startButton) startButton.disabled = false;
  }
}

async function optimizeBackgroundNow() {
  if (!optimizeButton) return;
  optimizeButton.disabled = true;
  optimizeButton.textContent = 'Đang kiểm tra…';
  try {
    const result = await chrome.runtime.sendMessage({ type: 'DISCARD_ALL_BACKGROUND' });
    const slept = Number(result?.discardedCount || 0);
    const protectedCount = Number(result?.protectedCount || 0);
    if (slept > 0) {
      showRuntimeToast(`Đã cho ${slept} chat nền an toàn ngủ${protectedCount ? `; giữ ${protectedCount} chat đang làm việc` : ''}.`, 'success');
    } else if (protectedCount > 0) {
      showRuntimeToast(`${protectedCount} chat đang làm việc nên được giữ nguyên.`, 'info');
    } else {
      showRuntimeToast('Không có chat nền nào cần ngủ.', 'info');
    }
    await refreshRuntime();
  } finally {
    optimizeButton.disabled = false;
    optimizeButton.textContent = 'Tối ưu chat nền ngay';
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
for (const id of ['tab-nav-active', 'tab-nav-stashed', 'tab-nav-projects', 'tab-nav-memory']) {
  document.getElementById(id)?.addEventListener('click', hideRuntimeView);
}

startButton?.addEventListener('click', bindAllTabsToWorkspace);
optimizeButton?.addEventListener('click', optimizeBackgroundNow);

cooperativeToggle?.addEventListener('change', async () => {
  cooperativeToggle.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      type: 'RUNTIME_SET_SETTINGS',
      settings: { cooperativeEnabled: cooperativeToggle.checked }
    });
    showRuntimeToast(cooperativeToggle.checked ? 'Đã bật tự động điều phối.' : 'Đã tắt tự động điều phối.', 'success');
    await refreshRuntime();
  } finally {
    cooperativeToggle.disabled = false;
  }
});

autoSleepToggle?.addEventListener('change', async () => {
  autoSleepToggle.disabled = true;
  try {
    await chrome.runtime.sendMessage({
      type: 'SAVE_SETTINGS',
      settings: { autoDiscardEnabled: autoSleepToggle.checked }
    });
    showRuntimeToast(autoSleepToggle.checked ? 'Đã bật tự sleep chat idle.' : 'Đã tắt tự sleep chat idle.', 'success');
    await refreshRuntime();
  } finally {
    autoSleepToggle.disabled = false;
  }
});

idleMinutesSelect?.addEventListener('change', async () => {
  const minutes = Math.max(1, Number(idleMinutesSelect.value || 5));
  await chrome.runtime.sendMessage({
    type: 'SAVE_SETTINGS',
    settings: { discardIdleMinutes: minutes }
  });
  showRuntimeToast(`Chat nền sẽ được xét sleep sau ${minutes} phút idle.`, 'success');
  await refreshRuntime();
});

parallelSelect?.addEventListener('change', async () => {
  const maximum = Math.max(1, Math.min(8, Number(parallelSelect.value || 2)));
  await chrome.runtime.sendMessage({
    type: 'RUNTIME_SET_SETTINGS',
    settings: { maxParallelGenerators: maximum }
  });
  showRuntimeToast(`Đã đặt trần trả lời đồng thời: ${maximum} chat.`, 'success');
  await refreshRuntime();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') refreshRuntime().catch(() => {});
});

chrome.storage.onChanged.addListener(changes => {
  if (changes.projectVault) loadProjects().catch(() => {});
  if (changes.settings || changes.tabflowRuntimeSettingsV3) refreshRuntime().catch(() => {});
});

loadProjects().then(refreshRuntime).catch(() => {});
refreshTimer = setInterval(() => refreshRuntime().catch(() => {}), 5000);
window.addEventListener('unload', () => {
  if (refreshTimer) clearInterval(refreshTimer);
});
