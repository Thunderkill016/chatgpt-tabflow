import { syncWorkspaceFramePolicy } from './frame-policy-chrome.js';

let syncTail = Promise.resolve();

function queueSync() {
  const current = syncTail.catch(() => undefined).then(() => syncWorkspaceFramePolicy());
  syncTail = current.catch(error => {
    console.warn('[TabFlow Workspace] Frame policy sync failed:', error?.message || error);
  });
  return current;
}

chrome.runtime.onInstalled.addListener(() => {
  queueSync().catch(() => {});
});

chrome.runtime.onStartup?.addListener(() => {
  queueSync().catch(() => {});
});

chrome.tabs.onRemoved.addListener(() => {
  queueSync().catch(() => {});
});

// Service-worker restarts can happen without onStartup/onInstalled. Reconcile
// once at module evaluation so stale workspace tab ids never stay authorized.
queueSync().catch(() => {});
