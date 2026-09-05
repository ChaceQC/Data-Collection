import { invoke, isTauri } from "@tauri-apps/api/core";

export const IPC_COMMANDS = Object.freeze([
  "load_file_index", "list_directory", "reveal_directory_child", "index_paths", "import_folders_recursive", "refresh_index", "get_index_recovery",
  "reset_index_recovery", "export_index_diagnostic", "reposition_file", "set_favorite",
  "content_index_status", "search_content", "cancel_content_search", "rebuild_content_index", "clear_content_index", "cancel_content_index",
  "search_metadata",
  "remove_index_entry", "copy_indexed_file", "open_indexed_file", "reveal_indexed_file",
  "rename_indexed_file", "delete_original_file", "set_entry_tags", "set_entry_group",
  "create_group", "rename_group", "delete_group", "batch_set_favorite",
  "batch_remove_index_entries", "batch_update_tags", "batch_set_group", "cancel_batch_operation", "undo_last",
  "load_operation_history", "save_operation_record", "clear_operation_history",
  "load_settings", "update_settings",
  "floating_window_status", "retry_floating_ball", "tray_status", "get_floating_recent", "get_floating_files",
  "record_floating_paths", "open_main_from_floating", "load_floating_placement",
  "save_floating_placement", "set_floating_window_visible", "show_main_window", "exit_app",
  "can_preview", "load_preview", "dispose_preview", "cancel_preview_task", "record_preview_outcome",
]);

export const ENTRY_STATUS = Object.freeze({ registered: "已登记", invalid: "路径失效" });
export const PREVIEW_STATUSES = Object.freeze([
  "idle", "loading", "ready", "unsupported", "missing", "permission-denied",
  "too-large", "converter-missing", "parse-error", "cancelled", "timed-out",
]);
export const FLOATING_OPEN_ACTIONS = Object.freeze(["locate", "preview"]);
const METADATA_SEARCH_FIELDS = new Set(["name", "type", "status", "location", "tag", "group"]);
const MAX_METADATA_SEARCH_RESULTS = 20_000;
const MAX_METADATA_SEARCH_FIELD_CHARS = 4096;
const MAX_METADATA_SEARCH_RANGES = 64;

const OPERATION_MESSAGES = Object.freeze({
  "entry-not-found": "资料已不存在，请刷新索引",
  "file-busy": "该资料正在执行文件操作，请稍后重试",
  "reposition-not-needed": "资料已恢复或已重新定位，请刷新索引",
  "reposition-kind-mismatch": "所选路径类型不匹配，请按原资料选择文件或文件夹",
  "invalid-id": "资料标识无效，请重新选择资料",
  "source-missing": "原文件已不存在，请先刷新或移除索引记录",
  "source-changed": "原文件在操作前发生变化，请刷新索引后重试",
  "source-permission-denied": "没有访问原文件的权限",
  "source-invalid": "原文件路径不可用，请重新定位",
  "destination-invalid": "目标路径不可用，请重试",
  "duplicate-entry": "目标路径已经在资料库中",
  "partial-success": "文件操作已部分完成，请刷新索引确认状态",
  "storage-write": "本地索引无法写入，请检查磁盘空间和权限",
  "storage-unavailable": "本地索引暂时不可用，请重试",
  "index-recovery-required": "本地索引需要恢复，请使用页面中的恢复操作",
  "duplicate-group": "分组名称已经存在",
  "group-not-found": "分组已不存在，请刷新索引",
  "invalid-group-name": "分组名称无效，请使用不超过 64 个字符的名称",
  "invalid-tag": "标签无效，请使用不超过 32 个字符的名称",
  "batch-too-large": "一次选择的资料过多，请分批操作",
  "invalid-batch": "请先选择资料",
  "undo-unavailable": "撤销不可用，索引已经发生变化",
  "undo-conflict": "撤销目标已经发生变化，请先刷新索引",
  "invalid-preview-status": "预览状态无效，请重新打开资料",
  "preview-stale": "预览结果已过期，请重新打开资料",
  "invalid-content-query": "搜索表达式无效，请检查正则语法或缩短搜索内容",
  "invalid-metadata-query": "元数据搜索表达式无效，请检查正则语法、筛选条件或缩短搜索内容",
  "metadata-search-target-invalid": "当前文件夹内容无法搜索，请刷新后重试",
  "metadata-search-unavailable": "元数据搜索暂时不可用，请重试",
  "content-index-recovery-required": "正文索引损坏，请重建正文索引",
  "content-index-unavailable": "正文索引暂不可用，请重试或重建正文索引",
  "content-index-stale": "正文索引任务已过期，请重建后重试",
  "content-search-cancelled": "正文搜索已取消",
  "content-search-timeout": "正文搜索超时，请缩短表达式后重试",
  "content-search-busy": "正文搜索繁忙，请稍后重试",
  "settings-conflict": "设置已在其他窗口更新，请检查后重新保存",
  "settings-invalid": "设置值无效，请恢复后重试",
  "settings-unavailable": "本地设置暂时不可用，请重试",
  "folder-not-supported": "此操作暂时只支持普通文件",
  "task-failed": "操作任务未完成，请重试",
  "recursive-root-invalid": "只能扫描可访问的普通文件夹，请重新选择",
  "recursive-root-missing": "选择的文件夹已不存在，请重新选择",
  "recursive-root-permission-denied": "没有访问所选文件夹的权限",
  "recursive-root-too-many": "一次最多扫描 8 个文件夹",
  "invalid-floating-files-query": "文件库查询条件无效，请重试",
  "floating-files-unavailable": "文件库暂时无法读取，请重试",
});

