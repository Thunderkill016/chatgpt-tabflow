function cleanDocumentId(documentId) {
  const value = typeof documentId === 'string' ? documentId.trim() : '';
  return value ? value.slice(0, 160) : '';
}

export function memoryActorKey(tabId, frameId = 0, documentId = '') {
  if (!Number.isInteger(tabId) || tabId <= 0) return '';
  const frame = Number.isInteger(frameId) && frameId >= 0 ? frameId : 0;
  if (frame === 0) return `${tabId}:0`;
  const doc = cleanDocumentId(documentId);
  return doc ? `${tabId}:${frame}:${doc}` : `${tabId}:${frame}`;
}

export function memoryBindingLookupKeys(tabId, frameId = 0, documentId = '') {
  const actor = memoryActorKey(tabId, frameId, documentId);
  if (!actor) return [];
  // Legacy Wave-1 bindings were keyed only by tab id. Only the top frame may
  // inherit that key; subframes must never alias another document's project.
  return frameId === 0 ? [actor, String(tabId)] : [actor];
}

export function clearMemoryBindingsForTab(bindings, tabId) {
  const source = bindings && typeof bindings === 'object' ? bindings : {};
  const next = { ...source };
  const prefix = `${tabId}:`;
  for (const key of Object.keys(next)) {
    if (key === String(tabId) || key.startsWith(prefix)) delete next[key];
  }
  return next;
}
