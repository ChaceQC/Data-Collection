import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useRef } from "react";
import { act, create } from "react-test-renderer";
import { mockIPC, clearMocks } from "@tauri-apps/api/mocks";
import { useLibraryNavigation } from "../src/features/library/useLibraryNavigation.js";
import { useIndexController } from "../src/features/library/useIndexController.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { crypto: globalThis.crypto };
const entry = (id, extra = {}) => ({ id, name: id, path: `C:\\fixtures\\${id}`, kind: "text", type: "TXT", size: 1, modifiedAt: 1, addedAt: 1, status: "已登记", ...extra });
const root = entry("root", { kind: "folder", type: "文件夹" });
const child = entry("child", { directoryId: root.id, relativePath: ["child.txt"] });
const snapshot = (revision, entries = [root]) => ({ revision, entries, groups: [] });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };

async function mount(t, handle) {
  let current;
  const messages = [];
  mockIPC(handle);
  function Harness() {
    const filesRef = useRef([]);
    const navigation = useLibraryNavigation({ filesRef, showToast: (message) => messages.push(message) });
    const index = useIndexController({
      isTauriRuntime: true, initialFiles: [],
      directoryView: navigation.directoryView, refreshDirectory: navigation.refreshDirectory,
      setSelectedId: navigation.setSelectedId, setPreviewEntryId: navigation.setPreviewEntryId,
      showToast: (message) => messages.push(message),
    });
    filesRef.current = index.files;
    current = { navigation, index };
    return null;
  }
  let renderer;
  await act(async () => { renderer = create(createElement(Harness)); });
  t.after(async () => { await act(async () => renderer.unmount()); clearMocks(); });
  return { get value() { return current; }, messages, unmount: () => act(async () => renderer.unmount()) };
}

test("navigation invalidates late success and failure for every library exit", async (t) => {
  const requests = [];
  const app = await mount(t, (command) => {
    if (command === "load_file_index") return snapshot(1);
    const request = deferred(); requests.push(request); return request.promise;
  });
  for (const action of ["selectNav", "focusEntry", "resetToLibrary", "openBreadcrumb", "setDirectoryView"]) {
    for (const failure of [false, true]) {
      let opening;
      await act(async () => { opening = app.value.navigation.openDirectory(root, [root]); });
      assert.equal(app.value.navigation.directoryLoading, true);
      await act(async () => {
        const nav = app.value.navigation;
        if (action === "selectNav") nav.selectNav("favorites");
        if (action === "focusEntry") nav.focusEntry("root");
        if (action === "resetToLibrary") nav.resetToLibrary();
        if (action === "openBreadcrumb") nav.openBreadcrumb(-1);
        if (action === "setDirectoryView") nav.setDirectoryView(null);
      });
      await act(async () => {
        if (failure) requests.at(-1).reject("unavailable"); else requests.at(-1).resolve([child]);
        assert.equal(await opening, false);
      });
      assert.equal(app.value.navigation.directoryView, null);
      assert.equal(app.value.navigation.directoryLoading, false);
      assert.equal(app.value.navigation.directoryError, null);
    }
  }
  assert.deepEqual(app.messages, []);
});

test("new directory request owns loading and identity including the relative path", async (t) => {
  const requests = [];
  const app = await mount(t, (command, args) => {
    if (command === "load_file_index") return snapshot(1);
    const request = deferred(); requests.push({ ...request, target: args.target }); return request.promise;
  });
  let first, second;
  const nested = entry("nested", { kind: "folder", directoryId: "root", relativePath: ["nested"] });
  await act(async () => { first = app.value.navigation.openDirectory(root, [root]); });
  await act(async () => { second = app.value.navigation.openDirectory(nested, [root, nested]); });
  await act(async () => { requests[0].reject("old failure"); await first; });
  assert.equal(app.value.navigation.directoryLoading, true);
  await act(async () => { requests[1].resolve([child]); assert.equal(await second, true); });
  assert.deepEqual(requests[1].target, { directoryId: "root", relativePath: ["nested"] });
  assert.equal(app.value.navigation.directoryView.contextKey, JSON.stringify(["root", ["nested"]]));
});

