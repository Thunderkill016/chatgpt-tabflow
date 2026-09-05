import {
  createPaneDiagnostic,
  markExpectedDocumentChange,
  observePaneDiagnostic,
  summarizePaneDiagnostics
} from './diagnostics.js';

const CHATGPT_ORIGINS = new Set(['https://chatgpt.com', 'https://chat.openai.com']);
const diagnosticsByPaneId = new Map();
const paneIdByWindow = new WeakMap();

function ensureStatus() {
  let status = document.getElementById('workspace-diagnostics');
  if (status) return status;
  const bar = document.querySelector('.status-bar');
  if (!bar) return null;
  status = document.createElement('div');
  status.id = 'workspace-diagnostics';
  status.className = 'status-item';
  status.textContent = 'Docs stable';
  const shortcut = bar.querySelector('.shortcut-hint');
  if (shortcut) bar.insertBefore(status, shortcut);
  else bar.appendChild(status);
  return status;
}

function activePaneIds() {
  return new Set([...document.querySelectorAll('.chat-pane[data-pane-id]')]
    .map(node => node.dataset.paneId)
    .filter(Boolean));
}

function pruneDiagnostics() {
  const active = activePaneIds();
  for (const paneId of diagnosticsByPaneId.keys()) {
    if (!active.has(paneId)) diagnosticsByPaneId.delete(paneId);
  }
}

function resolvePaneId(source) {
  const cached = paneIdByWindow.get(source);
  if (cached) return cached;

  for (const frame of document.querySelectorAll('iframe[name="tabflow-workspace-pane"]')) {
    if (frame.contentWindow !== source) continue;
    const paneId = frame.closest('.chat-pane')?.dataset.paneId || '';
    if (paneId) paneIdByWindow.set(source, paneId);
    return paneId;
  }
  return '';
}

function paneForId(paneId) {
  for (const pane of document.querySelectorAll('.chat-pane[data-pane-id]')) {
    if (pane.dataset.paneId === paneId) return pane;
  }
  return null;
}

function renderStatus() {
  const status = ensureStatus();
  if (!status) return;
  pruneDiagnostics();
  const summary = summarizePaneDiagnostics([...diagnosticsByPaneId.values()]);

  if (summary.unexpectedRemounts > 0) {
    status.textContent = `⚠ ${summary.unexpectedRemounts} remount`;
  } else if (summary.generating > 0) {
    status.textContent = `Docs stable · ${summary.generating} generating`;
  } else {
    status.textContent = 'Docs stable';
  }

  status.title = [
    `${summary.unexpectedRemounts} unexpected same-URL document remount`,
    `${summary.fullNavigations} full document navigation`,
    `${summary.spaNavigations} SPA navigation`,
    `${summary.generating} pane generating`
  ].join(' · ');
}

function exposePaneDiagnostic(paneId, diagnostic) {
  const pane = paneForId(paneId);
  if (!pane) return;
  pane.dataset.tabflowDocumentToken = diagnostic.documentToken || '';
  pane.dataset.tabflowGeneration = diagnostic.generationActive ? 'active' : 'idle';
  pane.dataset.tabflowUnexpectedRemounts = String(diagnostic.unexpectedRemounts || 0);
}

window.addEventListener('message', event => {
  if (!CHATGPT_ORIGINS.has(event.origin) || event.data?.type !== 'TABFLOW_WORKSPACE_FRAME_STATE') return;
  const paneId = resolvePaneId(event.source);
  if (!paneId) return;

  const previous = diagnosticsByPaneId.get(paneId) || createPaneDiagnostic();
  const next = observePaneDiagnostic(previous, event.data);
  diagnosticsByPaneId.set(paneId, next);
  exposePaneDiagnostic(paneId, next);
  renderStatus();
});

// Capture runs before the pane's own reload click handler changes iframe.src.
// This keeps user-requested reloads out of the unexpected-remount counter.
document.addEventListener('click', event => {
  const button = event.target instanceof Element ? event.target.closest('.btn-reload') : null;
  if (!button) return;
  const paneId = button.closest('.chat-pane')?.dataset.paneId || '';
  if (!paneId) return;
  const previous = diagnosticsByPaneId.get(paneId) || createPaneDiagnostic();
  diagnosticsByPaneId.set(paneId, markExpectedDocumentChange(previous));
}, true);

renderStatus();
