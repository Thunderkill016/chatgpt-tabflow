import {
  DEFAULT_SPOTLIGHT_RATIO,
  MIN_SPOTLIGHT_RATIO,
  clampSpotlightRatio,
  spotlightMaxRatio,
  spotlightRatioFromPointer,
  nudgeSpotlightRatio,
  spotlightRatioCss
} from './spotlight-layout.js';

const STORAGE_KEY = 'workspaceSpotlightRatioV1';
const grid = document.getElementById('chat-grid');
const separator = document.getElementById('spotlight-separator');

if (grid && separator) {
  let ratio = DEFAULT_SPOTLIGHT_RATIO;
  let pendingClientX = null;
  let frameId = null;
  let draggingPointerId = null;

  function active() {
    return grid.dataset.layout === 'spotlight-3';
  }

  function updateA11y() {
    const normalized = clampSpotlightRatio(ratio, window.innerWidth);
    const maxRatio = spotlightMaxRatio(window.innerWidth);
    const pct = Math.round(normalized * 100);
    separator.setAttribute('aria-valuemin', String(Math.round(MIN_SPOTLIGHT_RATIO * 100)));
    separator.setAttribute('aria-valuemax', String(Math.round(maxRatio * 100)));
    separator.setAttribute('aria-valuenow', String(pct));
    separator.setAttribute('aria-valuetext', `Pane chính ${pct}% chiều rộng workspace`);
  }

  function applyRatio(nextRatio = ratio) {
    ratio = clampSpotlightRatio(nextRatio, window.innerWidth);
    grid.style.setProperty('--spotlight-primary-width', spotlightRatioCss(ratio, window.innerWidth));
    updateA11y();
  }

  async function persistRatio() {
    try {
      await chrome.storage.local.set({ [STORAGE_KEY]: ratio });
    } catch (error) {
      console.warn('[TabFlow Workspace] Could not persist spotlight ratio:', error?.message || error);
    }
  }

  function syncVisibility() {
    const enabled = active();
    separator.hidden = !enabled;
    separator.tabIndex = enabled ? 0 : -1;
    if (enabled) applyRatio(ratio);
  }

  function schedulePointerRatio(clientX) {
    pendingClientX = clientX;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      if (pendingClientX === null) return;
      const next = spotlightRatioFromPointer(pendingClientX, window.innerWidth);
      pendingClientX = null;
      applyRatio(next);
    });
  }

  function finishDrag(pointerId) {
    if (draggingPointerId === null || pointerId !== draggingPointerId) return;
    draggingPointerId = null;
    document.body.classList.remove('workspace-resizing');
    try {
      if (separator.hasPointerCapture(pointerId)) separator.releasePointerCapture(pointerId);
    } catch {}
    persistRatio();
  }

  separator.addEventListener('pointerdown', event => {
    if (!active() || event.button !== 0) return;
    event.preventDefault();
    draggingPointerId = event.pointerId;
    document.body.classList.add('workspace-resizing');
    try {
      separator.setPointerCapture(event.pointerId);
    } catch {}
    schedulePointerRatio(event.clientX);
  });

  separator.addEventListener('pointermove', event => {
    if (draggingPointerId !== event.pointerId) return;
    schedulePointerRatio(event.clientX);
  });

  separator.addEventListener('pointerup', event => finishDrag(event.pointerId));
  separator.addEventListener('pointercancel', event => finishDrag(event.pointerId));
  separator.addEventListener('lostpointercapture', event => finishDrag(event.pointerId));

  separator.addEventListener('dblclick', event => {
    if (!active()) return;
    event.preventDefault();
    applyRatio(DEFAULT_SPOTLIGHT_RATIO);
    persistRatio();
  });

  separator.addEventListener('keydown', event => {
    if (!active()) return;
    const step = event.shiftKey ? 0.05 : 0.02;
    let next = null;

    if (event.key === 'ArrowLeft') next = nudgeSpotlightRatio(ratio, -step, window.innerWidth);
    else if (event.key === 'ArrowRight') next = nudgeSpotlightRatio(ratio, step, window.innerWidth);
    else if (event.key === 'Home') next = MIN_SPOTLIGHT_RATIO;
    else if (event.key === 'End') next = spotlightMaxRatio(window.innerWidth);
    else if (event.key === 'Enter') next = DEFAULT_SPOTLIGHT_RATIO;
    else return;

    event.preventDefault();
    applyRatio(next);
    persistRatio();
  });

  const layoutObserver = new MutationObserver(syncVisibility);
  layoutObserver.observe(grid, { attributes: true, attributeFilter: ['data-layout'] });

  window.addEventListener('resize', () => {
    if (active()) applyRatio(ratio);
  }, { passive: true });

  (async () => {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      ratio = clampSpotlightRatio(stored[STORAGE_KEY], window.innerWidth);
    } catch {
      ratio = DEFAULT_SPOTLIGHT_RATIO;
    }
    applyRatio(ratio);
    syncVisibility();
  })();
}
