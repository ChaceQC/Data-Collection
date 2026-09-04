import assert from "node:assert/strict";
import test from "node:test";
import {
  IpcContractError,
  getOperationError,
  parseExternalOpenResult,
  parseFloatingOpenEvent,
  getPreviewTarget,
  makeDirectoryTarget,
  parseBatchMutationResult,
  parseIndexChangedEvent,
  parseOperationHistory,
  parseOperationRecord,
  parseRecursiveImportProgress,
  parseRecursiveImportResult,
  parseMutationResult,
  parseIndexSnapshot,
  parseFloatingFilesResult,
  parseMetadataSearchResponse,
  parsePreviewResult,
  parsePreviewSupport,
} from "../src/lib/ipcContracts.js";

const entry = {
  id: "file-1",
  path: "C:\\资料\\研究.txt",
  name: "研究.txt",
  kind: "text",
  type: "文本文件",
  size: 12,
  modifiedAt: 1,
  addedAt: 1,
  lastOpenedAt: 2,
  status: "已登记",
  invalid: false,
  favorite: false,
};

test("validates index snapshots and preserves revision semantics", () => {
  const snapshot = parseIndexSnapshot({ entries: [entry], revision: 4, recovery: null });
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.entries[0].id, "file-1");
  assert.equal(snapshot.entries[0].lastOpenedAt, 2);
  assert.deepEqual(snapshot.groups, []);
  assert.equal(snapshot.undo, null);
  assert.throws(() => parseIndexSnapshot({ entries: [entry], revision: -1, recovery: null }), IpcContractError);
  assert.throws(() => parseIndexSnapshot({ entries: [{ ...entry, lastOpenedAt: -1 }], revision: 4, recovery: null }), IpcContractError);
});

test("validates versioned group metadata and partial batch results", () => {
  const snapshot = parseIndexSnapshot({
    entries: [{ ...entry, tags: ["重点"], groupId: "group-a" }],
    groups: [{ id: "group-a", name: "项目 A" }],
    revision: 5,
    recovery: null,
    undo: { id: "undo-a", operation: "batch-tags", count: 1 },
  });
  assert.equal(snapshot.entries[0].groupId, "group-a");
  assert.equal(snapshot.undo.operation, "batch-tags");
  const result = parseBatchMutationResult({
    operationId: "batch-a",
    revision: 6,
    operation: "batch-tags",
    changedIds: ["file-1"],
    cancelled: false,
    timedOut: false,
    results: [{ id: "file-1", status: "success", reason: null }, { id: "file-2", status: "skipped", reason: "资料已不存在" }],
  });
  assert.equal(result.results[1].status, "skipped");
  assert.throws(() => parseBatchMutationResult({ revision: 6, operation: "batch", changedIds: [], results: [{ id: "file-1", status: "unknown" }] }), IpcContractError);
});

test("rejects unsafe target components and malformed event payloads", () => {
  assert.deepEqual(makeDirectoryTarget("folder-1", ["子目录"]), { directoryId: "folder-1", relativePath: ["子目录"] });
  assert.throws(() => makeDirectoryTarget("folder-1", [".."]), TypeError);
  assert.throws(() => parseIndexChangedEvent({ revision: 2, ids: ["C:\\secret"], changeType: "refresh" }), IpcContractError);
});

test("validates preview status and maps structured operation errors", () => {
  assert.equal(parsePreviewResult({ previewId: "", kind: "text", status: "unsupported", content: null, byteLength: 0 }).status, "unsupported");
  assert.throws(() => parsePreviewResult({ previewId: "", kind: "text", status: "broken", content: null, byteLength: 0 }), IpcContractError);
  const previewId = `preview-${"a".repeat(32)}`;
  const resource = parsePreviewResult({
    previewId,
    kind: "image",
    status: "ready",
    indexRevision: 8,
    byteLength: 42,
    content: {
      type: "resource",
      resourceUrl: `preview://localhost/${previewId}`,
      mediaType: "image/png",
      byteLength: 42,
      supportsRange: true,
      width: 10,
      height: 20,
    },
  });
  assert.equal(resource.indexRevision, 8);
  assert.equal(resource.content.resourceUrl, `preview://localhost/${previewId}`);
  assert.equal(parsePreviewSupport({ supported: false, kind: "text", status: "cancelled", indexRevision: 8, reason: "已取消" }).status, "cancelled");
  assert.throws(() => parsePreviewResult({ previewId, kind: "image", status: "ready", byteLength: 42, content: { type: "resource", resourceUrl: `preview://localhost/${previewId}?path=C:\\secret`, mediaType: "image/png", byteLength: 42, supportsRange: true } }), IpcContractError);
  assert.throws(() => parsePreviewResult({ previewId, kind: "image", status: "ready", byteLength: 42, content: null }), IpcContractError);
  assert.equal(getOperationError({ code: "partial-success", message: "internal" }, "fallback"), "文件操作已部分完成，请刷新索引确认状态");
});

test("validates metadata search ids, hit fields, ranges, and privacy boundaries", () => {
  const result = parseMetadataSearchResponse({
    revision: 11,
    matchedIds: ["file-1"],
    hits: [{ fileId: "file-1", field: "name", ranges: [{ start: 0, end: 2 }] }],
    total: 1,
    truncated: false,
  });
  assert.equal(result.hits[0].field, "name");
  assert.deepEqual(result.hits[0].ranges, [{ start: 0, end: 2 }]);
  assert.throws(() => parseMetadataSearchResponse({
    revision: 11,
    matchedIds: ["file-1"],
    hits: [{ fileId: "file-1", field: "location", value: "C:\\secret", ranges: [] }],
    total: 1,
    truncated: false,
  }), IpcContractError);
  assert.throws(() => parseMetadataSearchResponse({
    revision: 11,
    matchedIds: ["file-1"],
    hits: [{ fileId: "file-1", field: "unknown", ranges: [] }],
    total: 1,
    truncated: false,
  }), IpcContractError);
  assert.throws(() => parseMetadataSearchResponse({
    revision: 11,
    matchedIds: ["file-1"],
    hits: [],
    total: 2,
    truncated: false,
  }), IpcContractError);
});

