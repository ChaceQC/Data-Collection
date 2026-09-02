import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowSquareOut,
  CaretLeft,
  CaretRight,
  Copy,
  FolderOpen,
  Star,
} from "@phosphor-icons/react";
import { Dialog, DialogCloseButton } from "../../components/Dialog.jsx";
import {
  canPreview,
  canUsePreviewRuntime,
  cancelPreviewTask,
  createPreviewTaskId,
  disposePreview,
  loadPreview,
} from "./previewApi";
import { getPreviewDefinition } from "./previewRegistry";
import {
  getAdjacentPreviewEntries,
  getPreviewStatusLabel,
} from "./previewTypes";
import { isTextEntryTarget } from "../../lib/keyboardModel.js";
import { TextPreviewer } from "./TextPreviewer";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";
import { ImagePreviewer } from "./ImagePreviewer";
import { VideoPreviewer } from "./VideoPreviewer";
import { SpreadsheetPreviewer } from "./SpreadsheetPreviewer";
import { OfficePreviewer } from "./OfficePreviewer";
import { PdfPreviewer } from "./PdfPreviewer";

function initialState(entry) {
  return { status: "loading", kind: entry?.kind || "other", content: null, reason: "", demoOnly: false };
}

function PreviewContent({ result, entryName, failureActions }) {
  if (!result?.content) return null;
  if (result.content.type === "text") {
    return result.kind === "markdown" ? <MarkdownPreviewer content={result.content} /> : <TextPreviewer content={result.content} />;
  }
  if (result.content.type === "convertedPdf") return <PdfPreviewer content={result.content} {...failureActions} />;
  if (result.kind === "image") return <ImagePreviewer content={result.content} title={entryName} {...failureActions} />;
  if (result.kind === "video") return <VideoPreviewer content={result.content} title={entryName} {...failureActions} />;
  if (result.kind === "xlsx") return <SpreadsheetPreviewer content={result.content} {...failureActions} />;
  if (result.kind === "docx") return <OfficePreviewer content={result.content} {...failureActions} />;
  if (result.kind === "pdf") return <PdfPreviewer content={result.content} {...failureActions} />;
  return <UnsupportedPreviewer status="unsupported" reason="此格式暂不支持预览。" {...failureActions} />;
}

