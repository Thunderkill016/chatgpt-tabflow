export const DEFAULT_SPOTLIGHT_RATIO = 0.64;
export const MIN_SPOTLIGHT_RATIO = 0.48;
export const MAX_SPOTLIGHT_RATIO = 0.78;
export const SPOTLIGHT_SECONDARY_MIN_PX = 300;
export const SPOTLIGHT_SEPARATOR_PX = 6;

function finiteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function spotlightMaxRatio(viewportWidth) {
  const width = Math.max(640, finiteNumber(viewportWidth, 1280));
  const maxBySecondary = 1 - ((SPOTLIGHT_SECONDARY_MIN_PX + SPOTLIGHT_SEPARATOR_PX) / width);
  return Math.max(MIN_SPOTLIGHT_RATIO, Math.min(MAX_SPOTLIGHT_RATIO, maxBySecondary));
}

export function clampSpotlightRatio(value, viewportWidth) {
  const upper = spotlightMaxRatio(viewportWidth);
  const ratio = finiteNumber(value, DEFAULT_SPOTLIGHT_RATIO);
  return Math.min(upper, Math.max(MIN_SPOTLIGHT_RATIO, ratio));
}

export function spotlightRatioFromPointer(clientX, viewportWidth) {
  const width = Math.max(1, finiteNumber(viewportWidth, 1280));
  return clampSpotlightRatio(finiteNumber(clientX, width * DEFAULT_SPOTLIGHT_RATIO) / width, width);
}

export function nudgeSpotlightRatio(current, delta, viewportWidth) {
  return clampSpotlightRatio(
    finiteNumber(current, DEFAULT_SPOTLIGHT_RATIO) + finiteNumber(delta, 0),
    viewportWidth
  );
}

export function spotlightRatioCss(ratio, viewportWidth) {
  const normalized = clampSpotlightRatio(ratio, viewportWidth);
  return `${(normalized * 100).toFixed(2)}%`;
}
