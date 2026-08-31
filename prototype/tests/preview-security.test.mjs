import assert from "node:assert/strict";
import test from "node:test";
import { isSafeLocalReference } from "../src/features/preview/previewSecurity.js";

test("allows fragments and safe relative markdown references", () => {
  assert.equal(isSafeLocalReference("#section"), true);
  assert.equal(isSafeLocalReference("./notes.md"), true);
  assert.equal(isSafeLocalReference("../assets/image.png"), true);
  assert.equal(isSafeLocalReference("notes.md#section"), true);
});

test("rejects network, protocol, absolute, and backslash link variants", () => {
  for (const value of [
    "//example.com/file",
    "/absolute/path",
    "\\\\example.com\\file",
    "..\\outside.md",
    "http://example.com",
    "https://example.com",
    "data:text/html,unsafe",
    "javascript:alert(1)",
  ]) {
    assert.equal(isSafeLocalReference(value), false, value);
  }
});
