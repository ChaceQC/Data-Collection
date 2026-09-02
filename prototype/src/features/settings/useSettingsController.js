import { useCallback, useEffect, useRef, useState } from "react";
import { getOperationError } from "../../lib/ipcContracts.js";
import { loadSettings, updateSettings } from "./settingsApi.js";
import { DEFAULT_SETTINGS, mergeSettingsFields, normalizeSettings } from "./settingsModel.js";

export function useSettingsController({ isTauriRuntime, showToast, onSortChange, onPageSizeChange }) {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(isTauriRuntime);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const settingsRef = useRef(DEFAULT_SETTINGS);
  const showToastRef = useRef(showToast);

  showToastRef.current = showToast;

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((loadedSettings) => {
        if (cancelled) return;
        applySettings(loadedSettings);
        if (loadedSettings.warning) showToastRef.current(loadedSettings.warning);
      })
      .catch(() => {
        if (!cancelled) showToastRef.current("无法读取本地设置，已使用默认设置");
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applySettings = useCallback((value) => {
    const normalized = normalizeSettings(value);
    settingsRef.current = normalized;
    setSettings(normalized);
    onSortChange(normalized.defaultSort);
    onPageSizeChange(normalized.pageSize);
    return normalized;
  }, [onPageSizeChange, onSortChange]);

  const handleSettingsSave = useCallback(async (nextSettings, editedFields = undefined) => {
    if (settingsSaving) return;
    setSettingsSaving(true);
    try {
      const mergedSettings = mergeSettingsFields(settingsRef.current, nextSettings, editedFields);
      const savedSettings = await updateSettings(mergedSettings);
      applySettings(savedSettings);
      setSettingsOpen(false);
      showToastRef.current(isTauriRuntime ? "设置已保存" : "设置已应用，仅在当前浏览器会话有效");
    } catch (error) {
      if (error?.code === "settings-conflict") {
        try {
          applySettings(await loadSettings());
        } catch {
          // 冲突刷新失败时保留当前草稿，避免用户修改丢失。
        }
        showToastRef.current("设置已在其他窗口更新，请检查后重新保存");
      } else {
        showToastRef.current(getOperationError(error, "设置保存失败，请重试"));
      }
    } finally {
      setSettingsSaving(false);
    }
  }, [applySettings, isTauriRuntime, settingsSaving]);

  return {
    applySettings,
    handleSettingsSave,
    settings,
    settingsLoading,
    settingsOpen,
    settingsSaving,
    setSettingsOpen,
  };
}
