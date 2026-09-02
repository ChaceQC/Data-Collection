export const OPERATION_HISTORY_LIMIT = 100;

export const OPERATION_STATUSES = Object.freeze([
  "in-progress",
  "success",
  "partial-success",
  "failed",
  "cancelled",
  "timed-out",
]);

export const OPERATION_LABELS = Object.freeze({
  import: "导入资料",
  "recursive-import": "递归导入资料",
  refresh: "刷新索引",
  favorite: "更新收藏",
  tags: "更新标签",
  group: "更新分组",
  rename: "重命名资料",
  "index-remove": "移除索引",
  "batch-favorite": "批量收藏",
  "batch-tags": "批量标签",
  "batch-group": "批量分组",
  "batch-remove-index": "批量移除索引",
  undo: "撤销索引操作",
});

export const OPERATION_STATUS_LABELS = Object.freeze({
  "in-progress": "进行中",
  success: "已完成",
  "partial-success": "部分完成",
  failed: "失败",
  cancelled: "已取消",
  "timed-out": "已超时",
});

export function createOperationId(prefix = "operation") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createOperationRecord({ id, operation, totalCount = 0, request = null, startedAt = Date.now() }) {
  return {
    id,
    operation,
    status: "in-progress",
    startedAt,
    finishedAt: null,
    totalCount,
    addedCount: 0,
    updatedCount: 0,
    invalidCount: 0,
    recoveredCount: 0,
    successCount: 0,
    skippedCount: 0,
    failedCount: 0,
    results: [],
    retryableIds: [],
    skippedReasons: [],
    truncated: false,
    cancelled: false,
    timedOut: false,
    message: null,
    request,
  };
}

export function completeOperationRecord(current, patch = {}) {
  const next = {
    ...current,
    ...patch,
    results: Array.isArray(patch.results) ? patch.results : current.results,
    skippedReasons: Array.isArray(patch.skippedReasons) ? patch.skippedReasons : current.skippedReasons,
    retryableIds: Array.isArray(patch.retryableIds) ? patch.retryableIds : current.retryableIds,
    finishedAt: patch.finishedAt ?? Date.now(),
  };
  if (!patch.status) next.status = getOperationStatus(next);
  return normalizeOperationRecord(next);
}

export function getOperationStatus(record) {
  if (record?.timedOut) return "timed-out";
  if (record?.cancelled) return "cancelled";
  if ((record?.failedCount || 0) > 0 && (record?.successCount || 0) === 0) return "failed";
  if (record?.failedCount > 0 || record?.truncated || (record?.skippedCount > 0 && record?.successCount > 0)) return "partial-success";
  return "success";
}

export function summarizeOperationItems(items) {
  const results = Array.isArray(items) ? items : [];
  const summary = results.reduce((counts, item) => {
    if (item?.status === "success") counts.successCount += 1;
    else if (item?.status === "failed") counts.failedCount += 1;
    else counts.skippedCount += 1;
    return counts;
  }, { successCount: 0, skippedCount: 0, failedCount: 0 });
  return {
    ...summary,
    totalCount: results.length,
    retryableIds: results.filter((item) => item?.status === "failed" || item?.reason === "用户已取消" || item?.reason === "批量操作超时").map((item) => item.id),
  };
}

export function normalizeOperationRecord(value) {
  const source = value || {};
  const results = Array.isArray(source.results) ? source.results.map((item) => ({
    id: item.id,
    status: item.status,
    reason: item.reason ?? null,
  })) : [];
  const summary = summarizeOperationItems(results);
  const status = OPERATION_STATUSES.includes(source.status) ? source.status : "failed";
  return {
    ...source,
    status,
    finishedAt: source.finishedAt ?? null,
    totalCount: Number.isSafeInteger(source.totalCount) ? source.totalCount : Math.max(summary.totalCount, 0),
    addedCount: Number.isSafeInteger(source.addedCount) ? source.addedCount : 0,
    updatedCount: Number.isSafeInteger(source.updatedCount) ? source.updatedCount : 0,
    invalidCount: Number.isSafeInteger(source.invalidCount) ? source.invalidCount : 0,
    recoveredCount: Number.isSafeInteger(source.recoveredCount) ? source.recoveredCount : 0,
    successCount: Number.isSafeInteger(source.successCount) ? source.successCount : summary.successCount,
    skippedCount: Number.isSafeInteger(source.skippedCount) ? source.skippedCount : summary.skippedCount,
    failedCount: Number.isSafeInteger(source.failedCount) ? source.failedCount : summary.failedCount,
    results,
    retryableIds: Array.isArray(source.retryableIds) ? [...source.retryableIds] : summary.retryableIds,
    skippedReasons: Array.isArray(source.skippedReasons) ? [...source.skippedReasons] : [],
    truncated: source.truncated === true,
    cancelled: source.cancelled === true,
    timedOut: source.timedOut === true,
    message: source.message ?? null,
    request: source.request ?? null,
  };
}

export function upsertOperationRecord(records, record) {
  const normalized = normalizeOperationRecord(record);
  const next = Array.isArray(records) ? records.filter((item) => item?.id !== normalized.id) : [];
  next.unshift(normalized);
  next.sort((left, right) => (right.startedAt || 0) - (left.startedAt || 0));
  return next.slice(0, OPERATION_HISTORY_LIMIT);
}

export function getOperationLabel(operation) {
  return OPERATION_LABELS[operation] || "本地操作";
}

export function getOperationStatusLabel(status) {
  return OPERATION_STATUS_LABELS[status] || "状态未知";
}

export function getOperationSummary(record) {
  if (!record) return "";
  if (record.status === "in-progress") return record.totalCount ? `正在处理 ${record.totalCount} 项` : "正在处理";
  if (record.operation === "import" || record.operation === "recursive-import") {
    const details = [`新增 ${record.addedCount} 项`, `更新 ${record.updatedCount} 项`];
    if (record.skippedCount) details.push(`跳过 ${record.skippedCount} 项`);
    if (record.truncated) details.push("达到本次上限");
    return details.join("，");
  }
  if (record.operation === "refresh") {
    const details = [`更新 ${record.updatedCount || record.successCount} 项`];
    if (record.invalidCount) details.push(`失效 ${record.invalidCount} 项`);
    if (record.recoveredCount) details.push(`恢复 ${record.recoveredCount} 项`);
    return details.join("，");
  }
  if (record.operation === "undo") return `撤销 ${record.successCount} 项`;
  const details = [`成功 ${record.successCount} 项`];
  if (record.skippedCount) details.push(`跳过 ${record.skippedCount} 项`);
  if (record.failedCount) details.push(`失败 ${record.failedCount} 项`);
  return details.join("，");
}

export function getOperationResultName(item, files = []) {
  return files.find((file) => file.id === item?.id)?.name || "资料已移除或不可见";
}
