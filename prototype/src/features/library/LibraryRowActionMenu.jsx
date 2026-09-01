import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowSquareOut,
  Copy,
  DotsThree,
  FolderOpen,
  FolderSimple,
  Info,
  PencilSimple,
  Star,
  Tag,
  TrashSimple,
} from "@phosphor-icons/react";
import {
  ROW_ACTION_MENU_ESTIMATED_HEIGHT,
  ROW_ACTION_MENU_WIDTH,
  getRowActionMenuPosition,
} from "./libraryOverlayModel.js";

export function LibraryRowActions({
  file,
  persistent,
  contextKey,
  busy,
  onFavorite,
  onRemove,
  onCopy,
  onRename,
  onDelete,
  onOpenDefault,
  onReveal,
  onDetails,
  onEditTags,
  onSetGroup,
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);
  const menuRef = useRef(null);
  const menuTriggerRef = useRef(null);
  const menuId = useId();
  const isFavorite = Boolean(file.favorite);
  const isFolder = file.kind === "folder";
  const isInvalid = Boolean(file.invalid);

  const closeMenu = useCallback((restoreFocus = true) => {
    setMenuOpen(false);
    setMenuPosition(null);
    if (restoreFocus) window.requestAnimationFrame(() => menuTriggerRef.current?.focus());
  }, []);

  const calculateMenuPosition = useCallback(() => {
    const trigger = menuTriggerRef.current;
    if (!trigger) return null;
    const menu = menuRef.current;
    const viewport = window.visualViewport;
    return getRowActionMenuPosition(trigger.getBoundingClientRect(), {
      viewportWidth: viewport?.width || window.innerWidth,
      viewportHeight: viewport?.height || window.innerHeight,
      menuWidth: menu?.offsetWidth || ROW_ACTION_MENU_WIDTH,
      menuHeight: menu?.scrollHeight || ROW_ACTION_MENU_ESTIMATED_HEIGHT,
    });
  }, []);

  const updateMenuPosition = useCallback(() => {
    const nextPosition = calculateMenuPosition();
    if (!nextPosition) {
      closeMenu(false);
      return;
    }
    setMenuPosition((current) => positionsEqual(current, nextPosition) ? current : nextPosition);
  }, [calculateMenuPosition, closeMenu]);

  useLayoutEffect(() => {
    if (!menuOpen) return undefined;
    updateMenuPosition();
    const frameId = window.requestAnimationFrame(() => {
      updateMenuPosition();
      menuRef.current?.querySelector('[role="menuitem"]')?.focus();
    });
    return () => window.cancelAnimationFrame(frameId);
  }, [menuOpen, updateMenuPosition]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    function handlePointerDown(event) {
      if (menuRef.current?.contains(event.target) || menuTriggerRef.current?.contains(event.target)) return;
      closeMenu(false);
    }
    document.addEventListener("pointerdown", handlePointerDown, true);
    document.addEventListener("scroll", updateMenuPosition, true);
    window.addEventListener("resize", updateMenuPosition);
    window.visualViewport?.addEventListener("resize", updateMenuPosition);
    window.visualViewport?.addEventListener("scroll", updateMenuPosition);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown, true);
      document.removeEventListener("scroll", updateMenuPosition, true);
      window.removeEventListener("resize", updateMenuPosition);
      window.visualViewport?.removeEventListener("resize", updateMenuPosition);
      window.visualViewport?.removeEventListener("scroll", updateMenuPosition);
    };
  }, [closeMenu, menuOpen, updateMenuPosition]);

  useLayoutEffect(() => {
    if (menuOpen) closeMenu(false);
  }, [closeMenu, contextKey]);

  useEffect(() => {
    if (busy && menuOpen) closeMenu(false);
  }, [busy, closeMenu, menuOpen]);

  if (!persistent) return null;

  function run(action) {
    document.querySelectorAll("[data-dialog-return-focus=\"true\"]").forEach((element) => element.removeAttribute("data-dialog-return-focus"));
    menuTriggerRef.current?.setAttribute("data-dialog-return-focus", "true");
    closeMenu();
    action?.(file);
  }

  function handleMenuKeyDown(event) {
    const items = [...(menuRef.current?.querySelectorAll('[role="menuitem"]') || [])];
    if (!items.length) return;
    const currentIndex = items.indexOf(document.activeElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      items[(currentIndex + direction + items.length) % items.length].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      items[0].focus();
    } else if (event.key === "End") {
      event.preventDefault();
      items.at(-1).focus();
    } else if (event.key === "Escape") {
      event.preventDefault();
      closeMenu();
    } else if (event.key === "Tab") {
      event.preventDefault();
      closeMenu();
    }
  }

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
        <Star size={18} weight={isFavorite ? "fill" : "regular"} aria-hidden="true" />
      </button>
      <button
        type="button"
        className="row-action-button row-action-menu-trigger"
        ref={menuTriggerRef}
        aria-label="打开资料操作菜单"
        title="更多操作"
        aria-haspopup="menu"
        aria-controls={menuId}
        aria-expanded={menuOpen}
        disabled={busy}
        onClick={() => {
          if (menuOpen) closeMenu();
          else {
            setMenuPosition(calculateMenuPosition());
            setMenuOpen(true);
          }
        }}
      >
        <DotsThree size={20} weight="bold" aria-hidden="true" />
      </button>
      {menuOpen && menuPosition && typeof document !== "undefined" && createPortal(
        <div
          ref={menuRef}
          id={menuId}
          className="row-action-menu"
          role="menu"
          aria-label={`${file.name} 的操作`}
          data-placement={menuPosition.placement}
          style={{
            top: `${menuPosition.top}px`,
            left: `${menuPosition.left}px`,
            width: `${menuPosition.width}px`,
            maxHeight: `${menuPosition.maxHeight}px`,
          }}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleMenuKeyDown}
        >
          <div role="group" aria-label="资料信息">
            <MenuAction icon={Info} label="查看资料详情" onClick={() => run(onDetails)} />
            <MenuAction icon={Tag} label="编辑标签" onClick={() => run(onEditTags)} />
            <MenuAction icon={FolderSimple} label="设置分组" onClick={() => run(onSetGroup)} />
          </div>
          <div className="row-action-menu-common" role="group" aria-label="常用操作">
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
        </div>,
        document.body,
      )}
    </div>
  );
}

function positionsEqual(left, right) {
  return left?.left === right.left
    && left?.top === right.top
    && left?.width === right.width
    && left?.maxHeight === right.maxHeight
    && left?.placement === right.placement;
}

function MenuAction({ icon: Icon, label, danger = false, onClick }) {
  return (
    <button type="button" className={`row-action-menu-item ${danger ? "is-danger" : ""}`} role="menuitem" onClick={(event) => { event.stopPropagation(); onClick(); }}>
      <Icon size={16} weight="regular" aria-hidden="true" />
      <span>{label}</span>
    </button>
  );
}
