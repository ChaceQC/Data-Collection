import assert from "node:assert/strict";
import test from "node:test";
import { createFloatingHandoff } from "../src/features/library/useFloatingHandoff.js";
import { createLibraryBatchActions } from "../src/features/library/useLibraryBatchActions.js";
import { createLibraryFileActions } from "../src/features/library/useLibraryFileActions.js";
import { createLibraryHistoryActions } from "../src/features/library/useLibraryHistoryActions.js";
import { createLibraryImportActions } from "../src/features/library/useLibraryImportActions.js";
import { createLibraryMutationActions } from "../src/features/library/useLibraryMutationActions.js";

test("library action services keep command names and argument order explicit", async () => {
  const calls = [];
  const repository = new Proxy({}, {
    get: (_, name) => (...args) => {
      calls.push([name, ...args]);
      return Promise.resolve({ name, args });
    },
  });
  const imports = createLibraryImportActions(repository);
  const mutations = createLibraryMutationActions(repository);
  const batch = createLibraryBatchActions(repository);
  const files = createLibraryFileActions(repository);
  const history = createLibraryHistoryActions(repository);
  await imports.indexPaths(["C:\\资料.txt"]);
  await imports.importFoldersRecursive(["C:\\资料"], "op-1", { maxDepth: 3 });
  await mutations.setFavorite("file-1", true);
  await mutations.setEntryGroup("file-1", null);
  await batch.updateTags(["file-1"], ["重点"], true, "op-2");
  await files.revealDirectoryChild("folder-1", ["子目录", "资料.txt"]);
  await history.undoLast();
  const handoff = createFloatingHandoff(repository);
  await handoff.loadIndex();
  assert.equal(handoff.normalizeAction("preview"), "preview");
  assert.throws(() => handoff.normalizeAction("shell"));
  assert.deepEqual(calls.map(([name]) => name), [
    "indexPaths", "importFoldersRecursive", "setFavorite", "setEntryGroup",
    "batchUpdateTags", "revealDirectoryChild", "undoLast", "loadIndex",
  ]);
});

