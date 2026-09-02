export const FLOATING_BALL_CONSTANTS = Object.freeze({
  ballSizeDip: 64,
  panelWidthDip: 360,
  panelHeightDip: 420,
  panelMinWidthDip: 280,
  panelMinHeightDip: 240,
  panelGapDip: 0,
  recentLimit: 5,
  enterNearDip: 28,
  leaveNearDip: 16,
  openDelayMs: 120,
  closeDelayMs: 250,
  snapThresholdDip: 24,
  placementSaveDebounceMs: 220,
});

export const FLOATING_DIRECTIONS = Object.freeze(["left", "right"]);

export function getPanelDirection(placement, workArea, ballPosition, panelSize = {}) {
  const placementDirection = {
    left: "right",
    right: "left",
  }[placement?.edge];
  if (!workArea || !ballPosition) return placementDirection || "left";

  const area = normalizeWorkArea(workArea);
  const ballRect = normalizeBallRect(ballPosition);
  const requestedWidth = normalizePanelSize(panelSize).width;
  const leftSpace = getAvailableSpace("left", ballRect, area);
  const rightSpace = getAvailableSpace("right", ballRect, area);
  const leftFits = leftSpace >= requestedWidth;
  const rightFits = rightSpace >= requestedWidth;
  if (leftFits && !rightFits) return "left";
  if (rightFits && !leftFits) return "right";
  if (leftSpace !== rightSpace) return leftSpace > rightSpace ? "left" : "right";
  return ballRect.x + ballRect.width / 2 <= area.x + area.width / 2 ? "right" : "left";
}

export function getExpandedWindowGeometry(ballPosition, direction, panelSize = {}, workArea = null) {
  const area = workArea ? normalizeWorkArea(workArea) : null;
  const requested = normalizePanelSize(panelSize);
  const ballRect = area ? clampBallToWorkArea(normalizeBallRect(ballPosition), area) : normalizeBallRect(ballPosition);
  const resolvedDirection = direction === "left" ? "left" : "right";
  const size = resolvePanelSize(resolvedDirection, requested, ballRect, area);
  const panelRect = getPanelRect(ballRect, resolvedDirection, size, area);
  const hostRect = unionRects(ballRect, panelRect);
  return {
    ...hostRect,
    ballRect,
    panelRect,
    hostRect,
    panelSize: size,
    direction: resolvedDirection,
    ballOffsetX: ballRect.x - hostRect.x,
    ballOffsetY: ballRect.y - hostRect.y,
    panelOffsetX: panelRect.x - hostRect.x,
    panelOffsetY: panelRect.y - hostRect.y,
  };
}

export function normalizeWorkArea(workArea) {
  return {
    x: Number(workArea?.x) || 0,
    y: Number(workArea?.y) || 0,
    width: Math.max(0, Number(workArea?.width) || 0),
    height: Math.max(0, Number(workArea?.height) || 0),
    scaleFactor: normalizeScaleFactor(workArea?.scaleFactor),
  };
}

function normalizeBallRect(ballPosition) {
  const ballSize = FLOATING_BALL_CONSTANTS.ballSizeDip;
  return {
    x: finiteNumber(ballPosition?.x),
    y: finiteNumber(ballPosition?.y),
    width: positiveNumber(ballPosition?.width, ballSize),
    height: positiveNumber(ballPosition?.height, ballSize),
  };
}

function normalizePanelSize(panelSize) {
  return {
    width: positiveNumber(panelSize?.width, FLOATING_BALL_CONSTANTS.panelWidthDip),
    height: positiveNumber(panelSize?.height, FLOATING_BALL_CONSTANTS.panelHeightDip),
  };
}

function getAvailableSpace(direction, ballRect, area) {
  if (direction === "left") return Math.max(0, ballRect.x - area.x);
  if (direction === "right") return Math.max(0, area.x + area.width - (ballRect.x + ballRect.width));
  return 0;
}

function resolvePanelSize(direction, requested, ballRect, area) {
  if (!area) return requested;
  const primarySpace = getAvailableSpace(direction, ballRect, area);
  return {
    width: fitDimension(requested.width, primarySpace, FLOATING_BALL_CONSTANTS.panelMinWidthDip),
    height: fitDimension(requested.height, area.height, FLOATING_BALL_CONSTANTS.panelMinHeightDip),
  };
}

function getPanelRect(ballRect, direction, panelSize, area) {
  const gap = FLOATING_BALL_CONSTANTS.panelGapDip;
  const desiredX = direction === "left"
    ? ballRect.x - panelSize.width - gap
    : ballRect.x + ballRect.width + gap;
  const desiredY = ballRect.y;
  if (!area) return { x: desiredX, y: desiredY, ...panelSize };
  return {
    x: clamp(desiredX, area.x, area.x + area.width - panelSize.width),
    y: clamp(desiredY, area.y, area.y + area.height - panelSize.height),
    ...panelSize,
  };
}

function unionRects(left, right) {
  const x = Math.min(left.x, right.x);
  const y = Math.min(left.y, right.y);
  const rightEdge = Math.max(left.x + left.width, right.x + right.width);
  const bottomEdge = Math.max(left.y + left.height, right.y + right.height);
  return { x, y, width: rightEdge - x, height: bottomEdge - y };
}

function clampBallToWorkArea(ballRect, area) {
  return {
    ...ballRect,
    x: clamp(ballRect.x, area.x, area.x + area.width - ballRect.width),
    y: clamp(ballRect.y, area.y, area.y + area.height - ballRect.height),
  };
}

function fitDimension(requested, maximum, minimum) {
  const safeMaximum = Math.max(1, maximum);
  return Math.min(Math.max(requested, Math.min(minimum, safeMaximum)), safeMaximum);
}

function finiteNumber(value) {
  return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function positiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function normalizeScaleFactor(scaleFactor) {
  return Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
}

function clamp(value, minimum, maximum) {
  if (maximum < minimum) return minimum;
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
