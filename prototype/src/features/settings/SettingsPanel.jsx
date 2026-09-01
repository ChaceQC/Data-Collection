import { useEffect, useRef, useState } from "react";
import { Check, GearSix } from "@phosphor-icons/react";
import { Dialog, DialogCloseButton } from "../../components/Dialog.jsx";
import { SORT_OPTIONS } from "../library/libraryModel";
import { DEFAULT_SETTINGS, PAGE_SIZE_OPTIONS, formatByteLimit, normalizeSettings } from "./settingsModel";

export function SettingsPanel({ settings = DEFAULT_SETTINGS, saving = false, onCancel, onSave }) {
  const initialSettings = normalizeSettings(settings);
  const [draft, setDraft] = useState(() => initialSettings);
  const baseRef = useRef(initialSettings);
  const draftRef = useRef(initialSettings);
  const editedFieldsRef = useRef(new Set());
  const [conflict, setConflict] = useState(false);

  useEffect(() => {
    const nextSettings = normalizeSettings(settings);
    const previousSettings = baseRef.current;
    const changedFields = getChangedFields(previousSettings, nextSettings);
    if (!changedFields.length) return;
    if (!editedFieldsRef.current.size) {
      baseRef.current = nextSettings;
      draftRef.current = nextSettings;
      setDraft(nextSettings);
      setConflict(false);
      return;
    }

    const nextDraft = { ...draftRef.current };
    const nextBase = { ...baseRef.current };
    for (const field of changedFields) {
      if (editedFieldsRef.current.has(field)) continue;
      nextDraft[field] = field === "defaultSort" ? { ...nextSettings.defaultSort } : nextSettings[field];
      nextBase[field] = nextDraft[field];
    }
    baseRef.current = nextBase;
    draftRef.current = nextDraft;
    setDraft(nextDraft);
    setConflict(true);
  }, [settings]);

  function updateSort(key, direction) {
    updateField("defaultSort", { key, direction });
  }

  function updateField(field, value) {
    const next = { ...draftRef.current, [field]: value };
    if (field === "defaultSort") next.defaultSort = { ...value };
    draftRef.current = next;
    editedFieldsRef.current.add(field);
    setDraft(next);
  }

  function useLatestSettings() {
    const latest = normalizeSettings(settings);
    baseRef.current = latest;
    draftRef.current = latest;
    editedFieldsRef.current.clear();
    setDraft(latest);
    setConflict(false);
  }

  return (
    <Dialog
      title="设置"
      description={<span className="sr-only">设置本地资料库的排序、窗口和预览限制。</span>}
      className="settings-dialog"
      busy={saving}
      onClose={onCancel}
      header={({ titleId }) => (
        <header className="library-dialog-header">
          <div className="settings-dialog-title"><GearSix size={21} weight="regular" aria-hidden="true" /><h2 id={titleId}>设置</h2></div>
          <DialogCloseButton label="关闭设置" disabled={saving} onClick={onCancel} />
        </header>
      )}
      bodyClassName="library-dialog-body settings-dialog-body"
      footer={(
        <>
          <button type="button" className="dialog-button dialog-button-secondary" disabled={saving} onClick={onCancel}>取消</button>
          <button type="button" className="dialog-button dialog-button-primary" disabled={saving} onClick={() => onSave(draftRef.current, [...editedFieldsRef.current])}><Check size={17} weight="bold" aria-hidden="true" /><span>{saving ? "保存中..." : "保存设置"}</span></button>
        </>
      )}
    >
      {conflict && <div className="settings-conflict" role="alert"><span>设置已在其他窗口更新。保存时只会覆盖本次编辑的字段。</span><button type="button" className="text-button" disabled={saving} onClick={useLatestSettings}>使用最新设置</button></div>}
      <section className="settings-section" aria-labelledby="settings-library-title">
        <h3 id="settings-library-title">资料库</h3>
        <div className="settings-grid">
          <label className="settings-field"><span>默认排序</span><select value={draft.defaultSort.key} onChange={(event) => updateSort(event.target.value, draft.defaultSort.direction)}>{SORT_OPTIONS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
          <label className="settings-field"><span>排序方向</span><select value={draft.defaultSort.direction} onChange={(event) => updateSort(draft.defaultSort.key, event.target.value)}><option value="desc">降序</option><option value="asc">升序</option></select></label>
          <label className="settings-field"><span>每页数量</span><select value={draft.pageSize} onChange={(event) => updateField("pageSize", Number(event.target.value))}>{PAGE_SIZE_OPTIONS.map((size) => <option value={size} key={size}>{size} 条</option>)}</select></label>
        </div>
        <label className="settings-checkbox"><input type="checkbox" checked={draft.confirmBeforeRemove} onChange={(event) => updateField("confirmBeforeRemove", event.target.checked)} /><span>从资料库移除记录前确认</span></label>
        <p className="settings-hint">删除原文件始终显示影响范围确认，不能通过设置跳过。</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-window-title">
        <h3 id="settings-window-title">窗口</h3>
        <label className="settings-checkbox"><input type="checkbox" checked={draft.hideToTray} onChange={(event) => updateField("hideToTray", event.target.checked)} /><span>关闭窗口时隐藏到系统托盘</span></label>
        <label className="settings-checkbox"><input type="checkbox" checked={draft.showFloatingWindow} onChange={(event) => updateField("showFloatingWindow", event.target.checked)} /><span>显示悬浮窗</span></label>
        <p className="settings-hint">浏览器回退模式仅在当前会话生效；桌面端设置会在下次启动恢复。</p>
      </section>

      <section className="settings-section" aria-labelledby="settings-preview-title">
        <h3 id="settings-preview-title">预览限制</h3>
        <ul className="settings-limit-list">{draft.previewLimits.map((limit) => <li key={limit.label}><span>{limit.label}</span><span>{formatByteLimit(limit.maxBytes)}{limit.maxPixels ? `，${limit.maxPixels / 1_000_000} 百万像素` : ""}</span></li>)}</ul>
        <p className="settings-hint">限制由应用安全策略固定，设置只提供查看，不会放宽读取上限。</p>
      </section>
    </Dialog>
  );
}

function getChangedFields(previous, next) {
  const fields = [];
  if (previous.defaultSort.key !== next.defaultSort.key || previous.defaultSort.direction !== next.defaultSort.direction) fields.push("defaultSort");
  for (const field of ["pageSize", "confirmBeforeRemove", "hideToTray", "showFloatingWindow"]) {
    if (previous[field] !== next[field]) fields.push(field);
  }
  return fields;
}
