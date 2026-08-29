import test from "node:test";
import assert from "node:assert/strict";
import {
  filterEntries,
  getFileKind,
  getNavigationCount,
  paginateEntries,
  sortEntries,
} from "../src/features/library/libraryModel.js";

const entries = [
  { id: "b", name: "资料 10.txt", type: "文本文件", kind: "text", status: "已登记", size: 10, modifiedAt: 20, addedAt: 30, favorite: false, invalid: false },
  { id: "a", name: "资料 2.json", type: "JSON", kind: "text", status: "路径失效", size: 20, modifiedAt: 20, addedAt: 10, favorite: true, invalid: true },
  { id: "c", name: "研究计划.md", type: "Markdown", kind: "markdown", status: "已登记", size: 5, modifiedAt: 30, addedAt: 20, favorite: true, invalid: false },
];

test("search normalizes whitespace and matches name, type, and status", () => {
  assert.deepEqual(
    filterEntries(entries, { query: "  JSON  " }).map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(
    filterEntries(entries, { query: "路径 失效" }).map((entry) => entry.id),
    ["a"],
  );
  assert.deepEqual(
    filterEntries(entries, { query: "研究计划" }).map((entry) => entry.id),
    ["c"],
  );
});

test("navigation filters and counts use current entry state", () => {
  assert.equal(getNavigationCount(entries, "favorites"), 2);
  assert.equal(getNavigationCount(entries, "invalid"), 1);
  assert.deepEqual(
    filterEntries(entries, { activeNav: "recent" }).map((entry) => entry.id),
    ["b", "c"],
  );
});

test("sorts all supported fields and keeps equal values deterministic", () => {
  assert.deepEqual(sortEntries(entries, { key: "name", direction: "asc" }).map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(sortEntries(entries, { key: "size", direction: "desc" }).map((entry) => entry.id), ["a", "b", "c"]);
  assert.deepEqual(sortEntries(entries, { key: "modifiedAt", direction: "desc" }).map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(sortEntries(entries, { key: "addedAt", direction: "desc" }).map((entry) => entry.id), ["b", "c", "a"]);
});

test("paginates at twenty entries and clamps an out-of-range page", () => {
  const manyEntries = Array.from({ length: 41 }, (_, index) => ({ id: String(index), name: String(index) }));
  const page = paginateEntries(manyEntries, 9);
  assert.equal(page.page, 3);
  assert.equal(page.pageCount, 3);
  assert.equal(page.entries.length, 1);
});

test("classifies the planned file extensions", () => {
  assert.equal(getFileKind("代码样本.cpp"), "text");
  assert.equal(getFileKind("照片.WEBP"), "image");
  assert.equal(getFileKind("未知.bin"), "other");
});
