import assert from "node:assert/strict";
import test from "node:test";
import { getRowActionMenuPosition } from "../src/features/library/libraryOverlayModel.js";

test("row action menu opens upward when the lower edge has insufficient space", () => {
  const position = getRowActionMenuPosition(
    { left: 320, right: 380, top: 260, bottom: 290 },
    { viewportWidth: 400, viewportHeight: 320, menuWidth: 248, menuHeight: 220 },
  );
  assert.equal(position.placement, "top");
  assert.equal(position.left, 132);
  assert.equal(position.top, 35);
  assert.equal(position.top + position.maxHeight, 255);
});

test("row action menu stays within narrow viewport boundaries and opens downward when possible", () => {
  const position = getRowActionMenuPosition(
    { left: 4, right: 44, top: 80, bottom: 110 },
    { viewportWidth: 360, viewportHeight: 800, menuWidth: 400, menuHeight: 180 },
  );
  assert.equal(position.placement, "bottom");
  assert.equal(position.left, 12);
  assert.equal(position.width, 336);
  assert.equal(position.top, 115);
  assert.equal(position.top + position.maxHeight, 295);
});

test("row action menu limits its height when neither side can fit the full menu", () => {
  const position = getRowActionMenuPosition(
    { left: 120, right: 160, top: 70, bottom: 100 },
    { viewportWidth: 320, viewportHeight: 180, menuWidth: 248, menuHeight: 220 },
  );
  assert.equal(position.placement, "bottom");
  assert.equal(position.maxHeight, 63);
  assert.ok(position.top >= 12);
  assert.ok(position.top + position.maxHeight <= 168);
});