test("index events preserve directory previews, prune deleted children and ignore late refresh after navigation", async (t) => {
  let revision = 1, entries = [root], children = [child], delayed;
  const app = await mount(t, (command) => command === "load_file_index" ? snapshot(revision, entries) : delayed?.promise || children);
  await act(async () => { await app.value.navigation.openDirectory(root, [root]); });
  await act(async () => app.value.navigation.handleRowClick(child));
  revision = 2;
  await act(async () => { assert.equal(await app.value.index.reloadIndexPreservingState(2), true); });
  assert.equal(app.value.navigation.selectedId, child.id);
  assert.equal(app.value.navigation.previewEntryId, child.id);
  children = [];
  revision = 3;
  await act(async () => { await app.value.index.reloadIndexPreservingState(3); });
  assert.equal(app.value.navigation.previewEntryId, null);
  delayed = deferred(); revision = 4;
  let sync;
  await act(async () => { sync = app.value.index.reloadIndexPreservingState(4); });
  await act(async () => app.value.navigation.selectNav("favorites"));
  await act(async () => { delayed.reject("old refresh failure"); await sync; });
  assert.equal(app.value.navigation.directoryView, null);
  assert.equal(app.value.navigation.activeNav, "favorites");
  delayed = null; children = [child];
  await act(async () => { await app.value.navigation.openDirectory(root, [root]); });
  await act(async () => app.value.navigation.handleRowClick(child));
  entries = []; revision = 5;
  await act(async () => { await app.value.index.reloadIndexPreservingState(5); });
  assert.equal(app.value.navigation.directoryView, null);
  assert.equal(app.value.navigation.previewEntryId, null);
});

test("sync retries at 250 and 750 ms, stops after three attempts, and manually recovers", async (t) => {
  let failing = false, calls = 0, revision = 2;
  const app = await mount(t, () => {
    calls += 1;
    if (failing) throw { code: "storage-unavailable", message: "unavailable", retryable: true, state: "unknown" };
    return snapshot(revision);
  });
  calls = 0; failing = true;
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let sync;
  await act(async () => { sync = app.value.index.reloadIndexPreservingState(3); });
  assert.equal(calls, 1);
  await act(async () => t.mock.timers.tick(249)); assert.equal(calls, 1);
  await act(async () => t.mock.timers.tick(1)); assert.equal(calls, 2);
  await act(async () => t.mock.timers.tick(749)); assert.equal(calls, 2);
  await act(async () => { t.mock.timers.tick(1); assert.equal(await sync, false); });
  assert.equal(calls, 3); assert.equal(app.messages.length, 1);
  await act(async () => t.mock.timers.tick(60_000)); assert.equal(calls, 3);
  assert.equal(app.value.index.files[0].id, root.id);
  failing = false; revision = 3;
  await act(async () => { assert.equal(await app.value.index.reloadIndexPreservingState(3, { restart: true }), true); });
  assert.equal(app.value.index.refreshError, "");
});

test("a missing active subdirectory closes its preview without retrying an invalid target", async (t) => {
  let missing = false, calls = 0;
  const app = await mount(t, (command) => {
    if (command === "load_file_index") return snapshot(2);
    calls += 1;
    if (missing) throw { code: "directory-missing", message: "missing", retryable: false, state: "unchanged" };
    return [child];
  });
  await act(async () => { await app.value.navigation.openDirectory(root, [root]); });
  await act(async () => app.value.navigation.handleRowClick(child));
  missing = true; calls = 0;
  await act(async () => { assert.equal(await app.value.index.reloadIndexPreservingState(2), false); });
  assert.equal(calls, 1);
  assert.equal(app.value.navigation.directoryView, null);
  assert.equal(app.value.navigation.previewEntryId, null);
  assert.equal(app.value.navigation.directoryError.retryable, false);
});

test("sync bounds stale snapshots, coalesces target revisions, rejects contracts, and cancels on unmount", async (t) => {
  let next = () => snapshot(1), calls = 0;
  const app = await mount(t, () => { calls += 1; return next(); });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  calls = 0;
  let sync;
  await act(async () => { sync = app.value.index.reloadIndexPreservingState(5); });
  await act(async () => { void app.value.index.reloadIndexPreservingState(8); t.mock.timers.tick(250); });
  assert.equal(app.value.index.latestRevision, 1);
  next = () => snapshot(8);
  await act(async () => { t.mock.timers.tick(750); assert.equal(await sync, true); });
  assert.equal(calls, 3); assert.equal(app.value.index.latestRevision, 8);
  next = () => ({ revision: 9, entries: "invalid" }); calls = 0;
  await act(async () => { assert.equal(await app.value.index.reloadIndexPreservingState(9), false); });
  assert.equal(calls, 1);
  next = () => snapshot(7); calls = 0;
  await act(async () => { sync = app.value.index.reloadIndexPreservingState(9); });
  await app.unmount();
  assert.equal(await sync, false);
  t.mock.timers.tick(60_000);
  assert.equal(calls, 1);
});
