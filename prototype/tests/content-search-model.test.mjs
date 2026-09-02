import assert from "node:assert/strict";
import test from "node:test";
import {
  SEARCH_MODES,
  filterEntries,
  getFileKind,
  getMetadataSearchHit,
  getSearchTextRanges,
  getLibraryContextKey,
  validateSearchQuery,
} from "../src/features/library/libraryModel.js";

const files = [
  { id: "py", name: "检索脚本.py", kind: "text", type: "代码或配置", status: "已登记", invalid: false },
  { id: "json", name: "配置.json", kind: "text", type: "代码或配置", status: "已登记", invalid: false },
  { id: "md", name: "研究计划.md", kind: "markdown", type: "Markdown", status: "已登记", invalid: false },
];

test("classifies code and configuration as pure text without requiring a txt extension", () => {
  assert.equal(getFileKind("扫描器.py"), "text");
  assert.equal(getFileKind("配置.json"), "text");
  assert.equal(getFileKind("研究计划.md"), "markdown");
});

test("supports regular expressions for metadata search and safe name highlighting", () => {
  assert.equal(validateSearchQuery("脚本\\.(py|json)", true).valid, true);
  assert.deepEqual(
    filterEntries(files, { query: "\\.(py|json)$", useRegex: true }).map((file) => file.id),
    ["py", "json"],
  );
  assert.deepEqual(getSearchTextRanges("检索脚本.py", "脚本\\.py", true), [{ start: 2, end: 7 }]);
  assert.equal(getMetadataSearchHit(files[0], "脚本", { useRegex: false }).label, "名称");
  assert.equal(validateSearchQuery("[", true).valid, false);
});

test("content mode limits visible files to backend result ids and participates in context", () => {
  const contentIds = new Set(["md"]);
  assert.deepEqual(
    filterEntries(files, { query: "正文", searchMode: SEARCH_MODES.content, contentMatchIds: contentIds }).map((file) => file.id),
    ["md"],
  );
  assert.notEqual(
    getLibraryContextKey({ searchQuery: "正文", searchMode: SEARCH_MODES.metadata }),
    getLibraryContextKey({ searchQuery: "正文", searchMode: SEARCH_MODES.content }),
  );
});