export class IpcContractError extends Error {
  constructor(message, command) {
    super(message);
    this.name = "IpcContractError";
    this.command = command;
  }
}

export function parseTargetMutationResult(value, fileId, command) {
  const result = parseMutationResult(value, command);
  if (result.entry?.id !== fileId || result.changedIds.some((id) => id !== fileId)) {
    throw new IpcContractError("文件操作返回的资料标识不匹配", command);
  }
  return result;
}

export function isDesktopRuntime() {
  return isTauri();
}

export function invokeCommand(command, args, validator = identity) {
  if (!IPC_COMMANDS.includes(command)) return Promise.reject(new IpcContractError("未知的 IPC command", command));
  const request = args === undefined ? invoke(command) : invoke(command, args);
  return Promise.resolve(request)
    .then((value) => validator(value, command))
    .catch((error) => {
      throw parseCommandError(error, command);
    });
}

export function parseCommandError(value, command = "ipc") {
  if (value instanceof IpcContractError) return value;
  if (typeof value === "string") {
    return new IpcCommandError("command-failed", safeErrorMessage(value), true, "unknown", command);
  }
  if (!isRecord(value)) return new IpcContractError("IPC command 失败", command);
  const code = typeof value.code === "string" && /^[a-z0-9-]{1,64}$/.test(value.code)
    ? value.code
    : "command-failed";
  const message = safeErrorMessage(value.message);
  const retryable = typeof value.retryable === "boolean" ? value.retryable : true;
  const state = ["unchanged", "updated", "partial", "unknown"].includes(value.state)
    ? value.state
    : "unknown";
  return new IpcCommandError(code, message, retryable, state, command);
}

export class IpcCommandError extends Error {
  constructor(code, message, retryable, state, command) {
    super(message);
    this.name = "IpcCommandError";
    this.code = code;
    this.retryable = retryable;
    this.state = state;
    this.command = command;
  }
}

export function getOperationError(error, fallback) {
  const code = typeof error?.code === "string" ? error.code : "";
  if (OPERATION_MESSAGES[code]) return OPERATION_MESSAGES[code];
  const message = typeof error === "string" ? error : error?.message;
  if (typeof message === "string" && message.length > 0 && message.length <= 180 && !/[\r\n]/.test(message)) return message;
  return fallback;
}

export function getPreviewTarget(entry) {
  if (entry?.directoryId && Array.isArray(entry.relativePath)) {
    return { directoryId: assertOpaqueId(entry.directoryId, "directoryId"), relativePath: normalizeRelativePath(entry.relativePath) };
  }
  return { fileId: assertOpaqueId(entry?.id, "fileId") };
}

export function makeDirectoryTarget(directoryId, relativePath = []) {
  return { directoryId: assertOpaqueId(directoryId, "directoryId"), relativePath: normalizeRelativePath(relativePath) };
}

export function parseIndexSnapshot(value, command = "load_file_index") {
  if (Array.isArray(value)) return { entries: value.map((entry) => parseIndexEntry(entry, command)), groups: [], revision: 0, recovery: null, undo: null };
  const source = record(value, command);
  return {
    ...source,
    entries: array(source.entries, command).map((entry) => parseIndexEntry(entry, command)),
    groups: array(source.groups ?? [], command).map((group) => parseGroup(group, command)),
    revision: nonNegativeInteger(source.revision, command, "revision"),
    recovery: source.recovery == null ? null : parseRecovery(source.recovery, command),
    undo: source.undo == null ? null : parseUndoStatus(source.undo, command),
  };
}

export function parseDirectoryEntries(value, command = "list_directory") {
  return array(value, command).map((entry) => {
    const parsed = parseIndexEntry(entry, command);
    if (!isRecord(entry) || !Array.isArray(entry.relativePath) || typeof entry.directoryId !== "string") throw contractError(command, "目录条目缺少安全路径身份");
    return { ...parsed, directoryId: assertOpaqueId(entry.directoryId, "directoryId"), relativePath: normalizeRelativePath(entry.relativePath) };
  });
}

