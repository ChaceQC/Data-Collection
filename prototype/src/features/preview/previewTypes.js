export const PREVIEW_STATUSES = Object.freeze([
  "idle",
  "loading",
  "ready",
  "unsupported",
  "missing",
  "permission-denied",
  "too-large",
  "converter-missing",
  "parse-error",
  "cancelled",
]);

export const PREVIEW_STATUS_LABELS = Object.freeze({
  idle: "等待预览",
  loading: "正在读取预览",
  ready: "预览已就绪",
  unsupported: "暂不支持预览",
  missing: "文件已失效",
  "permission-denied": "没有读取权限",
  "too-large": "文件过大",
  "converter-missing": "缺少 DOC 转换器",
  "parse-error": "解析失败",
  cancelled: "已取消预览",
});

export function getPreviewStatusLabel(status, { demoOnly = false } = {}) {
  if (demoOnly) return "浏览器演示限制";
  return PREVIEW_STATUS_LABELS[status] || "预览状态未知";
}

export function getAdjacentPreviewEntries(entries, entryId) {
  const currentEntries = Array.isArray(entries) ? entries : [];
  const currentIndex = currentEntries.findIndex((entry) => entry?.id === entryId);
  if (currentIndex < 0) return { previous: null, next: null };
  return {
    previous: currentEntries[currentIndex - 1] || null,
    next: currentEntries[currentIndex + 1] || null,
  };
}

export function getPreviewFailureActions(status, { demoOnly = false, isDirectoryEntry = false } = {}) {
  if (demoOnly) return ["close"];
  if (isDirectoryEntry) {
    const actions = [];
    if (["permission-denied", "parse-error", "cancelled"].includes(status)) actions.push("retry");
    if (status !== "missing") actions.push("reveal");
    actions.push("close");
    return actions;
  }
  if (status === "missing") return ["reposition", "close"];
  if (status === "too-large" || status === "converter-missing") return ["open-default", "close"];
  if (status === "unsupported") return ["open-default", "reveal", "close"];
  if (["permission-denied", "parse-error", "cancelled"].includes(status)) {
    return ["retry", "open-default", "reveal", "close"];
  }
  return ["close"];
}

export function normalizePreviewResourceUrl(resourceUrl) {
  if (!resourceUrl || typeof window === "undefined") return resourceUrl || "";
  if (typeof navigator === "undefined" || !navigator.userAgent.includes("Windows NT")) return resourceUrl;
  try {
    const parsed = new URL(resourceUrl);
    if (parsed.protocol !== "preview:" || parsed.hostname !== "localhost") return resourceUrl;
    return `http://preview.localhost${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return resourceUrl;
  }
}

export function isPreviewFailure(status) {
  return status !== "ready";
}
