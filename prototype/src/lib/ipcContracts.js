import { invoke, isTauri } from "@tauri-apps/api/core";

export const IPC_COMMANDS = Object.freeze([
  "load_file_index", "list_directory", "reveal_directory_child", "index_paths", "import_folders_recursive", "refresh_index", "get_index_recovery",
  "reset_index_recovery", "export_index_diagnostic", "reposition_file", "set_favorite",
  "remove_index_entry", "copy_indexed_file", "open_indexed_file", "reveal_indexed_file",
  "rename_indexed_file", "delete_original_file", "set_entry_tags", "set_entry_group",
  "create_group", "rename_group", "delete_group", "batch_set_favorite",
  "batch_remove_index_entries", "batch_update_tags", "batch_set_group", "cancel_batch_operation", "undo_last",
  "load_operation_history", "save_operation_record", "clear_operation_history",
  "load_settings", "update_settings",
  "floating_window_status", "retry_floating_ball", "tray_status", "get_floating_recent",
  "record_floating_paths", "open_main_from_floating", "load_floating_placement",
  "save_floating_placement", "set_floating_window_visible", "show_main_window", "exit_app",
  "can_preview", "load_preview", "dispose_preview", "cancel_preview_task",
]);

export const ENTRY_STATUS = Object.freeze({ registered: "已登记", invalid: "路径失效" });
export const PREVIEW_STATUSES = Object.freeze([
  "idle", "loading", "ready", "unsupported", "missing", "permission-denied",
  "too-large", "converter-missing", "parse-error", "cancelled", "timed-out",
]);

const OPERATION_MESSAGES = Object.freeze({
  "entry-not-found": "资料已不存在，请刷新索引",
  "invalid-id": "资料标识无效，请重新选择资料",
  "source-missing": "原文件已不存在，请先刷新或移除索引记录",
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
  "settings-conflict": "设置已在其他窗口更新，请检查后重新保存",
  "settings-invalid": "设置值无效，请恢复后重试",
  "settings-unavailable": "本地设置暂时不可用，请重试",
  "folder-not-supported": "此操作暂时只支持普通文件",
  "task-failed": "操作任务未完成，请重试",
  "recursive-root-invalid": "只能扫描可访问的普通文件夹，请重新选择",
  "recursive-root-missing": "选择的文件夹已不存在，请重新选择",
  "recursive-root-permission-denied": "没有访问所选文件夹的权限",
  "recursive-root-too-many": "一次最多扫描 8 个文件夹",
});

export class IpcContractError extends Error {
  constructor(message, command) {
    super(message);
    this.name = "IpcContractError";
    this.command = command;
  }
}

export function isDesktopRuntime() {
  return isTauri();
}

export function invokeCommand(command, args, validator = identity) {
  if (!IPC_COMMANDS.includes(command)) return Promise.reject(new IpcContractError("未知的 IPC command", command));
  const request = args === undefined ? invoke(command) : invoke(command, args);
  return Promise.resolve(request).then((value) => validator(value, command));
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

export function parsePreviewSupport(value, command = "can_preview") {
  const source = record(value, command);
  return { ...source, supported: boolean(source.supported, command, "supported"), kind: string(source.kind, command, "kind"), status: previewStatus(source.status, command), reason: source.reason == null ? null : string(source.reason, command, "reason") };
}

export function parsePreviewResult(value, command = "load_preview") {
  const source = record(value, command);
  return { ...source, previewId: source.previewId == null ? "" : string(source.previewId, command, "previewId"), kind: string(source.kind, command, "kind"), status: previewStatus(source.status, command), content: source.content == null ? null : record(source.content, command), byteLength: nonNegativeInteger(source.byteLength, command, "byteLength") };
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
  return { ...source, fileId: assertOpaqueId(source.fileId, "fileId") };
}

export function parseSettingsChangedEvent(value, command = "settings-changed") {
  const source = record(value, command);
  return { ...source, settings: parseSettings(source.settings, command), warning: source.warning == null ? null : string(source.warning, command, "warning") };
}

export function parseIndexEntry(value, command = "index-entry") {
  const source = record(value, command);
  const entry = { ...source, id: assertOpaqueId(source.id), name: string(source.name, command, "name"), kind: string(source.kind, command, "kind"), type: string(source.type ?? source.fileType, command, "type"), status: string(source.status, command, "status"), invalid: optionalBoolean(source.invalid, command, "invalid"), favorite: optionalBoolean(source.favorite, command, "favorite") };
  for (const field of ["size", "modifiedAt", "addedAt", "lastOpenedAt"]) if (source[field] != null) entry[field] = nonNegativeInteger(source[field], command, field);
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
  return { ...source, required: boolean(source.required, command, "required"), issue: string(source.issue, command, "issue"), backupCreated: boolean(source.backupCreated, command, "backupCreated"), pendingOperations: nonNegativeInteger(source.pendingOperations, command, "pendingOperations") };
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

function identity(value) {
  return value;
}
