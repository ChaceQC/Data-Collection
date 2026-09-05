import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks";
import { useLibraryReposition } from "../src/features/library/useLibraryReposition.js";
import { createLibraryFileActions } from "../src/features/library/useLibraryFileActions.js";
import { libraryRepository } from "../src/features/library/libraryRepository.js";
import { parseIndexSnapshot, parseTargetMutationResult } from "../src/lib/ipcContracts.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = {};
const entry = (id, kind = "text") => ({ id, name: `${id}.txt`, path: `C:\\fixtures\\${id}`, kind, type: "TXT", size: 1, modifiedAt: 1, addedAt: 1, status: "路径失效", invalid: true });
const deferred = () => { let resolve; const promise = new Promise((yes) => { resolve = yes; }); return { promise, resolve }; };

async function mount(t, handler) {
  const calls = []; let actions; let options = { files: [entry("file"), entry("folder", "folder")], navigationContext: "library" };
  mockIPC(handler);
  function Harness() {
    actions = useLibraryReposition({ ...options, isTauriRuntime: true, fileActions: createLibraryFileActions(libraryRepository),
      reloadIndexPreservingState: async (revision) => { calls.push(["reload", revision]); return true; },
      invalidateDirectoryRequest: () => calls.push(["invalidate"]),
      setPreviewEntryId: () => calls.push(["preview"]), setSelectedId: (id) => calls.push(["select", id]),
      showToast: (message) => calls.push(["toast", message]),
    });
    return null;
  }
  let renderer; await act(async () => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(async () => renderer.unmount()); clearMocks(); });
  return { calls, get actions() { return actions; }, update: async (next) => { options = { ...options, ...next }; await act(async () => renderer.update(createElement(Harness))); } };
}

test("reposition picker selects file or folder mode and cancellation leaves state unchanged", async (t) => {
  const pickers = [], mutations = [];
  const app = await mount(t, (command, args) => {
    if (command === "plugin:dialog|open") { pickers.push(args.options); return pickers.length === 3 ? null : "C:\\fixtures\\new"; }
    mutations.push(args); return { revision: 4, changedIds: [args.fileId], entry: { ...entry(args.fileId), invalid: false } };
  });
  await act(async () => app.actions.openRepositionPicker(entry("file")));
  await act(async () => app.actions.openRepositionPicker(entry("folder", "folder")));
  const before = app.calls.length;
  await act(async () => app.actions.openRepositionPicker(entry("file")));
  assert.deepEqual(pickers.map((value) => [value.directory, value.multiple]), [[false, false], [true, false], [false, false]]);
  assert.deepEqual(mutations.map((value) => value.fileId), ["file", "folder"]);
  assert.equal(app.calls.length, before);
  assert.ok(app.calls.find(([name, revision]) => name === "reload" && revision === 4));
});

test("late picker results cannot target another record or replace a newer navigation context", async (t) => {
  const pickers = [], mutations = [];
  const app = await mount(t, (command, args) => {
    if (command === "plugin:dialog|open") { const request = deferred(); pickers.push(request); return request.promise; }
    mutations.push(args); return { revision: 3, changedIds: [args.fileId], entry: entry(args.fileId) };
  });
  let first, second;
  await act(async () => { first = app.actions.openRepositionPicker(entry("file")); second = app.actions.openRepositionPicker(entry("folder", "folder")); });
  await act(async () => { pickers[0].resolve("C:\\fixtures\\old"); await first; });
  assert.equal(mutations.length, 0);
  await app.update({ navigationContext: "favorites" });
  await act(async () => { pickers[1].resolve("C:\\fixtures\\late"); await second; });
  assert.equal(mutations.length, 0); assert.equal(app.calls.length, 0);
  await act(async () => { first = app.actions.openRepositionPicker(entry("file")); });
  await app.update({ files: [{ ...entry("file"), invalid: false }] });
  await act(async () => { pickers[2].resolve("C:\\fixtures\\unneeded"); await first; });
  assert.equal(mutations.length, 0);
});

test("wrong mutation identity is rejected before applying a file action", async (t) => {
  const app = await mount(t, (command) => command === "plugin:dialog|open" ? "C:\\fixtures\\new" : { revision: 3, changedIds: ["file"], entry: entry("wrong") });
  await act(async () => app.actions.openRepositionPicker(entry("file")));
  assert.equal(app.calls.filter(([name]) => name !== "toast").length, 0);
  assert.throws(() => parseTargetMutationResult({ revision: 1, entry: entry("file"), changedIds: ["wrong"] }, "file", "rename_indexed_file"));
});

test("pending recovery exposes controlled target IDs separately from a blocked index", () => {
  const recovery = { required: true, issue: "请核对", backupCreated: false, pendingOperations: 1, pendingFileIds: ["file"], indexBlocked: false };
  const result = parseIndexSnapshot({ revision: 1, entries: [entry("file")], groups: [], recovery });
  assert.equal(result.recovery.indexBlocked, false);
  assert.deepEqual(result.recovery.pendingFileIds, ["file"]);
  assert.throws(() => parseIndexSnapshot({ revision: 1, entries: [], recovery: { ...recovery, pendingOperations: 0 } }));
});
