import assert from "node:assert/strict";
import test from "node:test";
import { normalizeFloatingOpenAction } from "../src/lib/ipcContracts.js";
import { getEntryPage } from "../src/features/library/libraryModel.js";

test("keeps floating open actions explicit and rejects unknown intents", () => {
  assert.equal(normalizeFloatingOpenAction(), "locate");
  assert.equal(normalizeFloatingOpenAction("preview"), "preview");
  assert.throws(() => normalizeFloatingOpenAction("open-default"), TypeError);
});

test("finds the page for a focused library entry without exposing paths", () => {
  const entries = Array.from({ length: 45 }, (_, index) => ({ id: `file-${index}` }));
  assert.equal(getEntryPage(entries, "file-0", 20), 1);
  assert.equal(getEntryPage(entries, "file-20", 20), 2);
  assert.equal(getEntryPage(entries, "file-44", 20), 3);
  assert.equal(getEntryPage(entries, "missing", 20), null);
});
