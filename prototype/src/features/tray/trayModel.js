export const TRAY_STATIC_MENU_IDS = Object.freeze([
  "tray-open-main",
  "tray-toggle-floating",
  "tray-recent-tasks",
  "tray-open-settings",
  "tray-exit",
]);

export function sanitizeMenuLabel(value) {
  const source = typeof value === "string" ? value : "";
  const normalized = source
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return "未命名资料";
  return normalized.length <= 64 ? normalized : `${normalized.slice(0, 61)}...`;
}

export function getTrayTaskLabel(entry) {
  const label = sanitizeMenuLabel(entry?.name);
  return entry?.invalid ? `${label}（路径失效）` : label;
}

export function getFavoriteActionLabel(favorite) {
  return favorite ? "取消收藏" : "收藏";
}

export function parseTrayMenuId(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 160) return null;
  if (TRAY_STATIC_MENU_IDS.includes(value)) {
    return {
      trayOpenMain: value === "tray-open-main",
      trayToggleFloating: value === "tray-toggle-floating",
      trayOpenSettings: value === "tray-open-settings",
      trayExit: value === "tray-exit",
    };
  }
  for (const [prefix, action] of [
    ["tray-task-open:", "openTask"],
    ["tray-task-favorite:", "toggleFavorite"],
  ]) {
    if (!value.startsWith(prefix)) continue;
    const id = value.slice(prefix.length);
    if (!isOpaqueId(id)) return null;
    return { action, fileId: id };
  }
  return null;
}

function isOpaqueId(value) {
  return Boolean(
    value
    && value.length <= 96
    && !value.includes("/")
    && !value.includes("\\")
    && !value.includes(":")
    && !value.includes("..")
    && !/[\s\u0000-\u001f\u007f-\u009f]/.test(value),
  );
}
