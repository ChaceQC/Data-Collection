import { invokeCommand, isDesktopRuntime, parseSettings } from "../../lib/ipcContracts.js";
import { DEFAULT_SETTINGS, normalizeSettings } from "./settingsModel";

export function loadSettings() {
  if (!isDesktopRuntime()) return Promise.resolve(normalizeSettings(DEFAULT_SETTINGS));
  return invokeCommand("load_settings", undefined, parseSettings).then(normalizeSettings);
}

export function updateSettings(settings) {
  const normalized = normalizeSettings(settings);
  if (!isDesktopRuntime()) return Promise.resolve(normalized);
  return invokeCommand("update_settings", {
    settings: {
      defaultSort: normalized.defaultSort,
      pageSize: normalized.pageSize,
      confirmBeforeRemove: normalized.confirmBeforeRemove,
      hideToTray: normalized.hideToTray,
      showFloatingWindow: normalized.showFloatingWindow,
    },
  }, parseSettings).then(normalizeSettings);
}
