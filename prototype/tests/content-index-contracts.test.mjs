import assert from "node:assert/strict";
import test from "node:test";
import {
  getOperationError,
  parseContentIndexRebuildResult,
  parseContentIndexStatus,
  parseContentSearchResponse,
} from "../src/lib/ipcContracts.js";

const status = {
  state: "ready",
  indexedCount: 2,
  totalBytes: 128,
  failedCount: 0,
  sourceRevision: 4,
  lastError: null,
};

test("validates content index status, snippets, and regex search results without paths", () => {
  assert.equal(parseContentIndexStatus(status).indexedCount, 2);
  const response = parseContentSearchResponse({
    status,
    results: [{
      fileId: "file-a",
      matchCount: 2,
      matchesTruncated: false,
      snippets: [{ text: "...研究正文...", ranges: [{ start: 3, end: 5 }] }],
    }],
  });
  assert.equal(response.results[0].snippets[0].ranges[0].end, 5);
  assert.throws(() => parseContentSearchResponse({
    status,
    results: [{ fileId: "C:\\secret", matchCount: 1, matchesTruncated: false, snippets: [] }],
  }), TypeError);
});

test("validates rebuild summaries and maps content index failures", () => {
  const result = parseContentIndexRebuildResult({
    operationId: "content-index-a",
    revision: 5,
    indexedCount: 3,
    updatedCount: 1,
    removedCount: 1,
    skippedCount: 0,
    skippedReasons: [],
    cancelled: false,
    timedOut: false,
    status,
  });
  assert.equal(result.removedCount, 1);
  assert.equal(getOperationError({ code: "invalid-content-query" }, "fallback"), "搜索表达式无效，请检查正则语法或缩短搜索内容");
});