export function parseIndexImportResult(value, command = "index_paths") {
  const source = record(value, command);
  return {
    ...source,
    revision: nonNegativeInteger(source.revision, command, "revision"),
    indexedCount: nonNegativeInteger(source.indexedCount, command, "indexedCount"),
    refreshedCount: nonNegativeInteger(source.refreshedCount, command, "refreshedCount"),
    skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"),
    skippedReasons: stringArray(source.skippedReasons, command, "skippedReasons"),
    truncated: boolean(source.truncated, command, "truncated"),
    addedIds: opaqueIdArray(source.addedIds, command, "addedIds"),
  };
}

export function parseRecursiveImportResult(value, command = "import_folders_recursive") {
  const source = record(value, command);
  return {
    ...source,
    operationId: assertOpaqueId(source.operationId, "operationId"),
    revision: nonNegativeInteger(source.revision, command, "revision"),
    scannedCount: nonNegativeInteger(source.scannedCount, command, "scannedCount"),
    candidateCount: nonNegativeInteger(source.candidateCount, command, "candidateCount"),
    indexedCount: nonNegativeInteger(source.indexedCount, command, "indexedCount"),
    refreshedCount: nonNegativeInteger(source.refreshedCount, command, "refreshedCount"),
    skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"),
    skippedReasons: stringArray(source.skippedReasons, command, "skippedReasons"),
    truncated: boolean(source.truncated, command, "truncated"),
    cancelled: boolean(source.cancelled, command, "cancelled"),
    timedOut: boolean(source.timedOut, command, "timedOut"),
    addedIds: opaqueIdArray(source.addedIds, command, "addedIds"),
  };
}

export function parseRecursiveImportProgress(value, command = "recursive-import-progress") {
  const source = record(value, command);
  const phase = string(source.phase, command, "phase");
  if (!["scanning", "merging", "completed", "failed"].includes(phase)) throw contractError(command, "递归导入进度阶段无效");
  const currentName = source.currentName == null ? null : string(source.currentName, command, "currentName");
  if (currentName && (currentName.length > 255 || /[\\/\u0000-\u001f\u007f-\u009f]/.test(currentName))) throw contractError(command, "递归导入当前名称无效");
  return {
    ...source,
    operationId: assertOpaqueId(source.operationId, "operationId"),
    phase,
    scannedCount: nonNegativeInteger(source.scannedCount, command, "scannedCount"),
    candidateCount: nonNegativeInteger(source.candidateCount, command, "candidateCount"),
    acceptedCount: nonNegativeInteger(source.acceptedCount, command, "acceptedCount"),
    skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"),
    currentName,
    truncated: boolean(source.truncated, command, "truncated"),
    cancelled: boolean(source.cancelled, command, "cancelled"),
    timedOut: boolean(source.timedOut, command, "timedOut"),
  };
}

export function parseMutationResult(value, command = "mutation") {
  const source = record(value, command);
  return {
    ...source,
    revision: nonNegativeInteger(source.revision, command, "revision"),
    changedIds: opaqueIdArray(source.changedIds, command, "changedIds"),
    entry: source.entry == null ? null : parseIndexEntry(source.entry, command),
  };
}

export function parseGroupMutationResult(value, command = "group-mutation") {
  const source = record(value, command);
  return {
    ...source,
    revision: nonNegativeInteger(source.revision, command, "revision"),
    changedIds: opaqueIdArray(source.changedIds, command, "changedIds"),
    group: source.group == null ? null : parseGroup(source.group, command),
  };
}

export function parseBatchMutationResult(value, command = "batch-mutation") {
  const source = record(value, command);
  const results = array(source.results, command).map((item) => {
    const result = record(item, command);
    if (!isBatchStatus(result.status)) throw contractError(command, "批量结果状态无效");
    return {
      ...result,
      id: assertOpaqueId(result.id),
      status: result.status,
      reason: result.reason == null ? null : string(result.reason, command, "reason"),
    };
  });
  return {
    ...source,
    operationId: assertOpaqueId(source.operationId, "operationId"),
    revision: nonNegativeInteger(source.revision, command, "revision"),
    changedIds: opaqueIdArray(source.changedIds, command, "changedIds"),
    operation: string(source.operation, command, "operation"),
    results,
    cancelled: boolean(source.cancelled, command, "cancelled"),
    timedOut: boolean(source.timedOut, command, "timedOut"),
  };
}

export function parseIndexRefreshResult(value, command = "refresh_index") {
  const source = record(value, command);
  return {
    ...source,
    revision: nonNegativeInteger(source.revision, command, "revision"),
    changedIds: stringArray(source.changedIds, command, "changedIds"),
    changedCount: nonNegativeInteger(source.changedCount, command, "changedCount"),
    invalidCount: nonNegativeInteger(source.invalidCount, command, "invalidCount"),
    recoveredCount: nonNegativeInteger(source.recoveredCount, command, "recoveredCount"),
  };
}

