(() => {
  'use strict';

  if (window.top === window || window.__tabflowWorkspaceFrameBridgeInstalled) return;

  const WORKSPACE_FRAME_NAME = 'tabflow-workspace-pane';
  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
  const ancestorOrigin = location.ancestorOrigins?.[0] || '';
  const referrer = document.referrer || '';
  const isTabFlowWorkspace = window.name === WORKSPACE_FRAME_NAME &&
    (ancestorOrigin === EXTENSION_ORIGIN || referrer.startsWith(chrome.runtime.getURL('workspace/')));
  if (!isTabFlowWorkspace) return;

  window.__tabflowWorkspaceFrameBridgeInstalled = true;
  const documentToken = globalThis.crypto?.randomUUID?.() ||
    `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let lastFingerprint = '';
  let timer = null;

  function hasGenerationControl() {
    return Boolean(document.querySelector(
      'button[data-testid*="stop"], button[aria-label*="Stop" i], button[aria-label*="Dừng" i]'
    ));
  }

  function emitState(force = false) {
    const payload = {
      type: 'TABFLOW_WORKSPACE_FRAME_STATE',
      documentToken,
      href: location.href,
      title: (document.title || 'ChatGPT').replace(/\s+-\s+ChatGPT$/i, '').slice(0, 500),
      readyState: document.readyState,
      generationActive: hasGenerationControl(),
      observedAt: Date.now()
    };
    const fingerprint = `${payload.documentToken}|${payload.href}|${payload.title}|${payload.readyState}|${payload.generationActive}`;
    if (!force && fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    window.parent.postMessage(payload, EXTENSION_ORIGIN);
  }

  function focusComposer() {
    const editor = document.getElementById('prompt-textarea') ||
      document.querySelector('form textarea, form [contenteditable="true"]');
    if (editor instanceof HTMLElement) editor.focus({ preventScroll: false });
  }

  window.addEventListener('message', event => {
    if (event.source !== window.parent || event.origin !== EXTENSION_ORIGIN) return;
    if (event.data?.type === 'TABFLOW_WORKSPACE_FOCUS_COMPOSER') focusComposer();
  });

  window.addEventListener('pageshow', () => emitState(true), true);
  window.addEventListener('popstate', () => emitState(true), true);
  document.addEventListener('visibilitychange', () => emitState(true), true);

  const observer = new MutationObserver(() => emitState(false));
  const title = document.querySelector('title');
  if (title) observer.observe(title, { childList: true, characterData: true, subtree: true });

  emitState(true);
  timer = setInterval(() => emitState(false), 2000);
  window.addEventListener('pagehide', () => {
    if (timer) clearInterval(timer);
    observer.disconnect();
  }, { once: true });
})();
