import manifest from "../../../shared/file-types.json" with { type: "json" };

const BYTES_PER_MIB = 1024 * 1024;

export const DOCX_SOURCE_BYTE_LIMIT = manifest.limits.office.maxBytes;
export const DOCX_HTML_BYTE_LIMIT = 8 * BYTES_PER_MIB;
export const DOCX_HTML_NODE_LIMIT = 50_000;
export const DOCX_CONVERSION_TIMEOUT_MS = 30_000;
export const DOCX_SANITIZE_BATCH_SIZE = 32;

const OPENING_TAG_PATTERN = /<\s*[a-z][a-z0-9:-]*(?:\s[^<>]*?)?\s*\/?>/gi;

export function getDocxHtmlByteLength(value) {
  const html = typeof value === "string" ? value : "";
  return new TextEncoder().encode(html).byteLength;
}

export function countDocxHtmlNodes(value) {
  const html = typeof value === "string" ? value : "";
  let count = 0;
  OPENING_TAG_PATTERN.lastIndex = 0;
  while (OPENING_TAG_PATTERN.exec(html)) count += 1;
  return count;
}

export function getDocxOutputMetrics(value) {
  const html = typeof value === "string" ? value : "";
  const byteLength = getDocxHtmlByteLength(html);
  const nodeCount = countDocxHtmlNodes(html);
  return {
    byteLength,
    nodeCount,
    withinLimits: byteLength <= DOCX_HTML_BYTE_LIMIT && nodeCount <= DOCX_HTML_NODE_LIMIT,
  };
}

export function getDocxOutputLimitReason(value) {
  const metrics = getDocxOutputMetrics(value);
  if (metrics.byteLength > DOCX_HTML_BYTE_LIMIT) {
    return "Word 文档转换结果超过 8 MiB 预览限制，请使用系统程序打开。";
  }
  if (metrics.nodeCount > DOCX_HTML_NODE_LIMIT) {
    return "Word 文档转换结果包含过多内容节点，已停止渲染，请使用系统程序打开。";
  }
  return null;
}

export function isPreviewAbortError(error) {
  return error?.name === "AbortError";
}
