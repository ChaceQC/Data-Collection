import assert from "node:assert/strict";
import test from "node:test";
import {
  KEYBOARD_ACTIONS,
  getKeyboardAction,
  isLayerTarget,
  isTextEntryTarget,
} from "../src/lib/keyboardModel.js";

function keyEvent(overrides = {}) {
  return {
    key: "",
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    defaultPrevented: false,
    isComposing: false,
    target: { tagName: "DIV" },
    ...overrides,
  };
}

test("maps main-window shortcuts without treating browser shortcuts as global commands", () => {
  assert.equal(getKeyboardAction(keyEvent({ key: "f", ctrlKey: true })), KEYBOARD_ACTIONS.FOCUS_SEARCH);
  assert.equal(getKeyboardAction(keyEvent({ key: "F5" })), KEYBOARD_ACTIONS.REFRESH_INDEX);
  assert.equal(getKeyboardAction(keyEvent({ key: "o", ctrlKey: true })), KEYBOARD_ACTIONS.CHOOSE_FILE);
  assert.equal(getKeyboardAction(keyEvent({ key: "o", ctrlKey: true, shiftKey: true })), KEYBOARD_ACTIONS.CHOOSE_FOLDER);
  assert.equal(getKeyboardAction(keyEvent({ key: "z", ctrlKey: true })), KEYBOARD_ACTIONS.UNDO);
  assert.equal(getKeyboardAction(keyEvent({ key: "f", ctrlKey: true, defaultPrevented: true })), "");
  assert.equal(getKeyboardAction(keyEvent({ key: "F5", ctrlKey: true })), "");
});

test("does not steal text-entry, select, composition, or modified shortcut input", () => {
  for (const target of [{ tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" }, { isContentEditable: true }]) {
    assert.equal(getKeyboardAction(keyEvent({ key: "f", ctrlKey: true, target })), "");
  }
  assert.equal(getKeyboardAction(keyEvent({ key: "o", ctrlKey: true, altKey: true })), "");
  assert.equal(getKeyboardAction(keyEvent({ key: "z", ctrlKey: true, shiftKey: true })), "");
  assert.equal(isTextEntryTarget({ tagName: "INPUT" }), true);
  assert.equal(isTextEntryTarget({ tagName: "BUTTON" }), false);
});

test("recognizes menu and modal targets so focus stays in the active layer", () => {
  const menuTarget = { closest: (selector) => selector.includes('[role="menu"]') ? {} : null };
  const dialogTarget = { closest: (selector) => selector.includes('[role="dialog"]') ? {} : null };
  assert.equal(isLayerTarget(menuTarget), true);
  assert.equal(isLayerTarget(dialogTarget), true);
  assert.equal(isLayerTarget({ tagName: "DIV", closest: () => null }), false);
});
