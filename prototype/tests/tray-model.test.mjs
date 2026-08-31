import assert from "node:assert/strict";
import test from "node:test";
import {
  getFavoriteActionLabel,
  getTrayTaskLabel,
  parseTrayMenuId,
  sanitizeMenuLabel,
  TRAY_STATIC_MENU_IDS,
} from "../src/features/tray/trayModel.js";

test("keeps the tray static menu order stable", () => {
  assert.deepEqual(TRAY_STATIC_MENU_IDS, [
    "tray-open-main",
    "tray-toggle-floating",
    "tray-refresh-index",
    "tray-recent-tasks",
    "tray-open-settings",
    "tray-exit",
  ]);
});

test("sanitizes unsafe and oversized task labels", () => {
  assert.equal(sanitizeMenuLabel("  中文\n资料\t "), "中文 资料");
  assert.equal(sanitizeMenuLabel("\u0000"), "未命名资料");
  assert.equal(sanitizeMenuLabel("a".repeat(80)).length, 64);
  assert.equal(getTrayTaskLabel({ name: "失效.txt", invalid: true }), "失效.txt（路径失效）");
});

test("parses task actions without accepting path-like identifiers", () => {
  assert.deepEqual(parseTrayMenuId("tray-task-open:entry-1"), {
    action: "openTask",
    fileId: "entry-1",
  });
  assert.deepEqual(parseTrayMenuId("tray-task-favorite:entry-1"), {
    action: "toggleFavorite",
    fileId: "entry-1",
  });
  assert.equal(parseTrayMenuId("tray-task-open:C:\\secret.txt"), null);
  assert.equal(parseTrayMenuId("tray-task-open:"), null);
  assert.equal(parseTrayMenuId("unknown"), null);
  assert.equal(getFavoriteActionLabel(false), "收藏");
  assert.equal(getFavoriteActionLabel(true), "取消收藏");
});
