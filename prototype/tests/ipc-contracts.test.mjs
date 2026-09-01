import assert from "node:assert/strict";
import test from "node:test";
import {
  IpcContractError,
  getOperationError,
  makeDirectoryTarget,
  parseBatchMutationResult,
  parseIndexChangedEvent,
  parseMutationResult,
  parseIndexSnapshot,
  parsePreviewResult,
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
  status: "已登记",
  invalid: false,
  favorite: false,
};

test("validates index snapshots and preserves revision semantics", () => {
  const snapshot = parseIndexSnapshot({ entries: [entry], revision: 4, recovery: null });
  assert.equal(snapshot.revision, 4);
  assert.equal(snapshot.entries[0].id, "file-1");
  assert.deepEqual(snapshot.groups, []);
  assert.equal(snapshot.undo, null);
  assert.throws(() => parseIndexSnapshot({ entries: [entry], revision: -1, recovery: null }), IpcContractError);
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
  assert.equal(getOperationError({ code: "partial-success", message: "internal" }, "fallback"), "文件操作已部分完成，请刷新索引确认状态");
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
