import { ArrowSquareOut, Copy, FolderOpen, PencilSimple, Star, TrashSimple, X } from "@phosphor-icons/react";
import { formatFileSize } from "./libraryModel";

export function LibraryRowActions({
  file,
  persistent,
  busy,
  onFavorite,
  onRemove,
  onCopy,
  onRename,
  onDelete,
  onOpenDefault,
  onReveal,
}) {
  if (!persistent) return null;
  const isFavorite = Boolean(file.favorite);
  const isFolder = file.kind === "folder";
  const isInvalid = Boolean(file.invalid);
  return (
    <div className="file-row-actions" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`row-action-button ${isFavorite ? "is-favorite" : ""}`}
        aria-label={isFavorite ? "取消收藏" : "收藏"}
        aria-pressed={isFavorite}
        title={isFavorite ? "取消收藏" : "收藏"}
        disabled={busy}
        onClick={() => onFavorite(file)}
      >
        <Star size={18} weight={isFavorite ? "fill" : "regular"} />
      </button>
      <button
        type="button"
        className="row-action-button row-action-danger"
        aria-label="从资料库移除"
        title="从资料库移除"
        disabled={busy}
        onClick={() => onRemove(file)}
      >
        <TrashSimple size={18} weight="regular" />
      </button>
      {!isInvalid && (
        <>
          {!isFolder && (
            <button
              type="button"
              className="row-action-button"
              aria-label="用默认程序打开"
              title="用默认程序打开"
              disabled={busy}
              onClick={() => onOpenDefault(file)}
            >
              <ArrowSquareOut size={18} weight="regular" />
            </button>
          )}
          <button
            type="button"
            className="row-action-button"
            aria-label="在资源管理器中定位"
            title="在资源管理器中定位"
            disabled={busy}
            onClick={() => onReveal(file)}
          >
            <FolderOpen size={18} weight="regular" />
          </button>
          {!isFolder && (
            <>
              <button
                type="button"
                className="row-action-button"
                aria-label="复制到剪贴板"
                title="复制到剪贴板"
                disabled={busy}
                onClick={() => onCopy(file)}
              >
                <Copy size={18} weight="regular" />
              </button>
              <button
                type="button"
                className="row-action-button"
                aria-label="重命名文件"
                title="重命名文件"
                disabled={busy}
                onClick={() => onRename(file)}
              >
                <PencilSimple size={18} weight="regular" />
              </button>
              <button
                type="button"
                className="row-action-button row-action-danger"
                aria-label="删除原文件"
                title="删除原文件"
                disabled={busy}
                onClick={() => onDelete(file)}
              >
                <TrashSimple size={18} weight="fill" />
              </button>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function LibraryActionDialog({
  title,
  description,
  confirmLabel,
  danger = false,
  busy = false,
  onCancel,
  onConfirm,
  children,
}) {
  return (
    <div
      className="library-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onCancel();
      }}
    >
      <section className="library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-dialog-title">
        <header className="library-dialog-header">
          <h2 id="library-dialog-title">{title}</h2>
          <button type="button" className="dialog-close-button" aria-label="关闭" title="关闭" disabled={busy} onClick={onCancel}>
            <X size={18} weight="regular" />
          </button>
        </header>
        <div className="library-dialog-body">
          <p className="library-dialog-description">{description}</p>
          {children}
        </div>
        <footer className="library-dialog-actions">
          <button type="button" className="dialog-button dialog-button-secondary" disabled={busy} onClick={onCancel}>
            取消
          </button>
          <button
            type="button"
            className={`dialog-button ${danger ? "dialog-button-danger" : "dialog-button-primary"}`}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中..." : confirmLabel}
          </button>
        </footer>
      </section>
    </div>
  );
}

export function RenameDialog({ file, value, busy, onChange, onCancel, onConfirm }) {
  return (
    <LibraryActionDialog
      title="重命名文件"
      description={`只修改“${file.name}”的文件名，文件内容和所在文件夹不变。`}
      confirmLabel="重命名"
      busy={busy}
      onCancel={onCancel}
      onConfirm={onConfirm}
    >
      <label className="dialog-field">
        <span>新文件名</span>
        <input autoFocus value={value} onChange={(event) => onChange(event.target.value)} onKeyDown={(event) => {
          if (event.key === "Enter" && value.trim() && !busy) onConfirm();
        }} />
      </label>
      <p className="dialog-hint">文件扩展名必须保持不变。</p>
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
        <div>
          <dt>类型</dt>
          <dd>{file.type || file.fileType || "文件"}</dd>
        </div>
        <div>
          <dt>大小</dt>
          <dd>{formatFileSize(file.size)}</dd>
        </div>
        <div>
          <dt>位置</dt>
          <dd title={file.path || "桌面应用中的资料"}>{file.path || "桌面应用中的资料"}</dd>
        </div>
      </dl>
    </LibraryActionDialog>
  );
}
