import assert from "node:assert/strict";
import test from "node:test";
import {
  DOCX_CONVERSION_TIMEOUT_MS,
  DOCX_HTML_BYTE_LIMIT,
  DOCX_HTML_NODE_LIMIT,
  DOCX_SOURCE_BYTE_LIMIT,
  countDocxHtmlNodes,
  getDocxHtmlByteLength,
  getDocxOutputLimitReason,
  getDocxOutputMetrics,
  isPreviewAbortError,
} from "../src/features/preview/docxRenderModel.js";

test("counts DOCX output elements and measures UTF-8 bytes", () => {
  const html = "<h1>中文</h1><p>正文<img src=\"data:image/png;base64,AA==\" /></p>";
  assert.equal(countDocxHtmlNodes(html), 3);
  assert.equal(getDocxHtmlByteLength(html), Buffer.byteLength(html, "utf8"));
  assert.deepEqual(getDocxOutputMetrics(html), {
    byteLength: Buffer.byteLength(html, "utf8"),
    nodeCount: 3,
    withinLimits: true,
  });
});

test("rejects DOCX conversion output above the byte limit", () => {
  const html = `<p>${"a".repeat(DOCX_HTML_BYTE_LIMIT)}</p>`;
  const metrics = getDocxOutputMetrics(html);
  assert.equal(metrics.withinLimits, false);
  assert.match(getDocxOutputLimitReason(html), /8 MiB/);
});

test("rejects DOCX conversion output above the node limit", () => {
  const html = "<p>x</p>".repeat(DOCX_HTML_NODE_LIMIT + 1);
  const metrics = getDocxOutputMetrics(html);
  assert.equal(metrics.nodeCount, DOCX_HTML_NODE_LIMIT + 1);
  assert.equal(metrics.withinLimits, false);
  assert.match(getDocxOutputLimitReason(html), /内容节点/);
});

test("keeps the DOCX source and task limits explicit", () => {
  assert.equal(DOCX_SOURCE_BYTE_LIMIT, 20 * 1024 * 1024);
  assert.equal(DOCX_CONVERSION_TIMEOUT_MS, 30_000);
  assert.equal(isPreviewAbortError({ name: "AbortError" }), true);
  assert.equal(isPreviewAbortError({ name: "Error" }), false);
});