export function PreviewPane({
  entry,
  navigationEntries = [],
  directoryView,
  onClose,
  onRetry,
  onReposition,
  onOpenDefault,
  onReveal,
  onCopyLocation,
  onFavorite,
  onNavigate,
  retryNonce,
}) {
  const [result, setResult] = useState(() => initialState(entry));
  const [localRetryNonce, setLocalRetryNonce] = useState(0);
  const requestSequence = useRef(0);
  const activePreviewId = useRef("");
  const activeTaskId = useRef("");
  const definition = getPreviewDefinition(entry);
  const effectiveRetryNonce = retryNonce ?? localRetryNonce;
  const isDirectoryEntry = Boolean(entry?.directoryId && Array.isArray(entry.relativePath));
  const previewEntries = useMemo(
    () => (Array.isArray(navigationEntries) ? navigationEntries : []).filter((item) => item?.id && item.kind !== "folder" && !item.invalid),
    [navigationEntries],
  );
  const adjacent = useMemo(
    () => getAdjacentPreviewEntries(previewEntries, entry?.id),
    [entry?.id, previewEntries],
  );

  const requestRetry = useCallback(() => {
    onRetry?.(entry);
    if (retryNonce == null) setLocalRetryNonce((current) => current + 1);
  }, [entry, onRetry, retryNonce]);

  const reportContentFailure = useCallback((status, reason) => {
    setResult((current) => current.status === "ready"
      ? { ...current, status, content: null, reason }
      : current);
    const previewId = activePreviewId.current;
    activePreviewId.current = "";
    if (previewId) void disposePreview(previewId);
  }, []);

  useEffect(() => {
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    let cancelled = false;
    setResult(initialState(entry));
    const browserDemo = !canUsePreviewRuntime();

    if (browserDemo) {
      setResult({
        status: "unsupported",
        kind: entry?.kind || "other",
        content: null,
        reason: "浏览器预览模式不会读取本地文件，请在桌面应用中打开资料。",
        demoOnly: true,
      });
      return () => {
        cancelled = true;
        requestSequence.current += 1;
      };
    }

    if (!definition || entry.invalid || !entry.id) {
      setResult({
        status: entry.invalid ? "missing" : "unsupported",
        kind: entry.kind || "other",
        content: null,
        reason: entry.invalid
          ? "文件已失效，请重新定位或重新导入。"
          : !definition
            ? "此格式暂不支持预览。"
            : "资料标识不可用，请重新选择资料。",
        demoOnly: false,
      });
      return () => {
        cancelled = true;
        requestSequence.current += 1;
      };
    }

    async function requestPreview() {
      try {
        const support = await canPreview(entry);
        if (cancelled || requestSequence.current !== requestId) return;
        if (!support.supported) {
          setResult({ ...support, content: null, previewId: "", byteLength: 0, demoOnly: Boolean(support.demoOnly) });
          return;
        }
        const taskId = createPreviewTaskId();
        activeTaskId.current = taskId;
        let loaded;
        try {
          loaded = await loadPreview(entry, { taskId });
        } finally {
          if (activeTaskId.current === taskId) activeTaskId.current = "";
        }
        if (cancelled || requestSequence.current !== requestId) {
          if (loaded.previewId) void disposePreview(loaded.previewId);
          return;
        }
        if (loaded.status !== "ready") {
          if (loaded.previewId) void disposePreview(loaded.previewId);
          setResult({ ...loaded, demoOnly: Boolean(loaded.demoOnly) });
          return;
        }
        activePreviewId.current = loaded.previewId || "";
        setResult({ ...loaded, demoOnly: Boolean(loaded.demoOnly) });
      } catch {
        if (cancelled || requestSequence.current !== requestId) return;
        setResult({
          status: "parse-error",
          kind: entry.kind || "other",
          content: null,
          reason: "预览检查或加载失败，请重试。",
          demoOnly: false,
        });
      }
    }

    void requestPreview();
    return () => {
      cancelled = true;
      requestSequence.current += 1;
      const previewId = activePreviewId.current;
      activePreviewId.current = "";
      const taskId = activeTaskId.current;
      activeTaskId.current = "";
      if (taskId) void cancelPreviewTask(taskId);
      if (previewId) void disposePreview(previewId);
    };
  }, [definition, effectiveRetryNonce, entry?.id, entry?.invalid, entry?.kind, entry?.name, entry?.path]);

  const isReady = result.status === "ready" && result.content;
  const canUseFileActions = Boolean(!isDirectoryEntry && !entry.invalid && entry.kind !== "folder");
  const failureActions = {
    demoOnly: Boolean(result.demoOnly),
    isDirectoryEntry,
    onRetry: requestRetry,
    onReposition: !isDirectoryEntry ? () => onReposition?.(entry) : undefined,
    onOpenDefault: canUseFileActions ? () => onOpenDefault?.(entry) : undefined,
    onReveal: !entry.invalid ? () => onReveal?.(entry, directoryView) : undefined,
    onClose,
    onFailure: reportContentFailure,
  };

  const handlePreviewKeyDown = useCallback((event) => {
    if (event.defaultPrevented || event.isComposing || isTextEntryTarget(event.target)) return;
    if (event.key === "ArrowLeft" && adjacent.previous && onNavigate) {
      event.preventDefault();
      onNavigate(adjacent.previous);
    } else if (event.key === "ArrowRight" && adjacent.next && onNavigate) {
      event.preventDefault();
      onNavigate(adjacent.next);
    }
  }, [adjacent.next, adjacent.previous, onNavigate]);

  return (
    <Dialog
      title={entry.name}
      description={<span className="sr-only">只读预览内容，关闭后返回资料列表。</span>}
      className="preview-dialog"
      backdropClassName="preview-modal-backdrop"
      bodyClassName={`preview-dialog-body ${isReady ? "is-ready" : ""}`}
      bodyProps={{ "aria-busy": result.status === "loading" }}
      onClose={onClose}
      dialogProps={{ "data-testid": "preview-dialog", onKeyDown: handlePreviewKeyDown }}
      header={({ titleId }) => (
        <header className="preview-dialog-header">
          <div className="preview-dialog-heading">
            <h2 id={titleId} title={entry.name}>{entry.name}</h2>
            <span>{definition?.displayType || entry.type || "未知格式"}</span>
          </div>
          <div className="preview-dialog-navigation" role="group" aria-label="连续浏览">
            <button type="button" className="preview-header-action" aria-label="上一项预览" title="上一项预览" disabled={!adjacent.previous || !onNavigate} onClick={() => onNavigate?.(adjacent.previous)}>
              <CaretLeft size={17} weight="bold" aria-hidden="true" />
            </button>
            <button type="button" className="preview-header-action" aria-label="下一项预览" title="下一项预览" disabled={!adjacent.next || !onNavigate} onClick={() => onNavigate?.(adjacent.next)}>
              <CaretRight size={17} weight="bold" aria-hidden="true" />
            </button>
          </div>
          {isReady && (canUseFileActions || (isDirectoryEntry && onReveal)) && (
            <div className="preview-dialog-actions" role="group" aria-label="预览操作">
              {onFavorite && <button type="button" className={`preview-header-action ${entry.favorite ? "is-favorite" : ""}`} aria-label={entry.favorite ? "取消收藏" : "收藏"} aria-pressed={Boolean(entry.favorite)} title={entry.favorite ? "取消收藏" : "收藏"} onClick={() => onFavorite(entry)}><Star size={17} weight={entry.favorite ? "fill" : "regular"} aria-hidden="true" /></button>}
              {canUseFileActions && onCopyLocation && <button type="button" className="preview-header-action" aria-label="复制资料位置" title="复制资料位置" onClick={() => onCopyLocation(entry, directoryView)}><Copy size={17} weight="regular" aria-hidden="true" /></button>}
              {onReveal && <button type="button" className="preview-header-action" aria-label="在资源管理器中定位" title="在资源管理器中定位" onClick={() => onReveal(entry, directoryView)}><FolderOpen size={17} weight="regular" aria-hidden="true" /></button>}
              {canUseFileActions && onOpenDefault && <button type="button" className="preview-header-action" aria-label="用默认程序打开" title="用默认程序打开" onClick={() => onOpenDefault(entry)}><ArrowSquareOut size={17} weight="regular" aria-hidden="true" /></button>}
            </div>
          )}
          <div className="preview-dialog-status">{getPreviewStatusLabel(result.status, { demoOnly: result.demoOnly })}</div>
          <DialogCloseButton label="关闭预览" className="preview-close-button" onClick={onClose} />
        </header>
      )}
    >
      {result.status === "ready" && result.content
        ? <PreviewContent result={result} entryName={entry.name} failureActions={failureActions} />
        : result.status === "loading"
          ? <div className="preview-loading-state">正在准备预览...</div>
          : <UnsupportedPreviewer status={result.status} reason={result.reason} {...failureActions} />}
    </Dialog>
  );
}
