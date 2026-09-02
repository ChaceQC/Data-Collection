import assert from "node:assert/strict";
import test from "node:test";
import {
  buildFloatingFilesCommandArgs,
  FLOATING_LIBRARY_MAX_LIMIT,
  formatFloatingFileSize,
  formatFloatingTimestamp,
  getFloatingPageSummary,
  normalizeFloatingFilesQuery,
  normalizeFloatingSearchInput,
  queryFloatingFiles,
} from "../src/features/floating-ball/floatingLibraryModel.js";

const items = [
  {
    id: "file-zeta",
    name: "Zeta.txt",
    type: "文本文件",
    kind: "file",
    status: "已登记",
    invalid: false,
    favorite: true,
    size: 20,
    modifiedAt: 20,
    lastOpenedAt: 20,
    groupId: "group-work",
    groupName: "项目资料",
    tags: ["重点"],
  },
  {
    id: "file-alpha",
    name: "alpha.md",
    type: "Markdown",
    kind: "file",
    status: "已登记",
    invalid: false,
    favorite: false,
    size: 10,
    modifiedAt: 10,
    lastOpenedAt: 30,
    groupId: null,
    groupName: null,
    tags: [],
  },
  {
    id: "folder-docs",
    name: "资料目录",
    type: "文件夹",
    kind: "folder",
    status: "已登记",
    invalid: false,
    favorite: false,
    size: null,
    modifiedAt: 5,
    lastOpenedAt: null,
    groupId: "group-work",
    groupName: "项目资料",
    tags: [],
  },
  {
    id: "file-missing",
    name: "失效资料.txt",
    type: "文本文件",
    kind: "file",
    status: "路径失效",
    invalid: true,
    favorite: false,
    size: 4,
    modifiedAt: 1,
    lastOpenedAt: null,
    groupId: null,
    groupName: null,
    tags: [],
  },
];

test("normalizes defaults and rejects unsafe query boundaries", () => {
  assert.deepEqual(normalizeFloatingFilesQuery(), {
    query: "",
    filter: "all",
    sortKey: "name",
    direction: "asc",
    offset: 0,
    limit: 50,
  });
  assert.deepEqual(normalizeFloatingFilesQuery({ query: "  项目   资料  " }).query, "项目 资料");
  assert.throws(() => normalizeFloatingFilesQuery({ filter: "path" }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ sortKey: "path" }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ direction: "sideways" }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ offset: -1 }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ limit: FLOATING_LIBRARY_MAX_LIMIT + 1 }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ query: "x".repeat(257) }), TypeError);
  assert.throws(() => normalizeFloatingFilesQuery({ query: "资料\n目录" }), TypeError);
  assert.deepEqual(buildFloatingFilesCommandArgs({ query: "项目" }), {
    query: {
      query: "项目",
      filter: "all",
      sortKey: "name",
      direction: "asc",
      offset: 0,
      limit: 50,
    },
  });
});

test("returns all indexed entries, including entries never recorded by the floating ball", () => {
  const result = queryFloatingFiles(items, { limit: 50 });
  assert.equal(result.total, 4);
  assert.deepEqual(result.items.map((item) => item.id), ["file-alpha", "file-zeta", "file-missing", "folder-docs"]);
  assert.equal(result.hasMore, false);
});

test("searches metadata, applies filters, sorts stably, and paginates without duplicate IDs", () => {
  const duplicate = { ...items[0], name: "重复副本.txt" };
  const result = queryFloatingFiles(
    [...items, duplicate],
    { query: "项目 重点", filter: "favorite", sortKey: "name", direction: "asc", offset: 0, limit: 1 },
  );
  assert.equal(result.total, 1);
  assert.deepEqual(result.items.map((item) => item.id), ["file-zeta"]);

  const page = queryFloatingFiles(items, { sortKey: "lastOpenedAt", direction: "desc", offset: 1, limit: 2 });
  assert.deepEqual(page.items.map((item) => item.id), ["file-zeta", "file-missing"]);
  assert.equal(page.total, 4);
  assert.equal(page.hasMore, true);
  assert.deepEqual(queryFloatingFiles([], {}).items, []);
});

test("resolves group metadata when the item only carries a group ID", () => {
  const result = queryFloatingFiles([{ ...items[0], groupName: undefined }], { query: "项目" }, [{ id: "group-work", name: "项目资料" }]);
  assert.equal(result.items[0].id, "file-zeta");
});

test("keeps search input safe and formats stable row and page metadata", () => {
  assert.equal(normalizeFloatingSearchInput(" 项目\n资料\u0000 "), " 项目资料 ");
  assert.equal(formatFloatingFileSize(1024), "1 KB");
  assert.equal(formatFloatingFileSize(null), "大小未知");
  assert.equal(formatFloatingTimestamp(null), "未记录");
  assert.deepEqual(getFloatingPageSummary(20, 20, 41), {
    start: 21,
    end: 40,
    page: 2,
    pageCount: 3,
  });
});

test("paginates the 50-item boundary and entries beyond it", () => {
  const manyItems = Array.from({ length: 51 }, (_, index) => ({
    ...items[0],
    id: `many-${String(index).padStart(2, "0")}`,
    name: `资料-${String(index).padStart(2, "0")}.txt`,
  }));
  for (const count of [1, 5, 6]) {
    const boundary = queryFloatingFiles(manyItems.slice(0, count), { limit: 20 });
    assert.equal(boundary.items.length, count);
    assert.equal(boundary.hasMore, false);
  }
  const firstPage = queryFloatingFiles(manyItems.slice(0, 50), { limit: 20 });
  const finalPage = queryFloatingFiles(manyItems, { offset: 40, limit: 20 });
  assert.equal(firstPage.total, 50);
  assert.equal(firstPage.items.length, 20);
  assert.equal(firstPage.hasMore, true);
  assert.equal(finalPage.total, 51);
  assert.equal(finalPage.items.length, 11);
  assert.equal(finalPage.items.at(-1).id, "many-50");
  assert.equal(finalPage.hasMore, false);
});
