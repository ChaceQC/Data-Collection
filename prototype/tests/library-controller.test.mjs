import assert from "node:assert/strict";
import test from "node:test";
import { FILE_TYPE_DEFINITIONS, PREVIEW_LIMITS } from "../src/lib/fileTypes.js";
import { getIndexEventDecision, getIndexSnapshotDecision } from "../src/features/library/libraryModel.js";
import {
  addTagToList,
  createBrowserEntries,
  isMainIndexEntry,
  MAX_TAGS_PER_ENTRY,
  normalizeTagList,
  removeTagFromList,
  summarizeBatchResult,
  validateDirectPathInput,
  validateRename,
  validateTagInput,
} from "../src/features/library/libraryControllerModel.js";

test("the shared manifest drives preview types and limits", () => {
  assert.equal(FILE_TYPE_DEFINITIONS.find((item) => item.extension === "xlsx").kind, "xlsx");
  assert.equal(FILE_TYPE_DEFINITIONS.find((item) => item.extension === "mp4").mediaType, "video/mp4");
  assert.deepEqual(PREVIEW_LIMITS.map((limit) => limit.key), ["text", "office", "pdf", "image", "video"]);
});

test("browser fallback entries use the shared type manifest", () => {
  const [entry] = createBrowserEntries([{ name: "配置.JSON", size: 12 }], 1_700_000_000_000);
  assert.equal(entry.kind, "text");
  assert.equal(entry.type, "代码或配置");
  assert.equal(entry.addedAt, 1_700_000_000);
  assert.deepEqual(entry.tags, []);
  assert.equal(entry.groupId, null);
});

test("summarizes partial batch results and validates tag input", () => {
  assert.deepEqual(
    summarizeBatchResult({ results: [{ status: "success" }, { status: "skipped" }, { status: "failed" }] }),
    { success: 1, skipped: 1, failed: 1 },
  );
  assert.equal(validateTagInput("  重点  ").value, "重点");
  assert.equal(validateTagInput("").valid, false);
  assert.equal(validateTagInput("x".repeat(33)).valid, false);
});

test("bounds direct path imports before sending them to the desktop command", () => {
  assert.equal(validateDirectPathInput(Array.from({ length: 257 }, () => "x")).valid, false);
  assert.equal(validateDirectPathInput(["x".repeat(32 * 1024 + 1)]).valid, false);
  assert.equal(validateDirectPathInput(Array.from({ length: 129 }, () => "x".repeat(32 * 1024))).valid, false);
  assert.deepEqual(validateDirectPathInput(["C:\\资料\\报告.txt"]).paths, ["C:\\资料\\报告.txt"]);
});

test("edits tag drafts with normalization, case-insensitive deduplication, and limits", () => {
  assert.deepEqual(normalizeTagList(["  重点  ", "重点", "工作"]), ["重点", "工作"]);
  assert.deepEqual(removeTagFromList(["重点", "工作"], "重点"), ["工作"]);
  assert.deepEqual(addTagToList(["重点"], "重点"), { valid: false, tags: ["重点"], message: "该标签已经存在" });
  assert.equal(addTagToList(Array.from({ length: MAX_TAGS_PER_ENTRY }, (_, index) => String(index)), "新标签").valid, false);
});

test("keeps directory children outside the main index mutation entry points", () => {
  assert.equal(isMainIndexEntry({ id: "file-1" }), true);
  assert.equal(isMainIndexEntry({ id: "child-1", directoryId: "folder-1", relativePath: ["子目录", "文件.txt"] }), false);
});

test("rename validation reports each Windows and index conflict reason", () => {
  const file = { id: "file-a", name: "报告.txt", path: "C:\\资料\\报告.txt" };
  const entries = [{ id: "file-b", name: "其他.txt", path: "C:\\资料\\其他.txt" }];
  assert.equal(validateRename(file, "报告.md", entries).errors[0].code, "extension");
  assert.equal(validateRename(file, "报告?.txt", entries).errors[0].code, "invalid-character");
  assert.equal(validateRename(file, "其他.txt", entries).errors[0].code, "conflict");
  assert.equal(validateRename(file, "CON.txt", entries).errors[0].code, "reserved");
  assert.equal(validateRename(file, "新报告.txt", entries).valid, true);
});

test("keeps index reloads monotonic across duplicate, out-of-order, and jumped revisions", () => {
  let observedRevision = 5;
  assert.deepEqual(getIndexEventDecision(observedRevision, 4), { accepted: false, revision: 5 });

  const first = getIndexEventDecision(observedRevision, 8);
  assert.deepEqual(first, { accepted: true, revision: 8 });
  observedRevision = first.revision;
  assert.deepEqual(getIndexEventDecision(observedRevision, 8), { accepted: false, revision: 8 });

  const jumped = getIndexEventDecision(observedRevision, 12);
  assert.deepEqual(jumped, { accepted: true, revision: 12 });
  observedRevision = jumped.revision;
  assert.equal(getIndexSnapshotDecision(observedRevision, 11), "stale");
  assert.equal(getIndexSnapshotDecision(observedRevision, 12), "accept");
  assert.equal(getIndexSnapshotDecision(observedRevision, 13, 13), "accept");
  assert.equal(getIndexSnapshotDecision(observedRevision, 12, 13), "behind");
});