export function parseContentIndexStatus(value, command = "content_index_status") {
  const source = record(value, command);
  if (!["ready", "indexing", "recovery", "unavailable"].includes(source.state)) {
    throw contractError(command, "正文索引状态无效");
  }
  return {
    ...source,
    state: string(source.state, command, "state"),
    indexedCount: nonNegativeInteger(source.indexedCount, command, "indexedCount"),
    totalBytes: nonNegativeInteger(source.totalBytes, command, "totalBytes"),
    failedCount: nonNegativeInteger(source.failedCount, command, "failedCount"),
    sourceRevision: nonNegativeInteger(source.sourceRevision, command, "sourceRevision"),
    cacheRevision: nonNegativeInteger(source.cacheRevision, command, "cacheRevision"),
    lastError: source.lastError == null ? null : string(source.lastError, command, "lastError"),
  };
}

export function parseMetadataSearchResponse(value, command = "search_metadata") {
  const source = record(value, command);
  if ("path" in source || "content" in source) throw contractError(command, "元数据搜索返回了禁止字段");
  const revision = nonNegativeInteger(source.revision, command, "revision");
  const matchedIds = opaqueIdArray(source.matchedIds, command, "matchedIds");
  const matchedIdSet = new Set(matchedIds);
  if (matchedIdSet.size !== matchedIds.length || matchedIds.length > MAX_METADATA_SEARCH_RESULTS) {
    throw contractError(command, "元数据搜索 ID 结果无效");
  }
  const total = nonNegativeInteger(source.total, command, "total");
  if (total > MAX_METADATA_SEARCH_RESULTS || matchedIds.length > total) {
    throw contractError(command, "元数据搜索统计无效");
  }
  const truncated = boolean(source.truncated, command, "truncated");
  if (truncated !== (matchedIds.length < total)) {
    throw contractError(command, "元数据搜索截断状态无效");
  }
  const rawHits = array(source.hits, command);
  if (rawHits.length > MAX_METADATA_SEARCH_RESULTS) {
    throw contractError(command, "元数据命中结果过多");
  }
  const hits = rawHits.map((item) => {
    const hit = record(item, command);
    if ("path" in hit || "value" in hit || "content" in hit) {
      throw contractError(command, "元数据命中包含禁止字段");
    }
    const fileId = assertOpaqueId(hit.fileId, "fileId");
    const field = string(hit.field, command, "field");
    if (!METADATA_SEARCH_FIELDS.has(field)) throw contractError(command, "元数据命中字段无效");
    const ranges = array(hit.ranges, command).map((range) => {
      const itemRange = record(range, command);
      const start = nonNegativeInteger(itemRange.start, command, "start");
      const end = nonNegativeInteger(itemRange.end, command, "end");
      if (start >= end || end > MAX_METADATA_SEARCH_FIELD_CHARS) {
        throw contractError(command, "元数据高亮范围无效");
      }
      return { start, end };
    });
    if (ranges.length > MAX_METADATA_SEARCH_RANGES) {
      throw contractError(command, "元数据高亮范围过多");
    }
    return { fileId, field, ranges };
  });
  const hitIdSet = new Set(hits.map((hit) => hit.fileId));
  if (hitIdSet.size !== hits.length || hits.some((hit) => !matchedIdSet.has(hit.fileId))) {
    throw contractError(command, "元数据命中结果无效");
  }
  return { revision, matchedIds, hits, total, truncated };
}

export function parseContentSearchResponse(value, command = "search_content") {
  const source = record(value, command);
  return {
    ...source,
    requestId: assertOpaqueId(source.requestId, "requestId"),
    status: parseContentIndexStatus(source.status, command),
    results: array(source.results, command).map((item) => {
      const result = record(item, command);
      return {
        ...result,
        fileId: assertOpaqueId(result.fileId, "fileId"),
        matchCount: nonNegativeInteger(result.matchCount, command, "matchCount"),
        matchesTruncated: boolean(result.matchesTruncated, command, "matchesTruncated"),
        snippets: array(result.snippets, command).map((snippet) => parseContentSnippet(snippet, command)),
      };
    }),
  };
}

export function parseContentIndexRebuildResult(value, command = "rebuild_content_index") {
  const source = record(value, command);
  return {
    ...source,
    operationId: assertOpaqueId(source.operationId, "operationId"),
    revision: nonNegativeInteger(source.revision, command, "revision"),
    indexedCount: nonNegativeInteger(source.indexedCount, command, "indexedCount"),
    updatedCount: nonNegativeInteger(source.updatedCount, command, "updatedCount"),
    removedCount: nonNegativeInteger(source.removedCount, command, "removedCount"),
    skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"),
    skippedReasons: stringArray(source.skippedReasons, command, "skippedReasons"),
    cancelled: boolean(source.cancelled, command, "cancelled"),
    timedOut: boolean(source.timedOut, command, "timedOut"),
    status: parseContentIndexStatus(source.status, command),
  };
}

