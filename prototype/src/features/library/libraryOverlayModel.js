export const ROW_ACTION_MENU_WIDTH = 248;
export const ROW_ACTION_MENU_ESTIMATED_HEIGHT = 230;
export const ROW_ACTION_MENU_GAP = 5;
export const ROW_ACTION_MENU_VIEWPORT_PADDING = 12;

export function getRowActionMenuPosition(
  triggerRect,
  {
    viewportWidth = 1280,
    viewportHeight = 800,
    menuWidth = ROW_ACTION_MENU_WIDTH,
    menuHeight = ROW_ACTION_MENU_ESTIMATED_HEIGHT,
    gap = ROW_ACTION_MENU_GAP,
    viewportPadding = ROW_ACTION_MENU_VIEWPORT_PADDING,
  } = {},
) {
  const safeViewportWidth = positiveNumber(viewportWidth, 1280);
  const safeViewportHeight = positiveNumber(viewportHeight, 800);
  const safeMenuWidth = positiveNumber(menuWidth, ROW_ACTION_MENU_WIDTH);
  const safeMenuHeight = positiveNumber(menuHeight, ROW_ACTION_MENU_ESTIMATED_HEIGHT);
  const safeGap = Math.max(0, finiteNumber(gap, ROW_ACTION_MENU_GAP));
  const safePadding = Math.max(0, finiteNumber(viewportPadding, ROW_ACTION_MENU_VIEWPORT_PADDING));
  const availableWidth = Math.max(0, safeViewportWidth - safePadding * 2);
  const width = Math.min(safeMenuWidth, availableWidth);
  const maxLeft = Math.max(safePadding, safeViewportWidth - safePadding - width);
  const triggerLeft = finiteNumber(triggerRect?.left, 0);
  const triggerRight = finiteNumber(triggerRect?.right, triggerLeft);
  const triggerTop = finiteNumber(triggerRect?.top, 0);
  const triggerBottom = finiteNumber(triggerRect?.bottom, triggerTop);
  const left = clamp(triggerRight - width, safePadding, maxLeft);
  const spaceAbove = Math.max(0, triggerTop - safeGap - safePadding);
  const spaceBelow = Math.max(0, safeViewportHeight - triggerBottom - safeGap - safePadding);
  const opensUp = spaceBelow < safeMenuHeight && spaceAbove > spaceBelow;
  const availableHeight = opensUp ? spaceAbove : spaceBelow;
  const maxHeight = Math.max(0, Math.min(safeMenuHeight, availableHeight));
  const rawTop = opensUp ? triggerTop - safeGap - maxHeight : triggerBottom + safeGap;
  const maxTop = Math.max(safePadding, safeViewportHeight - safePadding - maxHeight);

  return {
    left,
    top: clamp(rawTop, safePadding, maxTop),
    width,
    maxHeight,
    placement: opensUp ? "top" : "bottom",
  };
}

function finiteNumber(value, fallback) {
  return Number.isFinite(value) ? value : fallback;
}

function positiveNumber(value, fallback) {
  const number = finiteNumber(value, fallback);
  return number > 0 ? number : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(Math.max(value, minimum), maximum);
}
