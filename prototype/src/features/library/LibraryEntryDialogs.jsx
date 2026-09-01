import { useRef } from "react";
import {
  ArrowSquareOut,
  Copy,
  FolderOpen,
  FolderSimple,
  PencilSimpleLine,
  Plus,
  Star,
  Tag,
  X,
} from "@phosphor-icons/react";
import { Dialog } from "../../components/Dialog.jsx";
import {
  formatFileSize,
  getDisplayType,
  getEntryLocation,
} from "./libraryModel";
import { getGroupName, getModifiedLabel } from "./LibraryPanelParts.jsx";
import {
  MAX_TAGS_PER_ENTRY,
  normalizeTagInput,
  validateTagInput,
} from "./libraryControllerModel.js";

export function EditTagsDialog({
  file,
  tags = [],
  tagInput,
  busy,
  onInputChange,
  onAdd,
  onRemove,
  onCancel,
  onConfirm,
}) {
  const inputRef = useRef(null);
  const inputValidation = tagInput ? validateTagInput(tagInput) : { valid: true, message: "" };
  const normalizedInput = normalizeTagInput(tagInput);
  const duplicate = normalizedInput && tags.some((tag) => tag.toLocaleLowerCase("zh-CN") === normalizedInput.toLocaleLowerCase("zh-CN"));
  const inputMessage = tagInput && (!inputValidation.valid ? inputValidation.message : duplicate ? "该标签已经存在" : "");
  const canAdd = Boolean(normalizedInput) && inputValidation.valid && !duplicate && tags.length < MAX_TAGS_PER_ENTRY;

  function handleSubmit(event) {
    event.preventDefault();
    if (canAdd && !busy) onAdd();
  }

  return (
    <Dialog
      title="编辑标签"
      description={`维护“${file.name}”的标签；标签只保存到本地索引，不会写入原文件。`}
      busy={busy}
      onClose={onCancel}
      initialFocusRef={inputRef}
      className="entry-editor-dialog"
      footer={(
        <>
          <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="dialog-button dialog-button-primary" disabled={busy} onClick={onConfirm}>保存标签</button>
        </>
      )}
    >
      <div className="tag-editor">
        <div className="tag-editor-list" role="list" aria-label="当前标签">
          {tags.length ? tags.map((tag) => (
            <span className="editable-tag-chip" role="listitem" key={tag}>
              <span>{tag}</span>
              <button type="button" className="tag-remove-button" aria-label={`移除标签 ${tag}`} title={`移除标签 ${tag}`} disabled={busy} onClick={() => onRemove(tag)}>
                <X size={13} weight="bold" aria-hidden="true" />
              </button>
            </span>
          )) : <span className="tag-editor-empty">暂无标签</span>}
        </div>
        <form className="tag-editor-form" onSubmit={handleSubmit}>
          <label className="dialog-field" htmlFor="entry-tag-input">
            <span>添加标签</span>
            <span className="tag-editor-input-row">
              <input ref={inputRef} id="entry-tag-input" value={tagInput} aria-invalid={Boolean(inputMessage)} aria-describedby="entry-tag-hint entry-tag-message" onChange={(event) => onInputChange(event.target.value)} disabled={busy || tags.length >= MAX_TAGS_PER_ENTRY} />
              <button type="submit" className="dialog-button dialog-button-secondary" disabled={busy || !canAdd}><Plus size={16} weight="bold" aria-hidden="true" />添加</button>
            </span>
          </label>
        </form>
        <p id="entry-tag-hint" className="dialog-hint">已添加 {tags.length} / {MAX_TAGS_PER_ENTRY} 个标签；单个标签最多 32 个字符。</p>
        <p id="entry-tag-message" className={`dialog-inline-message ${inputMessage ? "is-error" : ""}`} role={inputMessage ? "alert" : undefined}>{inputMessage || "重复标签会自动拦截，保存时仍由桌面端校验。"}</p>
      </div>
    </Dialog>
  );
}

