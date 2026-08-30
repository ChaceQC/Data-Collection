import { useEffect, useState } from "react";
import { Check, GearSix, X } from "@phosphor-icons/react";
import { SORT_OPTIONS } from "../library/libraryModel";
import {
  DEFAULT_SETTINGS,
  PAGE_SIZE_OPTIONS,
  formatByteLimit,
  normalizeSettings,
} from "./settingsModel";

export function SettingsPanel({ settings = DEFAULT_SETTINGS, saving = false, onCancel, onSave }) {
  const [draft, setDraft] = useState(() => normalizeSettings(settings));

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape" && !saving) onCancel();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onCancel, saving]);

  function updateSort(key, direction) {
    setDraft((current) => ({
      ...current,
      defaultSort: { key, direction },
    }));
  }

  return (
    <div
      className="library-dialog-backdrop"
      data-tauri-drag-region="false"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !saving) onCancel();
      }}
    >
      <section className="library-dialog settings-dialog" data-tauri-drag-region="false" role="dialog" aria-modal="true" aria-labelledby="settings-dialog-title">
        <header className="library-dialog-header">
          <div className="settings-dialog-title">
            <GearSix size={21} weight="regular" aria-hidden="true" />
            <h2 id="settings-dialog-title">设置</h2>
          </div>
          <button type="button" className="dialog-close-button" aria-label="关闭设置" title="关闭设置" disabled={saving} onClick={onCancel}>
            <X size={18} weight="regular" />
          </button>
        </header>
        <div className="library-dialog-body settings-dialog-body">
          <section className="settings-section" aria-labelledby="settings-library-title">
            <h3 id="settings-library-title">资料库</h3>
            <div className="settings-grid">
              <label className="settings-field">
                <span>默认排序</span>
                <select
                  value={draft.defaultSort.key}
                  onChange={(event) => updateSort(event.target.value, draft.defaultSort.direction)}
                >
                  {SORT_OPTIONS.map((option) => (
                    <option value={option.key} key={option.key}>{option.label}</option>
                  ))}
                </select>
              </label>
              <label className="settings-field">
                <span>排序方向</span>
                <select
                  value={draft.defaultSort.direction}
                  onChange={(event) => updateSort(draft.defaultSort.key, event.target.value)}
                >
                  <option value="desc">降序</option>
                  <option value="asc">升序</option>
                </select>
              </label>
              <label className="settings-field">
                <span>每页数量</span>
                <select
                  value={draft.pageSize}
                  onChange={(event) => setDraft((current) => ({ ...current, pageSize: Number(event.target.value) }))}
                >
                  {PAGE_SIZE_OPTIONS.map((pageSize) => (
                    <option value={pageSize} key={pageSize}>{pageSize} 条</option>
                  ))}
                </select>
              </label>
            </div>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={draft.confirmBeforeRemove}
                onChange={(event) => setDraft((current) => ({ ...current, confirmBeforeRemove: event.target.checked }))}
              />
              <span>从资料库移除记录前确认</span>
            </label>
            <p className="settings-hint">删除原文件始终显示影响范围确认，不能通过设置跳过。</p>
          </section>

          <section className="settings-section" aria-labelledby="settings-window-title">
            <h3 id="settings-window-title">窗口</h3>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={draft.hideToTray}
                onChange={(event) => setDraft((current) => ({ ...current, hideToTray: event.target.checked }))}
              />
              <span>关闭窗口时隐藏到系统托盘</span>
            </label>
            <label className="settings-checkbox">
              <input
                type="checkbox"
                checked={draft.showFloatingWindow}
                onChange={(event) => setDraft((current) => ({ ...current, showFloatingWindow: event.target.checked }))}
              />
              <span>显示悬浮窗</span>
            </label>
            <p className="settings-hint">
              浏览器回退模式仅在当前会话生效；桌面端设置会在下次启动恢复。
            </p>
          </section>

          <section className="settings-section" aria-labelledby="settings-preview-title">
            <h3 id="settings-preview-title">预览限制</h3>
            <ul className="settings-limit-list">
              {draft.previewLimits.map((limit) => (
                <li key={limit.label}>
                  <span>{limit.label}</span>
                  <span>{formatByteLimit(limit.maxBytes)}{limit.maxPixels ? `，${limit.maxPixels / 1_000_000} 百万像素` : ""}</span>
                </li>
              ))}
            </ul>
            <p className="settings-hint">限制由应用安全策略固定，设置只提供查看，不会放宽读取上限。</p>
          </section>
        </div>
        <footer className="library-dialog-actions">
          <button type="button" className="dialog-button dialog-button-secondary" disabled={saving} onClick={onCancel}>
            取消
          </button>
          <button type="button" className="dialog-button dialog-button-primary" disabled={saving} onClick={() => onSave(draft)}>
            <Check size={17} weight="bold" />
            <span>{saving ? "保存中..." : "保存设置"}</span>
          </button>
        </footer>
      </section>
    </div>
  );
}
