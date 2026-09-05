import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { clearMocks, mockIPC, mockWindows } from "@tauri-apps/api/mocks";
import { emit } from "@tauri-apps/api/event";
import { useContentIndexController } from "../src/features/library/useContentIndexController.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
globalThis.window = { crypto: globalThis.crypto, setTimeout: (...args) => setTimeout(...args), clearTimeout: (...args) => clearTimeout(...args) };
const status = (cacheRevision, indexedCount = 1, sourceRevision = 5) => ({ state: "ready", indexedCount, totalBytes: indexedCount * 10, failedCount: 0, sourceRevision, cacheRevision, lastError: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const result = (request, current = status(1)) => ({ requestId: request.requestId, status: current, results: current.indexedCount ? [{ fileId: "file-a", matchCount: 1, matchesTruncated: false, snippets: [{ text: request.query, ranges: [{ start: 0, end: Array.from(request.query).length }] }] }] : [] });

async function mount(t, handle) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  mockWindows("main");
  mockIPC(handle, { shouldMockEvents: true });
  let value, renderer;
  let props = { isTauriRuntime: true, searchMode: "content", searchQuery: "旧查询", useRegex: false, showToast: () => {} };
  function Harness() { value = useContentIndexController(props); return null; }
  await act(async () => { renderer = create(createElement(Harness)); });
  const unmount = () => act(async () => renderer.unmount());
  t.after(async () => { await unmount(); clearMocks(); });
  return {
    get value() { return value; }, unmount,
    tick: () => act(async () => t.mock.timers.tick(140)),
    update: (next) => act(async () => { props = { ...props, ...next }; renderer.update(createElement(Harness)); }),
  };
}

test("rapid input has one in-flight query and only the latest pending request", async (t) => {
  const requests = [], cancellations = [];
  const app = await mount(t, (command, args) => {
    if (command === "content_index_status") return status(1);
    if (command === "cancel_content_search") { cancellations.push(args.requestId); return; }
    if (command === "search_content") { const request = { ...args, ...deferred() }; requests.push(request); return request.promise; }
  });
  await app.tick();
  for (const query of ["中间", "最新😀"]) { await app.update({ searchQuery: query }); await app.tick(); }
  assert.equal(requests.length, 1);
  assert.ok(cancellations.includes(requests[0].requestId));
  await act(async () => requests[0].resolve(result(requests[0])));
  assert.equal(requests.length, 2);
  assert.equal(requests[1].query, "最新😀");
  assert.deepEqual(app.value.searchResults, []);
  await act(async () => requests[1].resolve(result(requests[1])));
  assert.equal(app.value.searchResults[0].snippets[0].text, "最新😀");
  await app.update({ searchQuery: "" });
  assert.deepEqual(app.value.searchResults, []);
  assert.equal(app.value.searchLoading, false);
});

test("clear and rebuild invalidate late queries and reject older status events", async (t) => {
  const requests = [];
  const clearing = deferred(), rebuilding = deferred();
  let currentStatus = status(1);
  const app = await mount(t, (command, args) => {
    if (command === "content_index_status") return currentStatus;
    if (command === "clear_content_index") return clearing.promise;
    if (command === "rebuild_content_index") return rebuilding.promise;
    if (command === "search_content") { const request = { ...args, ...deferred() }; requests.push(request); return request.promise; }
  });
  await app.tick();
  let clear;
  await act(async () => { clear = app.value.clear(); });
  await act(async () => { currentStatus = status(2, 0); clearing.resolve(currentStatus); await clear; });
  await act(async () => requests[0].resolve(result(requests[0])));
  await act(async () => emit("content-index-changed", status(1)));
  assert.equal(app.value.status.indexedCount, 0);
  assert.deepEqual(app.value.searchResults, []);
  await app.tick();
  let rebuild;
  await act(async () => { rebuild = app.value.rebuild(); });
  await act(async () => requests[1].reject({ code: "content-search-cancelled" }));
  assert.equal(app.value.searchError, "");
  await act(async () => {
    currentStatus = status(3);
    rebuilding.resolve({ operationId: "rebuild-a", revision: 5, indexedCount: 1, updatedCount: 0, removedCount: 0, skippedCount: 0, skippedReasons: [], cancelled: true, timedOut: false, status: currentStatus });
    await rebuild;
  });
  assert.equal(app.value.rebuilding, false);
  await app.tick();
  await act(async () => requests[2].resolve(result(requests[2], currentStatus)));
  assert.equal(app.value.searchResults.length, 1);
  await act(async () => emit("content-index-changed", status(4, 0, 4)));
  assert.equal(app.value.status.sourceRevision, 5);
});

test("unmount cancels work and write or query failures remain recoverable", async (t) => {
  const requests = [], cancellations = [];
  const app = await mount(t, (command, args) => {
    if (command === "content_index_status") return status(1);
    if (command === "clear_content_index") throw { code: "content-index-unavailable" };
    if (command === "cancel_content_search") { cancellations.push(args.requestId); return; }
    if (command === "search_content") { const request = { ...args, ...deferred() }; requests.push(request); return request.promise; }
  });
  await app.tick();
  await act(async () => requests[0].reject({ code: "content-search-timeout" }));
  assert.match(app.value.searchError, /超时/);
  await act(async () => app.value.clear());
  assert.equal(app.value.clearing, false);
  assert.equal(app.value.status.indexedCount, 1);
  await app.tick();
  await app.unmount();
  assert.ok(cancellations.includes(requests[1].requestId));
  await act(async () => requests[1].resolve(result(requests[1])));
  assert.deepEqual(app.value.searchResults, []);
});
