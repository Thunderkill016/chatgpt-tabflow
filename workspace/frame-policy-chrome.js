import {
  WORKSPACE_FRAME_PATH,
  WORKSPACE_FRAME_RULE_ID,
  buildWorkspaceFrameRule,
  isWorkspaceTabUrl,
  normalizeTabIds
} from './frame-policy.js';

export async function syncWorkspaceFramePolicy({ includeTabIds = [] } = {}) {
  if (!chrome.declarativeNetRequest?.updateSessionRules) {
    throw new Error('Chrome session DNR unavailable');
  }

  const workspaceUrl = chrome.runtime.getURL(WORKSPACE_FRAME_PATH);
  const tabs = await chrome.tabs.query({});
  const tabIds = normalizeTabIds([
    ...tabs
      .filter(tab => Number.isInteger(tab.id) && isWorkspaceTabUrl(tab.url || tab.pendingUrl || '', workspaceUrl))
      .map(tab => tab.id),
    ...includeTabIds
  ]);
  const rule = buildWorkspaceFrameRule(tabIds);

  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [WORKSPACE_FRAME_RULE_ID],
    addRules: rule ? [rule] : []
  });

  return { ruleId: WORKSPACE_FRAME_RULE_ID, tabIds };
}

export async function ensureWorkspaceFramePolicyForCurrentTab() {
  if (!chrome.tabs?.getCurrent) throw new Error('Workspace tab API unavailable');
  const tab = await chrome.tabs.getCurrent();
  if (!Number.isInteger(tab?.id)) throw new Error('Không xác định được Workspace tab hiện tại');
  const result = await syncWorkspaceFramePolicy({ includeTabIds: [tab.id] });
  if (!result.tabIds.includes(tab.id)) throw new Error('Workspace frame policy chưa gắn đúng tab');
  return result;
}
