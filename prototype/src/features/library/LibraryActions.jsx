import { useRef, useState } from "react";
import {
  ArrowCounterClockwise,
  Check,
  PencilSimpleLine,
  Plus,
  Star,
  Tag,
  TrashSimple,
  X,
} from "@phosphor-icons/react";
import { Dialog } from "../../components/Dialog.jsx";
import { countEntriesInGroup, formatFileSize, getEntryLocation } from "./libraryModel";

export function LibraryActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
  children,
  confirmDisabled = false,
  initialFocusRef,
}) {
  return (
    <Dialog
      title={title}
      description={description}
      busy={busy}
      onClose={onCancel}
      initialFocusRef={initialFocusRef}
      footer={(
        <>
          <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onCancel}>取消</button>
          <button type="button" className={`dialog-button ${danger ? "dialog-button-danger" : "dialog-button-primary"}`} disabled={busy || confirmDisabled} onClick={onConfirm}>
            {busy ? "处理中..." : confirmLabel}
          </button>
        </>
      )}
    >
      {children}
    </Dialog>
  );
}

export function RenameDialog({ file, value, validation = { valid: true, errors: [] }, busy, onChange, onCancel, onConfirm }) {
  const inputRef = useRef(null);
  const hasErrors = validation.errors.length > 0;
  return (
    <LibraryActionDialog
      title="重命名文件"
      description={`只修改“${file.name}”的文件名，文件内容和所在文件夹不变。`}
      confirmLabel="重命名"
      busy={busy}
      confirmDisabled={!validation.valid}
      initialFocusRef={inputRef}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <label className="dialog-field">
        <span>新文件名</span>
        <input
          ref={inputRef}
          value={value}
          aria-invalid={hasErrors}
          aria-describedby={hasErrors ? "rename-errors rename-hint" : "rename-hint"}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && validation.valid && !busy) onConfirm();
          }}
        />
      </label>
      <p id="rename-hint" className="dialog-hint">文件扩展名必须保持不变；文件名不能包含 Windows 不允许的字符。</p>
      {hasErrors && (
        <ul id="rename-errors" className="dialog-errors" role="alert">
          {validation.errors.map((error) => <li key={error.code}>{error.message}</li>)}
        </ul>
      )}
    </LibraryActionDialog>
  );
}

