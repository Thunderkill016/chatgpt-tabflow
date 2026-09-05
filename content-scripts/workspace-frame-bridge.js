(() => {
  'use strict';

  if (window.top === window || window.__tabflowWorkspaceFrameBridgeInstalled) return;
  const workspacePrefix = chrome.runtime.getURL('workspace/');
  if (!document.referrer || !document.referrer.startsWith(workspacePrefix)) return;
  window.__tabflowWorkspaceFrameBridgeInstalled = true;

  const EXTENSION_ORIGIN = new URL(chrome.runtime.getURL('/')).origin;
  let lastFingerprint = '';
  let timer = null;

  function emitState(force = false) {
    const payload = {
      type: 'TABFLOW_WORKSPACE_FRAME_STATE',
      href: location.href,
      title: (document.title || 'ChatGPT').replace(/\s+-\s+ChatGPT$/i, '').slice(0, 500),
      readyState: document.readyState,
      observedAt: Date.now()
    };
    const fingerprint = `${payload.href}|${payload.title}|${payload.readyState}`;
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
