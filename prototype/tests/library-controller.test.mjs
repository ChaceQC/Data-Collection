import assert from "node:assert/strict";
import test from "node:test";
import { FILE_TYPE_DEFINITIONS, PREVIEW_LIMITS } from "../src/lib/fileTypes.js";
import { createBrowserEntries, validateRename } from "../src/features/library/libraryControllerModel.js";

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
