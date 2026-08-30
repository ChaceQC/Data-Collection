export const FLOATING_BALL_CONSTANTS = Object.freeze({
  ballSizeDip: 64,
  panelWidthDip: 320,
  panelHeightDip: 322,
  recentLimit: 5,
  enterNearDip: 28,
  leaveNearDip: 16,
  openDelayMs: 120,
  closeDelayMs: 250,
  snapThresholdDip: 24,
  placementSaveDebounceMs: 220,
});

export const DEFAULT_FLOATING_PLACEMENT = Object.freeze({
  mode: "edge",
  monitorKey: "primary",
  edge: "right",
  offsetDip: 0,
  xDip: null,
  yDip: null,
});

export const FLOATING_STATUSES = Object.freeze([
  "idle",
  "near",
  "drag-over",
  "recording",
  "recorded",
  "partial-error",
  "error",
  "moving",
]);

export function getRecentEntries(entries, limit = FLOATING_BALL_CONSTANTS.recentLimit) {
  const latestById = new Map();
  for (const entry of entries || []) {
    const recordedAt = Number(entry?.recordedAt);
    if (!entry?.id || !Number.isFinite(recordedAt) || recordedAt <= 0) continue;
    const current = latestById.get(entry.id);
    if (!current || recordedAt >= Number(current.recordedAt)) {
      latestById.set(entry.id, { ...entry, recordedAt });
    }
  }
  return [...latestById.values()]
    .sort((left, right) => right.recordedAt - left.recordedAt || String(left.id).localeCompare(String(right.id)))
    .slice(0, Math.max(0, limit));
}

export function mergePendingPaths(pendingPaths, nextPaths) {
  const merged = [];
  const seen = new Set();
  for (const path of [...(pendingPaths || []), ...(nextPaths || [])]) {
    if (typeof path !== "string" || !path.trim() || seen.has(path)) continue;
    seen.add(path);
    merged.push(path);
  }
  return merged;
}

export function getRecordStatus(result) {
  const recordedCount = Number(result?.recordedCount) || 0;
  const skippedCount = Number(result?.skippedCount) || 0;
  if (recordedCount > 0 && skippedCount > 0) return "partial-error";
  if (recordedCount > 0) return "recorded";
  return "error";
}

export function getRecordMessage(result) {
  if (!result) return "悬浮球记录失败，请重试";
  const parts = [];
  if (result.indexedCount) parts.push(`新增 ${result.indexedCount} 项`);
  if (result.refreshedCount) parts.push(`刷新 ${result.refreshedCount} 项`);
  if (result.skippedCount) parts.push(`跳过 ${result.skippedCount} 项`);
  if (result.skippedReasons?.length) parts.push(`原因：${result.skippedReasons.join("、")}`);
  if (result.truncated) parts.push("已达到索引上限");
  return parts.length ? parts.join("，") : "没有找到可记录的路径";
}

export function getNearState(cursor, bounds, wasNear = false) {
  if (!cursor || !bounds) return false;
  const distance = distanceToRect(cursor, bounds);
  const enterThreshold = FLOATING_BALL_CONSTANTS.enterNearDip;
  if (!wasNear) return distance <= enterThreshold;
  const leaveThreshold = FLOATING_BALL_CONSTANTS.leaveNearDip;
  return distance <= leaveThreshold || (distance > leaveThreshold && distance <= enterThreshold);
}

export function getPanelDirection(placement, workArea, ballPosition, panelSize = {}) {
  const edgeDirection = {
    left: "right",
    right: "left",
    top: "down",
    bottom: "up",
  };
  if (placement?.mode === "edge" && edgeDirection[placement.edge]) {
    return edgeDirection[placement.edge];
  }
  if (!workArea || !ballPosition) return "left";

  const width = Number(panelSize.width) || FLOATING_BALL_CONSTANTS.panelWidthDip;
  const height = Number(panelSize.height) || FLOATING_BALL_CONSTANTS.panelHeightDip;
  const available = {
    left: ballPosition.x - workArea.x,
    right: workArea.x + workArea.width - (ballPosition.x + FLOATING_BALL_CONSTANTS.ballSizeDip),
    up: ballPosition.y - workArea.y,
    down: workArea.y + workArea.height - (ballPosition.y + FLOATING_BALL_CONSTANTS.ballSizeDip),
  };
  const options = [
    ["left", available.left >= width],
    ["right", available.right >= width],
    ["up", available.up >= height],
    ["down", available.down >= height],
  ];
  return options
    .filter(([, fits]) => fits)
    .sort((left, right) => available[right[0]] - available[left[0]])[0]?.[0]
    || Object.entries(available).sort((left, right) => right[1] - left[1])[0][0];
}

export function getExpandedWindowGeometry(ballPosition, direction, panelSize = {}, workArea = null) {
  const ballSize = FLOATING_BALL_CONSTANTS.ballSizeDip;
  const panelWidth = Number(panelSize.width) || FLOATING_BALL_CONSTANTS.panelWidthDip;
  const panelHeight = Number(panelSize.height) || FLOATING_BALL_CONSTANTS.panelHeightDip;
  const area = workArea ? normalizeWorkArea(workArea) : null;
  const width = direction === "left" || direction === "right"
    ? ballSize + panelWidth
    : Math.max(ballSize, panelWidth);
  const height = direction === "up" || direction === "down"
    ? ballSize + panelHeight
    : Math.max(ballSize, panelHeight);
  const desiredRootX = direction === "left" ? ballPosition.x - panelWidth : ballPosition.x;
  const rootX = area
    ? clamp(desiredRootX, area.x, area.x + area.width - width)
    : desiredRootX;
  const rootY = area
    ? clamp(
      direction === "up" ? ballPosition.y - panelHeight : ballPosition.y,
      area.y,
      area.y + area.height - height,
    )
    : direction === "up" ? ballPosition.y - panelHeight : ballPosition.y;
  const normalBallPosition = {
    x: direction === "left" ? rootX + panelWidth : rootX,
    y: direction === "up" ? rootY + panelHeight : rootY,
  };
  const geometry = {
    x: rootX,
    y: rootY,
    width,
    height,
    ballOffsetX: ballPosition.x - normalBallPosition.x,
    ballOffsetY: ballPosition.y - normalBallPosition.y,
  };
  return geometry;
}