export function parsePreviewSupport(value, command = "can_preview") {
  const source = record(value, command);
  return { ...source, supported: boolean(source.supported, command, "supported"), kind: string(source.kind, command, "kind"), status: previewStatus(source.status, command), indexRevision: nonNegativeInteger(source.indexRevision ?? 0, command, "indexRevision"), reason: previewReason(source.reason, command) };
}

export function makePreviewOutcomeArgs(fileId, status, outcomeToken) {
  const command = "record_preview_outcome";
  if (!PREVIEW_STATUSES.includes(status) || status === "idle" || status === "loading") {
    throw contractError(command, "预览终态无效");
  }
  if (typeof outcomeToken !== "string" || !/^outcome-[a-f0-9]{32}$/.test(outcomeToken)) {
    throw contractError(command, "预览凭证无效");
  }
  return { fileId: assertOpaqueId(fileId, "fileId"), status, outcomeToken };
}

export function parsePreviewResult(value, command = "load_preview") {
  const source = record(value, command);
  const status = previewStatus(source.status, command);
  if (source.outcomeToken !== null && (typeof source.outcomeToken !== "string"
    || !/^outcome-[a-f0-9]{32}$/.test(source.outcomeToken))) throw contractError(command, "预览凭证无效");
  const byteLength = nonNegativeInteger(source.byteLength, command, "byteLength");
  const content = source.content == null ? null : parsePreviewContent(source.content, command, byteLength);
  if ((status === "ready") !== Boolean(content)) throw contractError(command, "预览结果内容与状态不一致");
  return { ...source, previewId: parsePreviewId(source.previewId, command), kind: string(source.kind, command, "kind"), status, indexRevision: nonNegativeInteger(source.indexRevision ?? 0, command, "indexRevision"), content, byteLength, reason: previewReason(source.reason, command) };
}

function parsePreviewContent(value, command, resultByteLength) {
  const source = record(value, command);
  const type = string(source.type, command, "content.type");
  if (type === "text") {
    const encoding = string(source.encoding, command, "content.encoding");
    if (!["utf-8", "utf-8-bom", "gb18030"].includes(encoding)) throw contractError(command, "预览文本编码无效");
    return { ...source, type, value: string(source.value, command, "content.value"), encoding, language: source.language == null ? null : string(source.language, command, "content.language") };
  }
  if (type === "resource" || type === "convertedPdf") {
    const resourceUrl = parsePreviewResourceUrl(source.resourceUrl, command);
    const mediaType = string(source.mediaType, command, "content.mediaType");
    if (!mediaType || mediaType.length > 128 || /[\u0000-\u001f\u007f-\u009f]/.test(mediaType)) throw contractError(command, "预览资源 MIME 无效");
    const byteLength = nonNegativeInteger(source.byteLength, command, "content.byteLength");
    if (byteLength !== resultByteLength) throw contractError(command, "预览资源大小与结果不一致");
    const parsed = {
      ...source,
      type,
      resourceUrl,
      mediaType,
      byteLength,
      supportsRange: boolean(source.supportsRange, command, "content.supportsRange"),
    };
    if (type === "convertedPdf") {
      if (source.sourceKind !== "doc") throw contractError(command, "转换 PDF 来源格式无效");
      return { ...parsed, sourceKind: "doc" };
    }
    for (const field of ["width", "height"]) {
      if (source[field] != null) parsed[field] = positiveInteger(source[field], command, `content.${field}`);
    }
    return parsed;
  }
  throw contractError(command, "预览内容类型无效");
}

function parsePreviewId(value, command) {
  if (value == null || value === "") return "";
  const id = string(value, command, "previewId");
  if (!/^preview-[0-9a-f]{32}$/i.test(id)) throw contractError(command, "预览资源标识无效");
  return id;
}

function parsePreviewResourceUrl(value, command) {
  const resourceUrl = string(value, command, "content.resourceUrl");
  if (!/^(?:preview:\/\/localhost|https?:\/\/preview\.localhost)\/preview-[0-9a-f]{32}$/i.test(resourceUrl)) {
    throw contractError(command, "预览资源地址无效");
  }
  return resourceUrl;
}

function previewReason(value, command) {
  if (value == null) return null;
  const reason = string(value, command, "reason");
  if (!reason || reason.length > 180 || /[\r\n]/.test(reason)) throw contractError(command, "预览失败原因无效");
  return reason;
}

export function parseSettings(value, command = "settings") {
  const source = record(value, command);
  return { ...source, revision: nonNegativeInteger(source.revision ?? 0, command, "revision") };
}

export function parseOperationHistory(value, command = "load_operation_history") {
  const source = record(value, command);
  return {
    ...source,
    records: array(source.records, command).map((item) => parseOperationRecord(item, command)),
    warning: source.warning == null ? null : string(source.warning, command, "warning"),
  };
}

