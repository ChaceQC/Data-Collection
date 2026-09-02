import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_RECURSIVE_IMPORT_POLICY,
  describeRecursiveImportPolicy,
  getRecursiveImportFolderName,
  normalizeRecursiveImportPolicy,
} from "../src/features/library/recursiveImportModel.js";

test("normalizes recursive import policy at the frontend boundary", () => {
  assert.deepEqual(normalizeRecursiveImportPolicy({ maxDepth: 999, maxEntries: 0, skipHidden: false, includeUnsupported: true }), {
    maxDepth: 64,
    maxEntries: 1,
    skipHidden: false,
    includeUnsupported: true,
  });
  assert.deepEqual(normalizeRecursiveImportPolicy(), DEFAULT_RECURSIVE_IMPORT_POLICY);
  assert.match(describeRecursiveImportPolicy(DEFAULT_RECURSIVE_IMPORT_POLICY), /已支持预览格式/);
});

test("shows only a folder name in the import strategy dialog", () => {
  assert.equal(getRecursiveImportFolderName("C:\\资料\\研究 计划\\"), "研究 计划");
  assert.equal(getRecursiveImportFolderName("\\\\server\\share\\资料"), "资料");
  assert.equal(getRecursiveImportFolderName(""), "所选文件夹");
});
