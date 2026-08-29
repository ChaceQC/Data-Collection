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
});

export function getPreviewStatusLabel(status) {
  return PREVIEW_STATUS_LABELS[status] || "预览状态未知";
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
