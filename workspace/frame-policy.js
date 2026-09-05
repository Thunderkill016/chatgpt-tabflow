export const WORKSPACE_FRAME_RULE_ID = 20001;
export const WORKSPACE_FRAME_PATH = 'workspace/index.html';
export const WORKSPACE_FRAME_REQUEST_DOMAINS = Object.freeze(['chatgpt.com', 'chat.openai.com']);

export function normalizeTabIds(tabIds = []) {
  const unique = new Set();
  for (const value of Array.isArray(tabIds) ? tabIds : []) {
    if (value === null || value === undefined || value === '' || typeof value === 'boolean') continue;
    const id = Number(value);
    if (Number.isInteger(id) && id > 0) unique.add(id);
  }
  return [...unique].sort((a, b) => a - b);
}

export function isWorkspaceTabUrl(url, workspaceUrl) {
  if (typeof url !== 'string' || typeof workspaceUrl !== 'string' || !workspaceUrl) return false;
  try {
    const candidate = new URL(url);
    const expected = new URL(workspaceUrl);
    return candidate.origin === expected.origin && candidate.pathname === expected.pathname;
  } catch {
    return false;
  }
}

export function buildWorkspaceFrameRule(tabIds) {
  const normalized = normalizeTabIds(tabIds);
  if (normalized.length === 0) return null;

  return {
    id: WORKSPACE_FRAME_RULE_ID,
    priority: 1,
    action: {
      type: 'modifyHeaders',
      responseHeaders: [
        { header: 'x-frame-options', operation: 'remove' },
        { header: 'content-security-policy', operation: 'remove' }
      ]
    },
    condition: {
      requestDomains: [...WORKSPACE_FRAME_REQUEST_DOMAINS],
      resourceTypes: ['sub_frame'],
      tabIds: normalized
    }
  };
}
