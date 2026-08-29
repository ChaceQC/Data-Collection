import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { canPreview, disposePreview, loadPreview } from "./previewApi";
import { getPreviewDefinition } from "./previewRegistry";
import { getPreviewStatusLabel } from "./previewTypes";
import { TextPreviewer } from "./TextPreviewer";
import { MarkdownPreviewer } from "./MarkdownPreviewer";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";
import { ImagePreviewer } from "./ImagePreviewer";
import { VideoPreviewer } from "./VideoPreviewer";
import { SpreadsheetPreviewer } from "./SpreadsheetPreviewer";
import { OfficePreviewer } from "./OfficePreviewer";
import { PdfPreviewer } from "./PdfPreviewer";

function initialState(entry) {
  return { status: "loading", kind: entry?.kind || "other", content: null, reason: "" };
}

function PreviewContent({ result }) {
  if (!result?.content) return null;
  if (result.content.type === "text") {
    return result.kind === "markdown" ? <MarkdownPreviewer content={result.content} /> : <TextPreviewer content={result.content} />;
  }
  if (result.content.type === "convertedPdf") return <PdfPreviewer content={result.content} />;
  if (result.kind === "image") return <ImagePreviewer content={result.content} />;
  if (result.kind === "video") return <VideoPreviewer content={result.content} />;
  if (result.kind === "xlsx") return <SpreadsheetPreviewer content={result.content} />;
  if (result.kind === "docx") return <OfficePreviewer content={result.content} />;
  if (result.kind === "pdf") return <PdfPreviewer content={result.content} />;
  return <UnsupportedPreviewer status="unsupported" reason="此格式暂不支持预览。" />;
}

export function PreviewPane({ entry, onClose }) {
  const [result, setResult] = useState(() => initialState(entry));
  const requestSequence = useRef(0);
  const activePreviewId = useRef("");
  const definition = getPreviewDefinition(entry);

  useEffect(() => {
    const previousPreviewId = activePreviewId.current;
    activePreviewId.current = "";
    if (previousPreviewId) void disposePreview(previousPreviewId);
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    let cancelled = false;
    setResult(initialState(entry));

    if (!definition || entry.invalid || !entry.path) {
      setResult({
        status: entry.invalid ? "missing" : "unsupported",
        kind: entry.kind || "other",
        content: null,
        reason: entry.invalid
          ? "文件已失效，请重新定位或重新导入。"
          : !definition
            ? "此格式暂不支持预览。"
            : "浏览器预览模式不会读取本地文件，请在桌面应用中打开资料。",
      });
      return () => {
        cancelled = true;
      };
    }

    async function requestPreview() {
      try {
        const support = await canPreview(entry);
        if (cancelled || requestSequence.current !== requestId) return;
        if (!support.supported) {
          setResult({ ...support, content: null, previewId: "", byteLength: 0 });
          return;
        }
        const loaded = await loadPreview(entry);
        if (cancelled || requestSequence.current !== requestId) {
          if (loaded.previewId) void disposePreview(loaded.previewId);
          return;
        }
        if (loaded.status !== "ready") {
          if (loaded.previewId) void disposePreview(loaded.previewId);
          setResult(loaded);
          return;
        }
        activePreviewId.current = loaded.previewId || "";
        setResult(loaded);
      } catch {
        if (cancelled || requestSequence.current !== requestId) return;
        setResult({
          status: "parse-error",
          kind: entry.kind || "other",
          content: null,
          reason: "预览任务失败，请重试。",
        });
      }
    }
    void requestPreview();
    return () => {
      cancelled = true;
      requestSequence.current += 1;
      const previewId = activePreviewId.current;
      activePreviewId.current = "";
      if (previewId) void disposePreview(previewId);
    };
  }, [definition, entry?.id, entry?.invalid, entry?.kind, entry?.name, entry?.path]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose]);

  const isReady = result.status === "ready" && result.content;
  return (
    <div
      className="preview-modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section className="preview-dialog" role="dialog" aria-modal="true" aria-labelledby="preview-dialog-title" data-testid="preview-dialog">
        <header className="preview-dialog-header">
          <div className="preview-dialog-heading">
            <h2 id="preview-dialog-title" title={entry.name}>{entry.name}</h2>
            <span>{definition?.displayType || entry.type || "未知格式"}</span>
          </div>
          <div className="preview-dialog-status">{getPreviewStatusLabel(result.status)}</div>
          <button type="button" className="preview-close-button" aria-label="关闭预览" title="关闭预览" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        <div className={`preview-dialog-body ${isReady ? "is-ready" : ""}`} aria-busy={result.status === "loading"}>
          {result.status === "ready" && result.content ? (
            <PreviewContent result={result} />
          ) : result.status === "loading" ? (
            <div className="preview-loading-state">正在准备预览...</div>
          ) : (
            <UnsupportedPreviewer status={result.status} reason={result.reason} />
          )}
        </div>
      </section>
    </div>
  );
}
