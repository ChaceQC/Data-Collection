import assert from "node:assert/strict";
import test from "node:test";
import {
  completeOperationRecord,
  createOperationRecord,
  getOperationStatus,
  getOperationSummary,
  summarizeOperationItems,
  upsertOperationRecord,
} from "../src/features/operations/operationModel.js";

test("keeps partial, cancelled, and timed-out operation states explainable", () => {
  const started = createOperationRecord({ id: "batch-a", operation: "batch-tags", totalCount: 3, startedAt: 10 });
  const result = completeOperationRecord(started, {
    results: [
      { id: "file-a", status: "success", reason: null },
      { id: "file-b", status: "skipped", reason: "标签数量已达上限" },
      { id: "file-c", status: "failed", reason: "没有访问权限" },
    ],
    successCount: 1,
    skippedCount: 1,
    failedCount: 1,
    retryableIds: ["file-c"],
  });

  assert.equal(result.status, "partial-success");
  assert.equal(getOperationStatus(result), "partial-success");
  assert.equal(getOperationSummary(result), "成功 1 项，跳过 1 项，失败 1 项");
  assert.deepEqual(summarizeOperationItems(result.results), {
    totalCount: 3,
    successCount: 1,
    skippedCount: 1,
    failedCount: 1,
    retryableIds: ["file-c"],
  });
  assert.equal(getOperationStatus({ cancelled: true }), "cancelled");
  assert.equal(getOperationStatus({ timedOut: true }), "timed-out");
});

test("summarizes import limits and retains only the newest records", () => {
  const first = completeOperationRecord(
    createOperationRecord({ id: "import-a", operation: "import", startedAt: 1 }),
    { addedCount: 2, updatedCount: 1, successCount: 3, skippedCount: 2, truncated: true, skippedReasons: ["无法访问"] },
  );
  assert.equal(first.status, "partial-success");
  assert.equal(getOperationSummary(first), "新增 2 项，更新 1 项，跳过 2 项，达到本次上限");

  const records = upsertOperationRecord(upsertOperationRecord([], first), createOperationRecord({ id: "import-b", operation: "import", startedAt: 2 }));
  assert.deepEqual(records.map((record) => record.id), ["import-b", "import-a"]);
});
