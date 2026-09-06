import { isWorkspaceTabUrl } from '../workspace/frame-policy.js';

export const WORKSPACE_RUNTIME_SETTINGS_KEY = 'tabflowRuntimeSettingsV3';
export const WORKSPACE_PROJECT_VAULT_KEY = 'projectVault';

function isChatGptDocumentUrl(url) {
  if (typeof url !== 'string' || !url) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'chatgpt.com' || host.endsWith('.chatgpt.com') ||
      host === 'chat.openai.com' || host.endsWith('.chat.openai.com');
  } catch {
    return false;
  }
}

export function isWorkspaceMemorySender(sender, workspaceUrl) {
  const frameId = sender?.frameId;
  if (!Number.isInteger(frameId) || frameId <= 0) return false;
  if (!isWorkspaceTabUrl(sender?.tab?.url || '', workspaceUrl)) return false;
  return isChatGptDocumentUrl(sender?.url || '');
}

export function selectWorkspaceProject(settings, projects) {
  const projectId = typeof settings?.projectId === 'string' ? settings.projectId.trim() : '';
  if (!projectId || !Array.isArray(projects)) return null;

  const match = projects.find(project => project && String(project.id || '') === projectId);
  if (!match) return null;

  return {
    id: projectId.slice(0, 200),
    name: String(match.name || settings.projectName || projectId).slice(0, 240),
    stack: String(match.stack || '').slice(0, 4000),
    rules: String(match.rules || '').slice(0, 12000)
  };
}