export function EditGroupDialog({ file, groups = [], value, busy, onChange, onCancel, onConfirm }) {
  return (
    <Dialog
      title="设置分组"
      description={`为“${file.name}”选择一个分组；选择未分组会解除当前归属。`}
      busy={busy}
      onClose={onCancel}
      className="entry-editor-dialog"
      footer={(
        <>
          <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className="dialog-button dialog-button-primary" disabled={busy} onClick={onConfirm}>保存分组</button>
        </>
      )}
    >
      <label className="dialog-field" htmlFor="entry-group-select">
        <span>所属分组</span>
        <span className="entry-group-select-row">
          <FolderSimple size={18} weight="regular" aria-hidden="true" />
          <select id="entry-group-select" value={value} disabled={busy} onChange={(event) => onChange(event.target.value)}>
            <option value="">未分组</option>
            {groups.map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
          </select>
        </span>
      </label>
    </Dialog>
  );
}

export function EntryDetailsDialog({
  file,
  groups = [],
  directoryView,
  busy,
  onClose,
  onFavorite,
  onPreview,
  onCopyLocation,
  onReveal,
  onOpenDefault,
  onEditTags,
  onSetGroup,
  onTagClick,
}) {
  if (!file) return null;
  const location = getEntryLocation(file, directoryView);
  const isFolder = file.kind === "folder";
  const canPreview = !file.invalid && !isFolder && typeof onPreview === "function";
  const canReveal = !file.invalid && typeof onReveal === "function";
  const canOpenDefault = !file.invalid && !isFolder && typeof onOpenDefault === "function";
  const tags = Array.isArray(file.tags) ? file.tags : [];

  return (
    <Dialog
      title="资料详情"
      description={`“${file.name}”的本地索引信息和常用操作。`}
      busy={busy}
      onClose={onClose}
      className="entry-details-dialog"
      footer={<button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onClose}>关闭</button>}
    >
      <div className="entry-details">
        <div className="entry-details-title">
          <strong title={file.name}>{file.name}</strong>
          <span>{getDisplayType(file)}</span>
        </div>
        <dl className="entry-details-list">
          <DetailField label="名称" value={file.name} title={file.name} />
          <DetailField label="类型" value={getDisplayType(file)} />
          <DetailField label="大小" value={isFolder ? "—" : formatFileSize(file.size)} />
          <DetailField label="修改时间" value={getModifiedLabel(file)} />
          <DetailField label="来源位置" value={location.fullPath || "登记文件夹"} title={location.fullPath || "登记文件夹"} long />
          <DetailField label="状态" value={file.invalid ? "路径失效" : file.status} />
          <DetailField label="收藏" value={file.favorite ? "已收藏" : "未收藏"} />
          <DetailField label="分组" value={getGroupName(file, groups)} />
        </dl>

        <section className="entry-details-section" aria-labelledby="entry-details-tags-title">
          <h3 id="entry-details-tags-title">标签</h3>
          <div className="entry-details-tags">
            {tags.length ? tags.map((tag) => (
              <button type="button" className="file-tag-chip detail-tag-chip" key={tag} title={`按标签“${tag}”筛选`} onClick={() => onTagClick?.(tag)}>{tag}</button>
            )) : <span className="tag-editor-empty">暂无标签</span>}
          </div>
        </section>

        <div className="entry-details-actions" role="group" aria-label="资料快捷操作">
          <DetailAction icon={Star} label={file.favorite ? "取消收藏" : "加入收藏"} disabled={busy} onClick={() => onFavorite?.(file)} />
          <DetailAction icon={ArrowSquareOut} label={canPreview ? "预览资料" : "预览不可用"} disabled={busy || !canPreview} onClick={() => onPreview?.(file)} />
          <DetailAction icon={Copy} label="复制位置" disabled={busy || !location.fullPath || location.fullPath === "登记文件夹"} onClick={() => onCopyLocation?.(file, directoryView)} />
          <DetailAction icon={FolderOpen} label={canReveal ? "定位文件" : "定位不可用"} disabled={busy || !canReveal} onClick={() => onReveal?.(file, directoryView)} />
          <DetailAction icon={ArrowSquareOut} label={canOpenDefault ? "默认程序打开" : "默认打开不可用"} disabled={busy || !canOpenDefault} onClick={() => onOpenDefault?.(file)} />
        </div>
        <div className="entry-details-edit-actions" role="group" aria-label="编辑资料元数据">
          <button type="button" className="text-button" disabled={busy} onClick={() => onEditTags?.(file)}><Tag size={15} weight="regular" aria-hidden="true" />编辑标签</button>
          <button type="button" className="text-button" disabled={busy} onClick={() => onSetGroup?.(file)}><FolderSimple size={15} weight="regular" aria-hidden="true" />设置分组</button>
        </div>
      </div>
    </Dialog>
  );
}

function DetailField({ label, value, title, long = false }) {
  return <div><dt>{label}</dt><dd className={long ? "is-long" : ""} title={title || value}>{value}</dd></div>;
}

function DetailAction({ icon: Icon, label, disabled, onClick }) {
  return <button type="button" className="entry-details-action" disabled={disabled} onClick={onClick}><Icon size={16} weight="regular" aria-hidden="true" /><span>{label}</span></button>;
}
