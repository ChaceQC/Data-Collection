import { useEffect, useId, useRef } from "react";
import { X } from "@phosphor-icons/react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export function useDialogFocusTrap({ dialogRef, onClose, busy = false, initialFocusRef }) {
  const onCloseRef = useRef(onClose);
  const busyRef = useRef(busy);
  const initialFocusRefRef = useRef(initialFocusRef);
  onCloseRef.current = onClose;
  busyRef.current = busy;
  initialFocusRefRef.current = initialFocusRef;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return undefined;
    const restoreTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusFrame = window.requestAnimationFrame(() => {
      const preferred = initialFocusRefRef.current?.current;
      const target = preferred || dialog.querySelector(FOCUSABLE_SELECTOR) || dialog;
      target.focus();
    });

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (!busyRef.current) {
          event.preventDefault();
          event.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll(FOCUSABLE_SELECTOR)];
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    function handleFocusIn(event) {
      if (dialog.contains(event.target)) return;
      event.preventDefault();
      const preferred = initialFocusRefRef.current?.current;
      const target = preferred || dialog.querySelector(FOCUSABLE_SELECTOR) || dialog;
      target.focus();
    }

    document.addEventListener("keydown", handleKeyDown, true);
    document.addEventListener("focusin", handleFocusIn, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleKeyDown, true);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.body.style.overflow = previousOverflow;
      const fallbackTarget = document.querySelector("[data-dialog-return-focus=\"true\"]");
      const target = restoreTarget?.isConnected ? restoreTarget : fallbackTarget;
      target?.focus();
    };
  }, [dialogRef]);
}

export function Dialog({
  title,
  description,
  onClose,
  busy = false,
  children,
  footer,
  className = "",
  backdropClassName = "library-dialog-backdrop",
  bodyClassName = "library-dialog-body",
  closeLabel = "关闭",
  initialFocusRef,
  header,
  dialogProps = {},
  bodyProps = {},
}) {
  const dialogRef = useRef(null);
  const titleId = useId();
  const descriptionId = useId();
  useDialogFocusTrap({ dialogRef, onClose, busy, initialFocusRef });

  return (
    <div
      className={backdropClassName}
      data-tauri-drag-region="false"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !busy) onClose();
      }}
    >
      <section
        ref={dialogRef}
        className={`library-dialog ${className}`.trim()}
        data-tauri-drag-region="false"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        {...dialogProps}
      >
        {header ? header({ titleId, descriptionId }) : (
          <header className="library-dialog-header">
            <h2 id={titleId}>{title}</h2>
            <DialogCloseButton label={closeLabel} disabled={busy} onClick={onClose} />
          </header>
        )}
        <div className={bodyClassName} {...bodyProps}>
          {description && <p id={descriptionId} className={header ? "sr-only" : "library-dialog-description"}>{description}</p>}
          {children}
        </div>
        {footer && <footer className="library-dialog-actions">{footer}</footer>}
      </section>
    </div>
  );
}

export function DialogCloseButton({ label = "关闭", disabled = false, onClick, className = "dialog-close-button" }) {
  return (
    <button type="button" className={className} aria-label={label} title={label} disabled={disabled} onClick={onClick}>
      <X size={18} weight="regular" aria-hidden="true" />
    </button>
  );
}
