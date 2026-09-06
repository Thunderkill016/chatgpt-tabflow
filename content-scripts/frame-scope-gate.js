(() => {
  'use strict';

  const WORKSPACE_FRAME_NAME = 'tabflow-workspace-pane';

  function exactExtensionOrigin() {
    try {
      if (!globalThis.chrome?.runtime?.getURL) return '';
      return new URL(chrome.runtime.getURL('/')).origin;
    } catch {
      return '';
    }
  }

  function hasAuthorizedExtensionParent() {
    const ancestorOrigin = location.ancestorOrigins?.[0] || '';
    const referrer = document.referrer || '';
    const extensionOrigin = exactExtensionOrigin();

    if (extensionOrigin) {
      return ancestorOrigin === extensionOrigin ||
        referrer === extensionOrigin ||
        referrer.startsWith(`${extensionOrigin}/`);
    }

    // MAIN world has no extension APIs. The workspace-owned frame name plus an
    // extension parent origin prevents ordinary third-party embeddings from
    // activating TabFlow's fetch/memory hooks.
    return ancestorOrigin.startsWith('chrome-extension://') ||
      referrer.startsWith('chrome-extension://');
  }

  const allowed = window.top === window ||
    (window.name === WORKSPACE_FRAME_NAME && hasAuthorizedExtensionParent());

  window.__tabflowFrameScopeAllowed = allowed;
  if (allowed) return;

  // Existing feature scripts are intentionally idempotent. Marking them as
  // installed makes unauthorized subframes fail closed without touching page
  // fetch, DOM observers, or the memory transport.
  window.__tabflowMemoryFetchBridgeInstalled = true;
  window.__tabflowProxyInstalled = true;
  window.__tabflowMemoryClientInstalled = true;
})();