export function parseOperationRecord(value, command = "save_operation_record") {
  const source = record(value, command);
  const results = array(source.results ?? [], command).map((item) => {
    const result = record(item, command);
    if (!isBatchStatus(result.status)) throw contractError(command, "操作结果状态无效");
    return {
      ...result,
      id: assertOpaqueId(result.id, "operationItemId"),
      status: result.status,
      reason: result.reason == null ? null : string(result.reason, command, "reason"),
    };
  });
  return {
    ...source,
    id: assertOpaqueId(source.id, "operationId"),
    operation: string(source.operation, command, "operation"),
    status: operationStatus(source.status, command),
    startedAt: nonNegativeInteger(source.startedAt, command, "startedAt"),
    finishedAt: source.finishedAt == null ? null : nonNegativeInteger(source.finishedAt, command, "finishedAt"),
    totalCount: nonNegativeInteger(source.totalCount, command, "totalCount"),
    addedCount: nonNegativeInteger(source.addedCount, command, "addedCount"),
    updatedCount: nonNegativeInteger(source.updatedCount, command, "updatedCount"),
    invalidCount: nonNegativeInteger(source.invalidCount ?? 0, command, "invalidCount"),
    recoveredCount: nonNegativeInteger(source.recoveredCount ?? 0, command, "recoveredCount"),
    successCount: nonNegativeInteger(source.successCount, command, "successCount"),
    skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"),
    failedCount: nonNegativeInteger(source.failedCount, command, "failedCount"),
    results,
    retryableIds: opaqueIdArray(source.retryableIds ?? [], command, "retryableIds"),
    skippedReasons: stringArray(source.skippedReasons ?? [], command, "skippedReasons"),
    truncated: boolean(source.truncated, command, "truncated"),
    cancelled: boolean(source.cancelled, command, "cancelled"),
    timedOut: boolean(source.timedOut, command, "timedOut"),
    message: source.message == null ? null : string(source.message, command, "message"),
    request: source.request == null ? null : parseOperationRequest(source.request, command),
  };
}

export function parseFloatingRecentResult(value, command = "get_floating_recent") {
  const source = Array.isArray(value) ? { revision: 0, recent: value } : record(value, command);
  return {
    ...source,
    revision: nonNegativeInteger(source.revision, command, "revision"),
    recent: array(source.recent, command).map((entry) => {
      const parsed = record(entry, command);
      return { ...parsed, id: assertOpaqueId(parsed.id), name: string(parsed.name, command, "name"), kind: string(parsed.kind, command, "kind"), recordedAt: positiveInteger(parsed.recordedAt, command, "recordedAt"), favorite: optionalBoolean(parsed.favorite, command, "favorite"), invalid: optionalBoolean(parsed.invalid, command, "invalid") };
    }),
  };
}

export function parseFloatingFilesResult(value, command = "get_floating_files") {
  const source = record(value, command);
  if ("path" in source || "content" in source) throw contractError(command, "文件库返回了禁止字段");
  const revision = nonNegativeInteger(source.revision, command, "revision");
  const total = nonNegativeInteger(source.total, command, "total");
  const offset = nonNegativeInteger(source.offset, command, "offset");
  const limit = nonNegativeInteger(source.limit, command, "limit");
  if (total > 20_000 || offset > 20_000 || limit < 1 || limit > 100) throw contractError(command, "文件库分页字段无效");
  const items = array(source.items, command).map((item) => {
    const parsed = record(item, command);
    if ("path" in parsed || "content" in parsed || "recordedAt" in parsed) {
      throw contractError(command, "文件库条目包含禁止字段");
    }
    const requiredFields = ["id", "name", "type", "kind", "status", "invalid", "favorite", "size", "modifiedAt", "lastOpenedAt", "groupId", "groupName"];
    if (requiredFields.some((field) => !Object.prototype.hasOwnProperty.call(parsed, field))) {
      throw contractError(command, "文件库条目字段不完整");
    }
    const kind = parsed.kind;
    if (!(kind === "file" || kind === "folder" || kind === "other")) {
      throw contractError(command, "kind 字段无效");
    }
    return {
      id: assertOpaqueId(parsed.id),
      name: string(parsed.name, command, "name"),
      type: string(parsed.type, command, "type"),
      kind,
      status: string(parsed.status, command, "status"),
      invalid: boolean(parsed.invalid, command, "invalid"),
      favorite: boolean(parsed.favorite, command, "favorite"),
      size: nullableNonNegativeInteger(parsed.size, command, "size"),
      modifiedAt: nullableNonNegativeInteger(parsed.modifiedAt, command, "modifiedAt"),
      lastOpenedAt: nullableNonNegativeInteger(parsed.lastOpenedAt, command, "lastOpenedAt"),
      groupId: parsed.groupId == null ? null : assertOpaqueId(parsed.groupId, "groupId"),
      groupName: parsed.groupName == null ? null : string(parsed.groupName, command, "groupName"),
    };
  });
  const ids = new Set(items.map((item) => item.id));
  if (ids.size !== items.length || items.length > limit) throw contractError(command, "文件库分页结果无效");
  const hasMore = boolean(source.hasMore, command, "hasMore");
  if (hasMore !== offset + items.length < total) {
    throw contractError(command, "hasMore 字段无效");
  }
  return { revision, items, total, offset, limit, hasMore };
}

