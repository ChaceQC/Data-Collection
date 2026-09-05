import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewOutcomeReporter } from "../src/features/preview/previewOutcomeReporter.js";

const flush = async () => { for (let i = 0; i < 8; i += 1) await Promise.resolve(); };
test("failed ready persistence retries, remains idempotent, and serializes a later failure", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const calls = []; let failures = 2, errors = 0;
  const reporter = createPreviewOutcomeReporter({ record: async (status) => {
    calls.push(status); if (failures-- > 0) throw { retryable: true };
  }, onError: () => { errors += 1; } });
  const ready = reporter.report("ready");
  const duplicate = reporter.report("ready");
  const failure = reporter.report("timed-out");
  await flush();
  t.mock.timers.tick(250); await flush();
  t.mock.timers.tick(750);
  assert.equal(await ready, true); assert.equal(await duplicate, false); assert.equal(await failure, true);
  assert.deepEqual(calls, ["ready", "ready", "ready", "timed-out"]);
  assert.equal(errors, 0);
});

test("stale results are silent, true failures give one notice and can be retried, cancellation stops callbacks", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  let errors = 0, calls = 0, error = { code: "preview-stale", retryable: false };
  const reporter = createPreviewOutcomeReporter({ record: async () => { calls += 1; if (error) throw error; }, onError: () => { errors += 1; } });
  assert.equal(await reporter.report("ready"), false); assert.equal(errors, 0);
  error = { retryable: false };
  assert.equal(await reporter.report("ready"), false); assert.equal(errors, 1);
  error = null;
  assert.equal(await reporter.report("ready"), true);
  error = { retryable: true };
  const pending = reporter.report("parse-error"); await flush();
  reporter.cancel();
  assert.equal(await pending, false);
  t.mock.timers.tick(60_000);
  assert.equal(calls, 4); assert.equal(errors, 1);
});
