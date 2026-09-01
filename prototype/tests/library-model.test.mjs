import test from "node:test";
import assert from "node:assert/strict";
import {
  filterEntries,
  clearSelectionOnContextChange,
  countEntriesInGroup,
  getFileKind,
  getDuplicateNameIds,
  getEntryLocation,
  getLibraryContextKey,
  getParentSummary,
  getRecentEntries,
  getNavigationCount,
  getSelectedIdsInEntries,
  getSelectionRangeIds,
  paginateEntries,
  retainExistingSelection,
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

test("search includes safe indexed locations and keeps directory children relative", () => {
  const root = { id: "folder-1", name: "资料根", path: "C:\\研究\\资料根", kind: "folder" };
  const directoryView = { trail: [root] };
  const children = [
    { id: "child-a", name: "报告.txt", kind: "text", type: "文本文件", status: "已登记", relativePath: ["项目 A", "报告.txt"], directoryId: root.id },
    { id: "child-b", name: "报告.txt", kind: "text", type: "文本文件", status: "已登记", relativePath: ["项目 B", "报告.txt"], directoryId: root.id },
  ];
  assert.equal(getEntryLocation(children[0], directoryView).fullPath, "C:\\研究\\资料根\\项目 A\\报告.txt");
  assert.equal(getParentSummary(children[1], directoryView), "C:\\研究\\资料根\\项目 B");
  assert.deepEqual(filterEntries(children, { query: "项目 B", directory: true, directoryView }).map((entry) => entry.id), ["child-b"]);
  assert.deepEqual([...getDuplicateNameIds(children)].sort(), ["child-a", "child-b"]);
});

test("removes the Windows extended-length prefix from displayed locations only", () => {
  assert.equal(
    getEntryLocation({ path: "\\\\?\\D:\\下载\\Wx记录.js" }).fullPath,
    "D:\\下载\\Wx记录.js",
  );
  assert.equal(
    getEntryLocation({ path: "\\\\?\\UNC\\server\\share\\记录.txt" }).fullPath,
    "\\\\server\\share\\记录.txt",
  );
});

test("combines type, tag, and multi-group filters without reading content", () => {
  const grouped = [
    { id: "a", name: "a.txt", type: "文本文件", tags: ["工作", "重点"], groupId: "group-a", invalid: false },
    { id: "b", name: "b.md", type: "Markdown", tags: ["工作"], groupId: "group-b", invalid: false },
    { id: "c", name: "c.txt", type: "文本文件", tags: ["重点"], groupId: null, invalid: false },
  ];
  const groups = [{ id: "group-a", name: "项目 A" }, { id: "group-b", name: "项目 B" }];
  assert.deepEqual(filterEntries(grouped, { types: ["文本文件"], tags: ["工作"], groupIds: ["group-a", "group-b"], groups }).map((entry) => entry.id), ["a"]);
  assert.deepEqual(filterEntries(grouped, { query: "项目 B" , groups }).map((entry) => entry.id), ["b"]);
  assert.equal(countEntriesInGroup(grouped, "group-a"), 1);
  assert.equal(countEntriesInGroup(grouped, "missing"), 0);
});

test("navigation filters and counts use current entry state", () => {
  assert.equal(getNavigationCount(entries, "favorites"), 2);
  assert.equal(getNavigationCount(entries, "invalid"), 1);
  assert.deepEqual(
    filterEntries(entries, { activeNav: "recent" }).map((entry) => entry.id),
    ["b", "c"],
  );
});

test("recent view is a bounded added-time view instead of all valid entries", () => {
  const many = Array.from({ length: 55 }, (_, index) => ({
    id: `recent-${index}`,
    name: `${index}.txt`,
    addedAt: index + 1,
    invalid: false,
  }));
  many.push({ id: "invalid-new", name: "invalid.txt", addedAt: 999, invalid: true });
  assert.equal(getRecentEntries(many).length, 50);
  assert.equal(getRecentEntries(many)[0].id, "recent-54");
  assert.equal(getNavigationCount(many, "recent"), 50);
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

test("list context keys are stable and include navigation, filters, and breadcrumbs", () => {
  const base = {
    activeNav: "library",
    searchQuery: "  研究  计划 ",
    filters: { type: "Markdown", tags: ["重点", "研究"], groupIds: ["group-b", "group-a"] },
    directoryView: { trail: [{ id: "root", relativePath: [] }, { id: "child", relativePath: ["项目"] }] },
  };
  assert.equal(
    getLibraryContextKey(base),
    getLibraryContextKey({ ...base, filters: { ...base.filters, tags: ["研究", "重点"], groupIds: ["group-a", "group-b"] } }),
  );
  assert.notEqual(getLibraryContextKey(base), getLibraryContextKey({ ...base, activeNav: "favorites" }));
  assert.notEqual(getLibraryContextKey(base), getLibraryContextKey({ ...base, directoryView: { trail: [{ id: "root", relativePath: [] }] } }));
});

test("selection is cleared only when the list context changes and refresh keeps existing ids", () => {
  assert.deepEqual(clearSelectionOnContextChange("same", "same", ["a", "a", "b"]), ["a", "b"]);
  assert.deepEqual(clearSelectionOnContextChange("library", "favorites", ["a", "b"]), []);
  assert.deepEqual(retainExistingSelection(["a", "missing", "a"], [{ id: "a" }, { id: "b" }]), ["a"]);
  assert.deepEqual(getSelectedIdsInEntries(["a", "missing"], [{ id: "a" }, { id: "b" }]), ["a"]);
});

test("selects a continuous range inside the current list context, including across pages", () => {
  const visibleEntries = Array.from({ length: 25 }, (_, index) => ({ id: `file-${index + 1}` }));
  assert.deepEqual(
    getSelectionRangeIds(visibleEntries, "file-3", "file-23"),
    visibleEntries.slice(2, 23).map((entry) => entry.id),
  );
  assert.deepEqual(getSelectionRangeIds(visibleEntries, "missing", "file-4"), ["file-4"]);
  assert.deepEqual(getSelectionRangeIds(visibleEntries, "file-4", "missing"), []);
});
