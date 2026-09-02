import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOATING_LIBRARY_MAX_LIMIT,
  normalizeFloatingFilesQuery,
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
