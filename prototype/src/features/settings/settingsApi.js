import { invoke, isTauri } from "@tauri-apps/api/core";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settingsModel";

export function loadSettings() {
  if (!isTauri()) return Promise.resolve(normalizeSettings(DEFAULT_SETTINGS));
  return invoke("load_settings").then(normalizeSettings);
}

export function updateSettings(settings) {
  const normalized = normalizeSettings(settings);
  if (!isTauri()) return Promise.resolve(normalized);
  return invoke("update_settings", {
    settings: {
      defaultSort: normalized.defaultSort,
      pageSize: normalized.pageSize,
      confirmBeforeRemove: normalized.confirmBeforeRemove,
      hideToTray: normalized.hideToTray,
      showFloatingWindow: normalized.showFloatingWindow,
    },
  }).then(normalizeSettings);
}
