const worker = new Worker(chrome.runtime.getURL('workers/memory-worker.js'), {
  type: 'module',
  name: 'tabflow-project-memory'
});

let port = null;
let reconnectTimer = null;
const pending = new Set();

function scheduleReconnect() {
  if (reconnectTimer) return;
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connectBackground();
  }, 250);
}

function connectBackground() {
  if (port) return;
  const next = chrome.runtime.connect({ name: 'TABFLOW_MEMORY_OFFSCREEN' });
  port = next;

  next.onMessage.addListener(message => {
    const { requestId, operation, payload } = message || {};
    if (!requestId || !operation) return;
    pending.add(requestId);
    worker.postMessage({ requestId, operation, payload: payload || {} });
  });

  next.onDisconnect.addListener(() => {
    if (port === next) port = null;
    // The MV3 service worker can be terminated independently of this offscreen
    // document. Keep the compute worker alive and reconnect to the next SW instance.
    pending.clear();
    scheduleReconnect();
  });
}

worker.addEventListener('message', event => {
  const message = event.data || {};
  if (!message.requestId) return;
  pending.delete(message.requestId);
  if (!port) return;
  try {
    port.postMessage(message);
  } catch (error) {
    console.warn('[TabFlow Memory Host] Port closed while forwarding worker response:', error);
  }
});

worker.addEventListener('error', event => {
  const error = {
    name: 'MemoryWorkerError',
    message: event.message || 'TabFlow project-memory worker crashed'
  };
  if (port) {
    for (const requestId of pending) {
      try { port.postMessage({ requestId, ok: false, error }); } catch {}
    }
  }
  pending.clear();
});

connectBackground();