export function getSnapPlacement(windowPosition, workArea, monitorKey, options = {}) {
  const ballSize = Number(options.ballSize) || FLOATING_BALL_CONSTANTS.ballSizeDip;
  const threshold = Number(options.threshold) || FLOATING_BALL_CONSTANTS.snapThresholdDip;
  const x = Number(windowPosition?.x) || 0;
  const y = Number(windowPosition?.y) || 0;
  const area = normalizeWorkArea(workArea);
  const maxX = Math.max(0, area.width - ballSize);
  const maxY = Math.max(0, area.height - ballSize);
  const distances = [
    { edge: "left", distance: x - area.x, offsetDip: y - area.y },
    { edge: "right", distance: area.x + area.width - (x + ballSize), offsetDip: y - area.y },
    { edge: "top", distance: y - area.y, offsetDip: x - area.x },
    { edge: "bottom", distance: area.y + area.height - (y + ballSize), offsetDip: x - area.x },
  ]
    .map((candidate) => ({ ...candidate, distance: Math.max(0, candidate.distance) }))
    .sort((left, right) => left.distance - right.distance);
  const nearest = distances[0];
  if (nearest && nearest.distance <= threshold) {
    const limit = nearest.edge === "left" || nearest.edge === "right" ? maxY : maxX;
    return {
      mode: "edge",
      monitorKey: monitorKey || "primary",
      edge: nearest.edge,
      offsetDip: clamp(nearest.offsetDip, 0, limit),
      xDip: null,
      yDip: null,
    };
  }
  return {
    mode: "free",
    monitorKey: monitorKey || "primary",
    edge: null,
    offsetDip: null,
    xDip: clamp(x - area.x, 0, maxX),
    yDip: clamp(y - area.y, 0, maxY),
  };
}

export function getPlacementPosition(placement, workArea, ballSize = FLOATING_BALL_CONSTANTS.ballSizeDip) {
  const area = normalizeWorkArea(workArea);
  const maxX = Math.max(0, area.width - ballSize);
  const maxY = Math.max(0, area.height - ballSize);
  if (placement?.mode === "free") {
    return {
      x: area.x + clamp(Number(placement.xDip) || 0, 0, maxX),
      y: area.y + clamp(Number(placement.yDip) || 0, 0, maxY),
    };
  }
  const offset = Number(placement?.offsetDip) || 0;
  if (placement?.edge === "left") return { x: area.x, y: area.y + clamp(offset, 0, maxY) };
  if (placement?.edge === "top") return { x: area.x + clamp(offset, 0, maxX), y: area.y };
  if (placement?.edge === "bottom") return { x: area.x + clamp(offset, 0, maxX), y: area.y + maxY };
  return { x: area.x + maxX, y: area.y + clamp(offset, 0, maxY) };
}

export function monitorToWorkArea(monitor) {
  const scaleFactor = normalizeScaleFactor(monitor?.scaleFactor);
  const position = monitor?.workArea?.position || {};
  const size = monitor?.workArea?.size || {};
  return {
    x: (Number(position.x) || 0) / scaleFactor,
    y: (Number(position.y) || 0) / scaleFactor,
    width: (Number(size.width) || 0) / scaleFactor,
    height: (Number(size.height) || 0) / scaleFactor,
    scaleFactor,
  };
}

export function physicalToDipPosition(position, scaleFactor) {
  const factor = normalizeScaleFactor(scaleFactor);
  return {
    x: (Number(position?.x) || 0) / factor,
    y: (Number(position?.y) || 0) / factor,
  };
}

export function dipToPhysicalPosition(position, scaleFactor) {
  const factor = normalizeScaleFactor(scaleFactor);
  return {
    x: Math.round((Number(position?.x) || 0) * factor),
    y: Math.round((Number(position?.y) || 0) * factor),
  };
}

export function dipToPhysicalSize(size, scaleFactor) {
  const factor = normalizeScaleFactor(scaleFactor);
  return {
    width: Math.round((Number(size?.width) || 0) * factor),
    height: Math.round((Number(size?.height) || 0) * factor),
  };
}

function distanceToRect(cursor, bounds) {
  const horizontal = Math.max(bounds.left - cursor.x, 0, cursor.x - bounds.right);
  const vertical = Math.max(bounds.top - cursor.y, 0, cursor.y - bounds.bottom);
  return Math.hypot(horizontal, vertical);
}

function normalizeWorkArea(workArea) {
  return {
    x: Number(workArea?.x) || 0,
    y: Number(workArea?.y) || 0,
    width: Math.max(0, Number(workArea?.width) || 0),
    height: Math.max(0, Number(workArea?.height) || 0),
  };
}

function normalizeScaleFactor(scaleFactor) {
  return Number(scaleFactor) > 0 ? Number(scaleFactor) : 1;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, Number.isFinite(value) ? value : minimum));
}
