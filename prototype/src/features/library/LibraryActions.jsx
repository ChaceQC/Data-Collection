import { useEffect, useRef, useState } from "react";
import {
  ArrowSquareOut,
  Copy,
  DotsThree,
  FolderOpen,
  PencilSimple,
  Star,
  TrashSimple,
} from "@phosphor-icons/react";
import { Dialog } from "../../components/Dialog.jsx";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const isFavorite = Boolean(file.favorite);
  const isFolder = file.kind === "folder";
  const isInvalid = Boolean(file.invalid);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handlePointerDown(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function handleKeyDown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  if (!persistent) return null;

  function run(action) {
    document.querySelectorAll("[data-dialog-return-focus=\"true\"]").forEach((element) => element.removeAttribute("data-dialog-return-focus"));
    menuTriggerRef.current?.setAttribute("data-dialog-return-focus", "true");
    setMenuOpen(false);
    action(file);
  }

  return (
    <div className="file-row-actions" ref={menuRef} onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        className={`row-action-button ${isFavorite ? "is-favorite" : ""}`}
        aria-label={isFavorite ? "取消收藏" : "收藏"}
        aria-pressed={isFavorite}
        title={isFavorite ? "取消收藏" : "收藏"}
        disabled={busy}
        onClick={() => onFavorite(file)}
      >
        <Star size={18} weight={isFavorite ? "fill" : "regular"} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="row-action-button row-action-menu-trigger"
        ref={menuTriggerRef}
        aria-label="打开资料操作菜单"
        title="更多操作"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={() => setMenuOpen((value) => !value)}
      >
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </button>
      {menuOpen && (
        <div className="row-action-menu" role="menu" aria-label={`${file.name} 的操作`}>
          <div role="group" aria-label="常用操作">
            {!isInvalid && !isFolder && (
              <MenuAction icon={ArrowSquareOut} label="用默认程序打开" onClick={() => run(onOpenDefault)} />
            )}
            {!isInvalid && <MenuAction icon={FolderOpen} label="在资源管理器中定位" onClick={() => run(onReveal)} />}
            {!isInvalid && !isFolder && <MenuAction icon={Copy} label="复制到剪贴板" onClick={() => run(onCopy)} />}
            {!isInvalid && !isFolder && <MenuAction icon={PencilSimple} label="重命名文件" onClick={() => run(onRename)} />}
            <MenuAction icon={TrashSimple} label="从资料库移除" danger onClick={() => run(onRemove)} />
          </div>
          {!isInvalid && !isFolder && (
            <div className="row-action-menu-danger" role="group" aria-label="危险操作">
              <MenuAction icon={TrashSimple} label="删除原文件并移入回收站" danger onClick={() => run(onDelete)} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MenuAction({ icon: Icon, label, danger = false, onClick }) {
  return (
    <button type="button" className={`row-action-menu-item ${danger ? "is-danger" : ""}`} role="menuitem" onClick={onClick}>
      <Icon size={16} weight="regular" aria-hidden="true" />
      <span>{label}</span>
    </button>
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
        <div><dt>位置</dt><dd title={file.path || "桌面应用中的资料"}>{file.path || "桌面应用中的资料"}</dd></div>
      </dl>
    </LibraryActionDialog>
  );
}
