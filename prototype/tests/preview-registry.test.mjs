import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import * as XLSX from "xlsx";
import { getPreviewDefinition } from "../src/features/preview/previewRegistry.js";
import {
  getAdjacentPreviewEntries,
  getPreviewFailureActions,
  getPreviewStatusLabel,
} from "../src/features/preview/previewTypes.js";

test("registers every planned preview extension", () => {
  const extensions = [
    "md", "markdown", "txt", "js", "ts", "tsx", "py", "cpp", "rs", "json", "jsonl",
    "docx", "doc", "xlsx", "pdf", "png", "jpg", "jpeg", "webp", "gif", "bmp", "mp4", "webm",
  ];
  for (const extension of extensions) {
    const definition = getPreviewDefinition({ name: `sample.${extension}`, kind: "other" });
    assert.ok(definition, `missing registry entry for .${extension}`);
  }
});

test("does not register SVG or unknown containers as previewable", () => {
  assert.equal(getPreviewDefinition({ name: "diagram.svg", kind: "other" }), null);
  assert.equal(getPreviewDefinition({ name: "archive.zip", kind: "other" }), null);
});

test("keeps browser fallback distinct from format failures", () => {
  assert.equal(getPreviewStatusLabel("unsupported", { demoOnly: true }), "浏览器演示限制");
  assert.deepEqual(getPreviewFailureActions("missing"), ["reposition", "close"]);
  assert.deepEqual(getPreviewFailureActions("too-large"), ["open-default", "close"]);
  assert.deepEqual(getPreviewFailureActions("converter-missing"), ["open-default", "close"]);
  assert.deepEqual(getPreviewFailureActions("unsupported"), ["open-default", "reveal", "close"]);
  assert.deepEqual(getPreviewFailureActions("permission-denied"), ["retry", "open-default", "reveal", "close"]);
  assert.deepEqual(getPreviewFailureActions("cancelled"), ["retry", "open-default", "reveal", "close"]);
  assert.deepEqual(getPreviewFailureActions("parse-error"), ["retry", "open-default", "reveal", "close"]);
  assert.deepEqual(getPreviewFailureActions("parse-error", { isDirectoryEntry: true }), ["retry", "reveal", "close"]);
  assert.deepEqual(getPreviewFailureActions("unsupported", { demoOnly: true }), ["close"]);
});

test("calculates adjacent preview entries from the supplied visible snapshot", () => {
  const entries = [{ id: "first" }, { id: "current" }, { id: "last" }];
  assert.deepEqual(getAdjacentPreviewEntries(entries, "current"), {
    previous: entries[0],
    next: entries[2],
  });
  assert.deepEqual(getAdjacentPreviewEntries(entries, "unknown"), { previous: null, next: null });
});

test("parses the safe workbook fixture without evaluating formulas", async () => {
  const bytes = await readFile(new URL("./fixtures/preview/示例工作簿.xlsx", import.meta.url));
  const workbook = XLSX.read(bytes, { type: "buffer", cellDates: true, cellHTML: false, bookVBA: false });
  assert.deepEqual(workbook.SheetNames, ["汇总", "备注"]);
  assert.equal(workbook.Sheets["汇总"].B2.v, 3);
  assert.equal(workbook.Sheets["汇总"].C2.t, "d");
  assert.equal(workbook.Sheets["汇总"].C3.v, "=SUM(B2:B2)");
});

test("rejects the intentionally corrupt workbook fixture", async () => {
  const bytes = await readFile(new URL("./fixtures/preview/损坏工作簿.xlsx", import.meta.url));
  assert.notDeepEqual(Array.from(bytes.subarray(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
});
