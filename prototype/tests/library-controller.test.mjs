import assert from "node:assert/strict";
import test from "node:test";
import { FILE_TYPE_DEFINITIONS, PREVIEW_LIMITS } from "../src/lib/fileTypes.js";
import {
  addTagToList,
  createBrowserEntries,
  isMainIndexEntry,
  MAX_TAGS_PER_ENTRY,
  normalizeTagList,
  removeTagFromList,
  summarizeBatchResult,
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
