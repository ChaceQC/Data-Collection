import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SETTINGS,
  PAGE_SIZE_OPTIONS,
  formatByteLimit,
  getChangedSettingsFields,
  mergeSettingsFields,
  normalizeSettings,
} from "../src/features/settings/settingsModel.js";

test("keeps the settings defaults within the supported safety bounds", () => {
  assert.deepEqual(DEFAULT_SETTINGS.defaultSort, { key: "addedAt", direction: "desc" });
  assert.deepEqual(PAGE_SIZE_OPTIONS, [10, 20, 50]);
  assert.equal(DEFAULT_SETTINGS.pageSize, 20);
  assert.equal(DEFAULT_SETTINGS.revision, 0);
  assert.equal(DEFAULT_SETTINGS.confirmBeforeRemove, true);
  assert.equal(DEFAULT_SETTINGS.hideToTray, false);
  assert.equal(DEFAULT_SETTINGS.showFloatingWindow, true);
  assert.equal(DEFAULT_SETTINGS.previewLimits[3].maxPixels, 100_000_000);
});

test("normalizes invalid persisted values without widening the preview limits", () => {
  const settings = normalizeSettings({
    defaultSort: { key: "unknown", direction: "sideways" },
    pageSize: 999,
    confirmBeforeRemove: false,
    previewLimits: [{ label: "任意限制", maxBytes: Number.MAX_SAFE_INTEGER }],
  });

  assert.deepEqual(settings.defaultSort, { key: "addedAt", direction: "desc" });
  assert.equal(settings.pageSize, 20);
  assert.equal(settings.confirmBeforeRemove, false);
  assert.equal(settings.hideToTray, false);
  assert.equal(settings.showFloatingWindow, true);
  assert.equal(settings.previewLimits[0].maxBytes, 2 * 1024 * 1024);
});

test("normalizes the window flags with safe boolean defaults", () => {
  assert.deepEqual(
    normalizeSettings({ hideToTray: true, showFloatingWindow: false }),
    {
      ...DEFAULT_SETTINGS,
      defaultSort: { key: "addedAt", direction: "desc" },
      previewLimits: DEFAULT_SETTINGS.previewLimits,
      hideToTray: true,
      showFloatingWindow: false,
    },
  );
  assert.equal(normalizeSettings({ hideToTray: "true", showFloatingWindow: "false" }).hideToTray, false);
  assert.equal(normalizeSettings({ hideToTray: "true", showFloatingWindow: "false" }).showFloatingWindow, true);
});

test("formats binary limits for the read-only settings view", () => {
  assert.equal(formatByteLimit(2 * 1024 * 1024), "2 MiB");
  assert.equal(formatByteLimit(512 * 1024 * 1024), "512 MiB");
  assert.equal(formatByteLimit(-1), "未知");
});

test("merges only fields edited in a stale settings draft", () => {
  const base = normalizeSettings({ revision: 4, pageSize: 20, hideToTray: false, showFloatingWindow: true });
  const latest = normalizeSettings({ revision: 5, pageSize: 50, hideToTray: true, showFloatingWindow: false });
  const draft = normalizeSettings({ ...base, pageSize: 10 });
  assert.deepEqual(getChangedSettingsFields(base, draft), ["pageSize"]);
  assert.deepEqual(mergeSettingsFields(latest, draft, ["pageSize"]), {
    ...latest,
    pageSize: 10,
  });
});
