import assert from "node:assert/strict";
import test from "node:test";
import {
  IpcContractError,
  getOperationError,
  makeDirectoryTarget,
  parseIndexChangedEvent,
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
  assert.throws(() => parseIndexSnapshot({ entries: [entry], revision: -1, recovery: null }), IpcContractError);
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
