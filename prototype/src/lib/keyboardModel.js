export const KEYBOARD_ACTIONS = Object.freeze({
  FOCUS_SEARCH: "focus-search",
  REFRESH_INDEX: "refresh-index",
  CHOOSE_FILE: "choose-file",
  CHOOSE_FOLDER: "choose-folder",
  UNDO: "undo",
});

export function getKeyboardAction(event) {
  if (!event || event.defaultPrevented || event.isComposing || isTextEntryTarget(event.target)) return "";
  const key = String(event.key || "").toLowerCase();
  const primaryModifier = Boolean(event.ctrlKey || event.metaKey);

  if (key === "f5") {
    return event.ctrlKey || event.metaKey || event.altKey || event.shiftKey
      ? ""
      : KEYBOARD_ACTIONS.REFRESH_INDEX;
  }
  if (!primaryModifier || event.altKey) return "";
  if (key === "f" && !event.shiftKey) return KEYBOARD_ACTIONS.FOCUS_SEARCH;
  if (key === "o") return event.shiftKey ? KEYBOARD_ACTIONS.CHOOSE_FOLDER : KEYBOARD_ACTIONS.CHOOSE_FILE;
  if (key === "z" && !event.shiftKey) return KEYBOARD_ACTIONS.UNDO;
  return "";
}

export function isTextEntryTarget(target) {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tagName = String(target.tagName || "").toLowerCase();
  if (["input", "select", "textarea"].includes(tagName)) return true;
  return typeof target.closest === "function"
    && Boolean(target.closest("input, select, textarea, [contenteditable=\"true\"], [role=\"textbox\"]"));
}

export function isLayerTarget(target) {
  return typeof target?.closest === "function"
    && Boolean(target.closest("[role=\"dialog\"], [role=\"menu\"], .operation-center-panel, .library-filter-menu[open]"));
}
