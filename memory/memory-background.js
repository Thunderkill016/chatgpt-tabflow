const OFFSCREEN_PATH = 'offscreen/memory.html';
const CLIENT_PORT = 'TABFLOW_MEMORY_CLIENT';
const HOST_PORT = 'TABFLOW_MEMORY_OFFSCREEN';
const SESSION_BINDINGS_KEY = 'tabflowMemoryTabBindingsV3';
const CONVERSATION_BINDINGS_KEY = 'tabflowMemoryConversationBindingsV3';

let offscreenPort = null;
let offscreenCreating = null;
let hostReadyWaiters = [];
let sequence = 0;
const pendingHost = new Map();

function nextId(prefix = 'mem') {
  sequence = (sequence + 1) % Number.MAX_SAFE_INTEGER;
  return `${prefix}-${Date.now()}-${sequence}`;
}

function serializeError(error) {
  return {
    name: error?.name || 'Error',
    message: error?.message || String(error),
    stack: typeof error?.stack === 'string' ? error.stack.slice(0, 8000) : ''
  };
}

function conversationKeyFromUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const match = parsed.pathname.match(/(?:^|\/)c\/([A-Za-z0-9_-]+)/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function hasOffscreenDocument() {
  if (chrome.offscreen?.hasDocument) return chrome.offscreen.hasDocument();
  const offscreenUrl = chrome.runtime.getURL(OFFSCREEN_PATH);
  if (chrome.runtime.getContexts) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl]
    });
    return contexts.length > 0;
  }
  const matches = await self.clients.matchAll();
  return matches.some(client => client.url === offscreenUrl);
}

function waitForHostPort(timeoutMs = 6000) {
  if (offscreenPort) return Promise.resolve(offscreenPort);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      hostReadyWaiters = hostReadyWaiters.filter(item => item.resolve !== resolve);
      reject(new Error('TabFlow memory offscreen host did not connect in time'));
    }, timeoutMs);
    hostReadyWaiters.push({
      resolve: port => {
        clearTimeout(timer);
        resolve(port);
      },
      reject
    });
  });
}

async function ensureOffscreenHost() {
  if (offscreenPort) return offscreenPort;
  if (!offscreenCreating) {
    offscreenCreating = (async () => {
      if (!(await hasOffscreenDocument())) {
        await chrome.offscreen.createDocument({
          url: OFFSCREEN_PATH,
          reasons: ['WORKERS'],
          justification: 'Run local TabFlow project indexing and retrieval in a dedicated worker outside ChatGPT renderer threads.'
        });
      }
      return waitForHostPort();
    })().finally(() => {
      offscreenCreating = null;
    });
  }
  return offscreenCreating;
}

function rejectPendingHost(error) {
  for (const entry of pendingHost.values()) {
    clearTimeout(entry.timer);
    entry.reject(error);
  }
  pendingHost.clear();
}

async function callHost(operation, payload = {}) {
  const port = await ensureOffscreenHost();
  const requestId = nextId('host');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingHost.delete(requestId);
      reject(new Error(`Memory worker timeout: ${operation}`));
    }, 60000);
    pendingHost.set(requestId, { resolve, reject, timer });
    try {
      port.postMessage({ requestId, operation, payload });
    } catch (error) {
      clearTimeout(timer);
      pendingHost.delete(requestId);
      reject(error);
    }
  });
}

async function getSessionBindings() {
  const data = await chrome.storage.session.get(SESSION_BINDINGS_KEY);
  return data[SESSION_BINDINGS_KEY] && typeof data[SESSION_BINDINGS_KEY] === 'object'
    ? data[SESSION_BINDINGS_KEY]
    : {};
}

async function getConversationBindings() {
  const data = await chrome.storage.local.get(CONVERSATION_BINDINGS_KEY);
  return data[CONVERSATION_BINDINGS_KEY] && typeof data[CONVERSATION_BINDINGS_KEY] === 'object'
    ? data[CONVERSATION_BINDINGS_KEY]
    : {};
}

async function saveConversationBinding(conversationKey, binding) {
  if (!conversationKey || !binding?.projectId) return;
  const persisted = await getConversationBindings();
  persisted[conversationKey] = {
    projectId: binding.projectId,
    project: binding.project || null,
    boundAt: Date.now()
  };
  await chrome.storage.local.set({ [CONVERSATION_BINDINGS_KEY]: persisted });
}

async function bindProject({ tabId, tabUrl, project }) {
  if (!Number.isInteger(tabId)) throw new Error('Thiếu tabId ChatGPT cần gắn project');
  if (!project?.id) throw new Error('Thiếu project.id');

  const projectRecord = await callHost('UPSERT_PROJECT', { project });
  const conversationKey = conversationKeyFromUrl(tabUrl);
  const session = await getSessionBindings();
  const binding = {
    projectId: projectRecord.id,
    project: projectRecord,
    conversationKey,
    boundAt: Date.now()
  };
  session[String(tabId)] = binding;
  await chrome.storage.session.set({ [SESSION_BINDINGS_KEY]: session });
  if (conversationKey) await saveConversationBinding(conversationKey, binding);
  return binding;
}