export function parseFloatingRecordResult(value, command = "record_floating_paths") {
  const source = parseFloatingRecentResult(value, command);
  return { ...source, indexedCount: nonNegativeInteger(source.indexedCount, command, "indexedCount"), refreshedCount: nonNegativeInteger(source.refreshedCount, command, "refreshedCount"), recordedCount: nonNegativeInteger(source.recordedCount, command, "recordedCount"), skippedCount: nonNegativeInteger(source.skippedCount, command, "skippedCount"), skippedReasons: stringArray(source.skippedReasons, command, "skippedReasons"), truncated: boolean(source.truncated, command, "truncated") };
}

export function parseWindowStatus(value, command = "floating_window_status") {
  const source = record(value, command);
  return { ...source, visible: boolean(source.visible, command, "visible"), available: boolean(source.available, command, "available"), error: source.error == null ? null : string(source.error, command, "error") };
}

export function parseTrayStatus(value, command = "tray_status") {
  const source = record(value, command);
  return { ...source, available: boolean(source.available, command, "available"), error: source.error == null ? null : string(source.error, command, "error") };
}

export function parseIndexChangedEvent(value, command = "index-changed") {
  const source = record(value, command);
  return { ...source, revision: nonNegativeInteger(source.revision, command, "revision"), ids: opaqueIdArray(source.ids, command, "ids"), changeType: string(source.changeType, command, "changeType") };
}

export function parseRevisionEvent(value, command = "revision-event") {
  const source = record(value, command);
  return { ...source, revision: nonNegativeInteger(source.revision, command, "revision") };
}

export function parseFloatingOpenEvent(value, command = "floating-open-file") {
  const source = record(value, command);
  const action = source.action == null ? "locate" : string(source.action, command, "action");
  if (!FLOATING_OPEN_ACTIONS.includes(action)) throw contractError(command, "悬浮球打开动作无效");
  return { ...source, fileId: assertOpaqueId(source.fileId, "fileId"), action };
}

export function parseExternalOpenResult(value, command = "external-open") {
  const source = record(value, command);
  return { ...source, name: string(source.name, command, "name") };
}

export function normalizeFloatingOpenAction(value = "locate") {
  if (!FLOATING_OPEN_ACTIONS.includes(value)) throw new TypeError("悬浮球打开动作无效");
  return value;
}

export function parseSettingsChangedEvent(value, command = "settings-changed") {
  const source = record(value, command);
  return { ...source, settings: parseSettings(source.settings, command), warning: source.warning == null ? null : string(source.warning, command, "warning") };
}

export function parseIndexEntry(value, command = "index-entry") {
  const source = record(value, command);
  const entry = { ...source, id: assertOpaqueId(source.id), name: string(source.name, command, "name"), kind: string(source.kind, command, "kind"), type: string(source.type ?? source.fileType, command, "type"), status: string(source.status, command, "status"), invalid: optionalBoolean(source.invalid, command, "invalid"), favorite: optionalBoolean(source.favorite, command, "favorite") };
  for (const field of ["size", "modifiedAt", "addedAt", "lastOpenedAt"]) if (source[field] != null) entry[field] = nonNegativeInteger(source[field], command, field);
  entry.previewStatus = source.previewStatus == null ? "idle" : previewStatus(source.previewStatus, command);
  if (source.path != null && typeof source.path !== "string") throw contractError(command, "路径字段无效");
  entry.tags = stringArray(source.tags ?? [], command, "tags").map((tag) => {
    if (!tag.trim() || /[\u0000-\u001f\u007f-\u009f]/.test(tag)) throw contractError(command, "标签字段无效");
    return tag;
  });
  entry.groupId = source.groupId == null ? null : assertOpaqueId(source.groupId, "groupId");
  return entry;
}

function parseGroup(value, command) {
  const source = record(value, command);
  return { ...source, id: assertOpaqueId(source.id, "groupId"), name: string(source.name, command, "name") };
}

function parseUndoStatus(value, command) {
  const source = record(value, command);
  return {
    ...source,
    id: assertOpaqueId(source.id, "undoId"),
    operation: string(source.operation, command, "operation"),
    count: nonNegativeInteger(source.count, command, "count"),
  };
}