test("validates single-entry mutation responses used by tag and group editors", () => {
  const result = parseMutationResult({
    revision: 7,
    changedIds: ["file-1"],
    entry: { ...entry, tags: ["重点"], groupId: "group-a" },
  }, "set_entry_tags");
  assert.equal(result.entry.tags[0], "重点");
  assert.equal(result.entry.groupId, "group-a");
  assert.throws(() => parseMutationResult({ revision: 7, changedIds: ["C:\\secret"], entry: null }, "set_entry_group"), IpcContractError);
});

test("validates floating open intents and external action results", () => {
  assert.deepEqual(parseFloatingOpenEvent({ fileId: "file-1" }), { fileId: "file-1", action: "locate" });
  assert.deepEqual(parseFloatingOpenEvent({ fileId: "file-1", action: "preview" }), { fileId: "file-1", action: "preview" });
  assert.throws(() => parseFloatingOpenEvent({ fileId: "file-1", action: "open-default" }), IpcContractError);
  assert.deepEqual(parseExternalOpenResult({ name: "资料.txt" }), { name: "资料.txt" });
  assert.throws(() => parseExternalOpenResult({ name: 7 }), IpcContractError);
});

test("validates floating file projections without accepting paths or duplicate IDs", () => {
  const item = {
    id: "file-1",
    name: "研究.txt",
    type: "文本文件",
    kind: "file",
    status: "已登记",
    invalid: false,
    favorite: true,
    size: 12,
    modifiedAt: 10,
    lastOpenedAt: null,
    groupId: "group-1",
    groupName: "项目 A",
  };
  const result = parseFloatingFilesResult({
    revision: 9,
    items: [item],
    total: 2,
    offset: 0,
    limit: 1,
    hasMore: true,
  });
  assert.equal(result.items[0].groupName, "项目 A");
  assert.throws(() => parseFloatingFilesResult({ items: [item], total: 1, offset: 0, limit: 1, hasMore: false }), IpcContractError);
  assert.throws(() => parseFloatingFilesResult({ revision: 9, items: [{ ...item, path: "C:\\secret" }], total: 1, offset: 0, limit: 1, hasMore: false }), IpcContractError);
  assert.throws(() => parseFloatingFilesResult({ revision: 9, items: [item, item], total: 2, offset: 0, limit: 2, hasMore: false }), IpcContractError);
  assert.throws(() => parseFloatingFilesResult({ revision: 9, items: [{ ...item, kind: "text" }], total: 1, offset: 0, limit: 1, hasMore: false }), IpcContractError);
});

test("keeps directory child preview targets relative to the registered folder", () => {
  assert.deepEqual(getPreviewTarget({
    id: "child-file",
    directoryId: "folder-1",
    relativePath: ["项目", "研究.txt"],
  }), {
    directoryId: "folder-1",
    relativePath: ["项目", "研究.txt"],
  });
});

test("validates recursive import results and progress without accepting paths", () => {
  const result = parseRecursiveImportResult({
    operationId: "recursive-import-a",
    revision: 8,
    scannedCount: 12,
    candidateCount: 6,
    indexedCount: 4,
    refreshedCount: 1,
    skippedCount: 1,
    skippedReasons: ["文件类型不在导入范围"],
    truncated: false,
    cancelled: false,
    timedOut: false,
    addedIds: ["file-2"],
  });
  assert.equal(result.candidateCount, 6);
  const progress = parseRecursiveImportProgress({
    operationId: "recursive-import-a",
    phase: "scanning",
    scannedCount: 3,
    candidateCount: 1,
    acceptedCount: 1,
    skippedCount: 0,
    currentName: "研究 计划.md",
    truncated: false,
    cancelled: false,
    timedOut: false,
  });
  assert.equal(progress.currentName, "研究 计划.md");
  assert.throws(() => parseRecursiveImportResult({ ...result, operationId: "C:\\secret" }), TypeError);
  assert.throws(() => parseRecursiveImportProgress({ ...progress, currentName: "C:\\secret" }), IpcContractError);
  assert.throws(() => parseRecursiveImportProgress({ ...progress, phase: "unknown" }), IpcContractError);
});

test("validates operation history details without accepting file paths", () => {
  const record = parseOperationRecord({
    id: "batch-a",
    operation: "batch-tags",
    status: "partial-success",
    startedAt: 10,
    finishedAt: 20,
    totalCount: 2,
    addedCount: 0,
    updatedCount: 0,
    invalidCount: 0,
    recoveredCount: 0,
    successCount: 1,
    skippedCount: 1,
    failedCount: 0,
    results: [{ id: "file-1", status: "success", reason: null }, { id: "file-2", status: "skipped", reason: "已跳过" }],
    retryableIds: [],
    skippedReasons: ["已跳过"],
    truncated: false,
    cancelled: false,
    timedOut: false,
    message: null,
    request: { favorite: null, tags: ["重点"], add: true, groupId: null },
  });
  assert.equal(record.results[1].reason, "已跳过");
  assert.equal(parseOperationHistory({ records: [record], warning: null }).records.length, 1);
  assert.throws(() => parseOperationRecord({ ...record, id: "C:\\secret" }), TypeError);
  assert.throws(() => parseOperationRecord({ ...record, status: "unknown" }), IpcContractError);
});