async function resolveBinding(port, payload = {}) {
  if (payload.projectId) {
    return {
      projectId: String(payload.projectId),
      project: payload.project || null,
      source: 'explicit'
    };
  }

  const senderTabId = port?.sender?.tab?.id;
  const tabId = Number.isInteger(payload.tabId) ? payload.tabId : senderTabId;
  const tabUrl = payload.tabUrl || port?.sender?.tab?.url || payload.conversation?.url || '';
  const conversationKey = payload.conversation?.id?.startsWith('new:')
    ? ''
    : (payload.conversation?.id || conversationKeyFromUrl(tabUrl));

  if (Number.isInteger(tabId)) {
    const session = await getSessionBindings();
    const direct = session[String(tabId)];
    if (direct?.projectId) {
      if (conversationKey && conversationKey !== direct.conversationKey) {
        const promoted = { ...direct, conversationKey, boundAt: Date.now() };
        session[String(tabId)] = promoted;
        await chrome.storage.session.set({ [SESSION_BINDINGS_KEY]: session });
        await saveConversationBinding(conversationKey, promoted);
        return { ...promoted, source: 'tab-promoted' };
      }
      return { ...direct, source: 'tab-session' };
    }
  }

  if (conversationKey) {
    const persisted = await getConversationBindings();
    const match = persisted[conversationKey];
    if (match?.projectId) {
      if (Number.isInteger(tabId)) {
        const session = await getSessionBindings();
        session[String(tabId)] = { ...match, conversationKey, boundAt: Date.now() };
        await chrome.storage.session.set({ [SESSION_BINDINGS_KEY]: session });
      }
      return { ...match, conversationKey, source: 'conversation-persisted' };
    }
  }

  return null;
}

async function runClientRequest(port, type, payload = {}) {
  if (type === 'PING') {
    const worker = await callHost('PING', {});
    return { worker, protocol: 1 };
  }

  if (type === 'BIND_PROJECT') {
    const tabId = Number.isInteger(payload.tabId) ? payload.tabId : port?.sender?.tab?.id;
    const tabUrl = payload.tabUrl || port?.sender?.tab?.url || '';
    return bindProject({ tabId, tabUrl, project: payload.project });
  }

  if (type === 'GET_BINDING') return resolveBinding(port, payload);

  const binding = await resolveBinding(port, payload);
  if (!binding?.projectId) {
    const error = new Error('Tab ChatGPT chưa được gắn với Local Project Memory');
    error.code = 'PROJECT_NOT_BOUND';
    throw error;
  }

  const base = {
    ...payload,
    projectId: binding.projectId,
    project: binding.project || payload.project || null
  };

  switch (type) {
    case 'INGEST_MESSAGE': return callHost('INGEST_MESSAGE', base);
    case 'INGEST_ARCHIVE': return callHost('INGEST_ARCHIVE', base);
    case 'QUERY_RAG': return callHost('QUERY_RAG', base);
    case 'LIST_FILES': return callHost('LIST_FILES', base);
    case 'GET_FILE': return callHost('GET_FILE', base);
    case 'LIST_DECISIONS': return callHost('LIST_DECISIONS', base);
    case 'PROJECT_STATS': return callHost('PROJECT_STATS', base);
    case 'UPSERT_DECISION': return callHost('UPSERT_DECISION', base);
    case 'CLEAR_PROJECT': return callHost('CLEAR_PROJECT', base);
    default: throw new Error(`Unknown TabFlow memory RPC: ${type}`);
  }
}

function attachClientPort(port) {
  port.onMessage.addListener(message => {
    const { requestId, type, payload } = message || {};
    if (!requestId || !type) return;
    (async () => {
      try {
        const result = await runClientRequest(port, type, payload || {});
        port.postMessage({ requestId, ok: true, result });
      } catch (error) {
        port.postMessage({ requestId, ok: false, error: { ...serializeError(error), code: error?.code || '' } });
      }
    })();
  });
}

function attachHostPort(port) {
  offscreenPort = port;
  const waiters = hostReadyWaiters;
  hostReadyWaiters = [];
  for (const waiter of waiters) waiter.resolve(port);

  port.onMessage.addListener(message => {
    const { requestId, ok, result, error } = message || {};
    const pending = pendingHost.get(requestId);
    if (!pending) return;
    pendingHost.delete(requestId);
    clearTimeout(pending.timer);
    if (ok) pending.resolve(result);
    else {
      const err = new Error(error?.message || 'TabFlow memory worker failed');
      err.name = error?.name || 'MemoryWorkerError';
      pending.reject(err);
    }
  });

  port.onDisconnect.addListener(() => {
    if (offscreenPort === port) offscreenPort = null;
    rejectPendingHost(new Error('TabFlow memory offscreen host disconnected'));
  });
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name === HOST_PORT) {
    attachHostPort(port);
    return;
  }
  if (port.name === CLIENT_PORT) attachClientPort(port);
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const session = await getSessionBindings();
  if (!Object.hasOwn(session, String(tabId))) return;
  delete session[String(tabId)];
  await chrome.storage.session.set({ [SESSION_BINDINGS_KEY]: session });
});
