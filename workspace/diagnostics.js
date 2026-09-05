const EXPECTED_DOCUMENT_CHANGE_MS = 15_000;

function finiteTimestamp(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function cleanToken(value) {
  return typeof value === 'string' ? value.slice(0, 200) : '';
}

function cleanHref(value) {
  return typeof value === 'string' ? value.slice(0, 4000) : '';
}

export function createPaneDiagnostic() {
  return {
    documentToken: '',
    href: '',
    generationActive: false,
    spaNavigations: 0,
    fullNavigations: 0,
    expectedReloads: 0,
    unexpectedRemounts: 0,
    expectedDocumentChangeUntil: 0,
    lastObservedAt: 0
  };
}

export function markExpectedDocumentChange(previous, now = Date.now(), ttlMs = EXPECTED_DOCUMENT_CHANGE_MS) {
  const base = { ...createPaneDiagnostic(), ...(previous || {}) };
  const at = finiteTimestamp(now, Date.now());
  const ttl = Math.max(1000, Math.min(60_000, Number(ttlMs) || EXPECTED_DOCUMENT_CHANGE_MS));
  return {
    ...base,
    expectedDocumentChangeUntil: at + ttl
  };
}

export function observePaneDiagnostic(previous, payload = {}) {
  const base = { ...createPaneDiagnostic(), ...(previous || {}) };
  const observedAt = finiteTimestamp(payload.observedAt, Date.now());
  const documentToken = cleanToken(payload.documentToken);
  const href = cleanHref(payload.href);
  const tokenChanged = Boolean(base.documentToken && documentToken && base.documentToken !== documentToken);
  const hrefChanged = Boolean(base.href && href && base.href !== href);
  const expectedChange = base.expectedDocumentChangeUntil >= observedAt;

  let spaNavigations = base.spaNavigations;
  let fullNavigations = base.fullNavigations;
  let expectedReloads = base.expectedReloads;
  let unexpectedRemounts = base.unexpectedRemounts;
  let expectedDocumentChangeUntil = expectedChange ? base.expectedDocumentChangeUntil : 0;

  if (tokenChanged) {
    if (expectedChange) {
      expectedReloads += 1;
    } else if (hrefChanged) {
      fullNavigations += 1;
    } else {
      unexpectedRemounts += 1;
    }
    expectedDocumentChangeUntil = 0;
  } else if (hrefChanged && base.documentToken && documentToken === base.documentToken) {
    spaNavigations += 1;
  }

  return {
    documentToken: documentToken || base.documentToken,
    href: href || base.href,
    generationActive: Boolean(payload.generationActive),
    spaNavigations,
    fullNavigations,
    expectedReloads,
    unexpectedRemounts,
    expectedDocumentChangeUntil,
    lastObservedAt: observedAt
  };
}

export function summarizePaneDiagnostics(diagnostics) {
  const items = diagnostics instanceof Map
    ? [...diagnostics.values()]
    : (Array.isArray(diagnostics) ? diagnostics : []);
  return items.reduce((summary, item) => {
    if (!item) return summary;
    summary.generating += item.generationActive ? 1 : 0;
    summary.unexpectedRemounts += Number(item.unexpectedRemounts || 0);
    summary.fullNavigations += Number(item.fullNavigations || 0);
    summary.spaNavigations += Number(item.spaNavigations || 0);
    return summary;
  }, { generating: 0, unexpectedRemounts: 0, fullNavigations: 0, spaNavigations: 0 });
}