export function RemoveIndexDialog({ file, busy, onCancel, onConfirm }) {
  return (
    <LibraryActionDialog
      title="从资料库移除"
      description={`将移除“${file.name}”这条本地索引记录，原文件和文件夹内容不会被删除。`}
      confirmLabel="移除记录"
      danger
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function DeleteOriginalDialog({ file, busy, onCancel, onConfirm }) {
  const location = getEntryLocation(file);
  return (
    <LibraryActionDialog
      title="删除原文件"
      description={`“${file.name}”将被移入系统回收站，这会影响磁盘上的原文件。该操作不支持文件夹。`}
      confirmLabel="移入回收站"
      danger
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <dl className="dialog-details">
        <div><dt>类型</dt><dd>{file.type || file.fileType || "文件"}</dd></div>
        <div><dt>大小</dt><dd>{formatFileSize(file.size)}</dd></div>
        <div><dt>位置</dt><dd title={location.fullPath || "桌面应用中的资料"}>{location.fullPath || "桌面应用中的资料"}</dd></div>
      </dl>
    </LibraryActionDialog>
  );
}

export function BatchRemoveDialog({ files, busy, onCancel, onConfirm }) {
  const names = (files || []).map((file) => file.name).filter(Boolean);
  const preview = names.slice(0, 4).join("、");
  const suffix = names.length > 4 ? ` 等 ${names.length} 项` : `（${names.length} 项）`;
  return (
    <LibraryActionDialog
      title="批量从资料库移除"
      description={`只移除选中的索引记录，原文件和文件夹内容不会被删除。${preview}${suffix}`}
      confirmLabel="移除记录"
      danger
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    />
  );
}

export function BulkLibraryToolbar({
  selectedIds,
  visibleSelectedCount,
  groups,
  busy,
  retryBatch,
  undoStatus,
  onBatchFavorite,
  onBatchGroup,
  onBatchTags,
  onBatchRemove,
  onUndo,
  onRetry,
  onCancelBatch,
  onClear,
}) {
  const [tagValue, setTagValue] = useState("");
  const [groupId, setGroupId] = useState("__unset__");
  const ids = selectedIds || [];
  const visibleCount = Number.isFinite(visibleSelectedCount) ? visibleSelectedCount : ids.length;
  const hasTag = Boolean(tagValue.trim());
  const hasGroup = groupId !== "__unset__";
  return (
    <div className="library-bulk-toolbar" role="region" aria-label="批量操作">
      <strong>当前列表 {visibleCount} 项 / 共 {ids.length} 项已选</strong>
      <div className="bulk-action-group" role="group" aria-label="收藏操作">
        <button type="button" className="bulk-action-button" disabled={busy} onClick={() => onBatchFavorite(ids, true)}><Star size={16} weight="fill" aria-hidden="true" />收藏</button>
        <button type="button" className="bulk-action-button" disabled={busy} onClick={() => onBatchFavorite(ids, false)}><Star size={16} weight="regular" aria-hidden="true" />取消收藏</button>
      </div>
      <div className="bulk-action-group bulk-tag-group" role="group" aria-label="标签操作">
        <label className="bulk-input-label"><span className="sr-only">批量标签</span><input value={tagValue} placeholder="输入标签" maxLength={32} onChange={(event) => setTagValue(event.target.value)} /></label>
        <button type="button" className="bulk-action-button" disabled={busy || !hasTag} onClick={() => onBatchTags(ids, tagValue, true)}><Tag size={16} weight="regular" aria-hidden="true" />添加标签</button>
        <button type="button" className="bulk-action-button" disabled={busy || !hasTag} onClick={() => onBatchTags(ids, tagValue, false)}><Tag size={16} weight="regular" aria-hidden="true" />移除标签</button>
      </div>
      <div className="bulk-action-group" role="group" aria-label="分组操作">
        <label className="sr-only" htmlFor="bulk-group-select">批量分组</label>
        <select id="bulk-group-select" value={groupId} disabled={busy} onChange={(event) => setGroupId(event.target.value)}>
          <option value="__unset__">选择分组</option>
          <option value="">取消分组</option>
          {(groups || []).map((group) => <option value={group.id} key={group.id}>{group.name}</option>)}
        </select>
        <button type="button" className="bulk-action-button" disabled={busy || !hasGroup} onClick={() => onBatchGroup(ids, groupId)}><Plus size={16} weight="bold" aria-hidden="true" />应用分组</button>
      </div>
      <button type="button" className="bulk-action-button bulk-action-danger" disabled={busy} onClick={() => onBatchRemove(ids)}><TrashSimple size={16} weight="regular" aria-hidden="true" />移除索引</button>
      {undoStatus && <button type="button" className="bulk-action-button bulk-action-undo" disabled={busy} onClick={onUndo}><ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />撤销上一项</button>}
      {retryBatch && !busy && <button type="button" className="bulk-action-button" onClick={onRetry}><ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />重试 {retryBatch.fileIds.length} 项</button>}
      {busy && <button type="button" className="bulk-action-button bulk-action-cancel" onClick={onCancelBatch}><X size={16} weight="bold" aria-hidden="true" />取消批量操作</button>}
      <button type="button" className="bulk-clear-button" disabled={busy} aria-label="取消选择" title="取消选择" onClick={onClear}><X size={17} weight="bold" aria-hidden="true" /></button>
    </div>
  );
}

export function GroupManagerDialog({ groups, files = [], busy, onClose, onCreate, onRename, onDelete }) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editingName, setEditingName] = useState("");
  const [deleteTarget, setDeleteTarget] = useState(null);

  async function create() {
    if (await onCreate(newName)) setNewName("");
  }

  async function rename() {
    if (await onRename(editingId, editingName)) {
      setEditingId("");
      setEditingName("");
    }
  }

  function startRename(group) {
    setEditingId(group.id);
    setEditingName(group.name);
  }

  async function confirmDelete() {
    if (!deleteTarget || busy) return;
    if (await onDelete(deleteTarget.id)) setDeleteTarget(null);
  }

  if (deleteTarget) {
    const affectedCount = countEntriesInGroup(files, deleteTarget.id);
    return (
      <Dialog
        title="确认删除分组"
        description={`删除“${deleteTarget.name}”只会解除资料的分组归属，不会删除资料记录或原文件。`}
        busy={busy}
        onClose={() => setDeleteTarget(null)}
        footer={(
          <>
            <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={() => setDeleteTarget(null)}>取消</button>
            <button type="button" className="dialog-button dialog-button-danger" disabled={busy} onClick={() => void confirmDelete()}>{busy ? "处理中..." : "删除分组"}</button>
          </>
        )}
      >
        <div className="group-delete-confirmation">
          <strong>{deleteTarget.name}</strong>
          <p>当前有 {affectedCount} 项资料属于此分组。删除后这些资料仍保留在资料库和原位置。</p>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      title="管理分组"
      description="分组只整理索引元数据；删除分组只解除资料归属，不删除资料记录或原文件。"
      onClose={onClose}
      footer={<button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onClose}>完成</button>}
    >
      <div className="group-manager">
        <div className="group-create-row">
          <label className="sr-only" htmlFor="new-group-name">新分组名称</label>
          <input id="new-group-name" value={newName} maxLength={64} placeholder="新建分组" disabled={busy} onChange={(event) => setNewName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void create(); }} />
          <button type="button" className="dialog-button dialog-button-primary" disabled={busy || !newName.trim()} onClick={() => void create()}><Plus size={16} weight="bold" aria-hidden="true" />新建</button>
        </div>
        {groups?.length ? (
          <ul className="group-list">
            {groups.map((group) => (
              <li key={group.id}>
                {editingId === group.id ? (
                  <>
                    <label className="sr-only" htmlFor={`group-name-${group.id}`}>分组名称</label>
                    <input id={`group-name-${group.id}`} value={editingName} maxLength={64} disabled={busy} onChange={(event) => setEditingName(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void rename(); }} />
                    <button type="button" className="icon-button" aria-label="保存分组名称" title="保存" disabled={busy || !editingName.trim()} onClick={() => void rename()}><Check size={17} weight="bold" aria-hidden="true" /></button>
                    <button type="button" className="icon-button" aria-label="取消重命名" title="取消" disabled={busy} onClick={() => setEditingId("")}><X size={17} weight="bold" aria-hidden="true" /></button>
                  </>
                ) : (
                  <>
                    <span className="group-name">{group.name}</span>
                    <button type="button" className="icon-button" aria-label={`重命名分组 ${group.name}`} title="重命名" disabled={busy} onClick={() => startRename(group)}><PencilSimpleLine size={17} weight="regular" aria-hidden="true" /></button>
                    <button type="button" className="icon-button group-delete-button" aria-label={`删除分组 ${group.name}，只解除归属`} title="删除分组（只解除归属）" disabled={busy} onClick={() => setDeleteTarget(group)}><TrashSimple size={17} weight="regular" aria-hidden="true" /></button>
                  </>
                )}
              </li>
            ))}
          </ul>
        ) : <p className="group-empty">还没有分组。</p>}
      </div>
    </Dialog>
  );
}