function parseOperationRequest(value, command) {
  const source = record(value, command);
  const tags = stringArray(source.tags ?? [], command, "tags");
  if (tags.some((tag) => !tag.trim() || tag.length > 32 || /[\u0000-\u001f\u007f-\u009f]/.test(tag))) {
    throw contractError(command, "操作标签参数无效");
  }
  return {
    ...source,
    favorite: source.favorite == null ? null : boolean(source.favorite, command, "favorite"),
    tags,
    add: source.add == null ? null : boolean(source.add, command, "add"),
    groupId: source.groupId == null ? null : assertOpaqueId(source.groupId, "groupId"),
  };
}

export function assertOpaqueId(value, field = "id") {
  if (typeof value !== "string" || value.length === 0 || value.length > 96 || /[\\/:\s]|\.\.|[\u0000-\u001f\u007f-\u009f]/.test(value)) throw new TypeError(`${field} 无效`);
  return value;
}

function normalizeRelativePath(value) {
  if (!Array.isArray(value) || value.length > 128 || value.some((part) => typeof part !== "string" || !part || part === "." || part === ".." || /[\\/\u0000-\u001f\u007f-\u009f]/.test(part))) throw new TypeError("相对路径无效");
  return [...value];
}

function parseRecovery(value, command) {
  const source = record(value, command);
  const pendingOperations = nonNegativeInteger(source.pendingOperations, command, "pendingOperations");
  const pendingFileIds = source.pendingFileIds == null ? [] : array(source.pendingFileIds, command).map((id) => assertOpaqueId(id, "pendingFileId"));
  if (pendingFileIds.length > 500 || (source.pendingFileIds != null && pendingFileIds.length !== pendingOperations)) throw contractError(command, "待核对操作数量不匹配");
  return { ...source, required: boolean(source.required, command, "required"), issue: string(source.issue, command, "issue"), backupCreated: boolean(source.backupCreated, command, "backupCreated"), pendingOperations, pendingFileIds, indexBlocked: source.indexBlocked == null ? pendingOperations === 0 : boolean(source.indexBlocked, command, "indexBlocked") };
}

function parseContentSnippet(value, command) {
  const source = record(value, command);
  const textValue = string(source.text, command, "text");
  const characterCount = Array.from(textValue).length;
  if (characterCount > 246) throw contractError(command, "正文摘要过长");
  let previousEnd = 0;
  const ranges = array(source.ranges, command).map((range) => {
    const item = record(range, command);
    const start = nonNegativeInteger(item.start, command, "start");
    const end = nonNegativeInteger(item.end, command, "end");
    if (start < previousEnd || start >= end || end > characterCount) throw contractError(command, "正文高亮范围无效");
    previousEnd = end;
    return { start, end };
  });
  return { ...source, text: textValue, ranges };
}

function record(value, command) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw contractError(command, "IPC 返回对象无效");
  return value;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function array(value, command) {
  if (!Array.isArray(value)) throw contractError(command, "IPC 返回数组无效");
  return value;
}

function string(value, command, field) {
  if (typeof value !== "string") throw contractError(command, `${field} 字段无效`);
  return value;
}

function stringArray(value, command, field) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) throw contractError(command, `${field} 字段无效`);
  return value;
}

function opaqueIdArray(value, command, field) {
  if (!Array.isArray(value)) throw contractError(command, `${field} 字段无效`);
  try {
    return value.map((item) => assertOpaqueId(item));
  } catch {
    throw contractError(command, `${field} 字段无效`);
  }
}

function nonNegativeInteger(value, command, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw contractError(command, `${field} 字段无效`);
  return value;
}

function nullableNonNegativeInteger(value, command, field) {
  return value == null ? null : nonNegativeInteger(value, command, field);
}

function positiveInteger(value, command, field) {
  if (!Number.isSafeInteger(value) || value <= 0) throw contractError(command, `${field} 字段无效`);
  return value;
}

function boolean(value, command, field) {
  if (typeof value !== "boolean") throw contractError(command, `${field} 字段无效`);
  return value;
}

function optionalBoolean(value, command, field) {
  return value == null ? false : boolean(value, command, field);
}

function isBatchStatus(value) {
  return value === "success" || value === "failed" || value === "skipped";
}

function operationStatus(value, command) {
  if (["in-progress", "success", "partial-success", "failed", "cancelled", "timed-out"].includes(value)) return value;
  throw contractError(command, "操作状态无效");
}

function previewStatus(value, command) {
  if (!PREVIEW_STATUSES.includes(value)) throw contractError(command, "预览状态无效");
  return value;
}

function contractError(command, message) {
  return new IpcContractError(message, command);
}

function safeErrorMessage(value) {
  if (typeof value !== "string" || value.length === 0 || value.length > 180 || /[\r\n]/.test(value)) {
    return "操作失败，请重试";
  }
  return value;
}

function identity(value) {
  return value;
}
