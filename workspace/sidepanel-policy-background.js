const WORKSPACE_PATH = 'workspace/index.html';

export function isTabFlowWorkspaceUrl(url, runtimeGetUrl) {
  if (typeof url !== 'string' || !url) return false;
  if (typeof runtimeGetUrl !== 'function') return false;

  const workspaceUrl = runtimeGetUrl(WORKSPACE_PATH);
  return url === workspaceUrl ||
    url.startsWith(`${workspaceUrl}?`) ||
    url.startsWith(`${workspaceUrl}#`);
}

export async function applyWorkspaceSidePanelPolicy(tab, api = globalThis.chrome) {
  const tabId = Number(tab?.id);
  if (!Number.isInteger(tabId) || tabId <= 0) return false;
  if (!api?.runtime?.getURL || !api?.sidePanel?.setOptions) return false;

  const url = tab?.url || tab?.pendingUrl || '';
  if (!isTabFlowWorkspaceUrl(url, api.runtime.getURL.bind(api.runtime))) return false;

  await api.sidePanel.setOptions({
    tabId,
    enabled: false
  });
  return true;
}

async function applyForTab(tab) {
  try {
    await applyWorkspaceSidePanelPolicy(tab);
  } catch (error) {
    console.warn('[TabFlow Workspace] Could not hide side panel for workspace tab:', error?.message || error);
  }
}

async function reconcileExistingWorkspaceTabs() {
  if (!chrome?.tabs?.query || !chrome?.runtime?.getURL) return;
  const workspaceUrl = chrome.runtime.getURL(WORKSPACE_PATH);
  const tabs = await chrome.tabs.query({ url: `${workspaceUrl}*` });
  for (const tab of tabs) await applyForTab(tab);
}

if (typeof chrome !== 'undefined' && chrome?.tabs && chrome?.runtime) {
  chrome.tabs.onCreated.addListener(tab => {
    applyForTab(tab);
  });

  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.url || changeInfo.status === 'loading' || changeInfo.status === 'complete') {
      applyForTab(tab);
    }
  });

  chrome.tabs.onActivated.addListener(async ({ tabId }) => {
    try {
      const tab = await chrome.tabs.get(tabId);
      await applyForTab(tab);
    } catch (error) {
      console.warn('[TabFlow Workspace] Could not apply side-panel policy on activation:', error?.message || error);
    }
  });

  chrome.runtime.onInstalled?.addListener(() => {
    reconcileExistingWorkspaceTabs().catch(() => {});
  });

  chrome.runtime.onStartup?.addListener(() => {
    reconcileExistingWorkspaceTabs().catch(() => {});
  });

  // MV3 workers may restart without onStartup. Reconcile once on module load.
  reconcileExistingWorkspaceTabs().catch(() => {});
}
