import { useEffect, useRef, useState } from "react";
import { Dialog, DialogCloseButton } from "../../components/Dialog.jsx";
import {
  cancelPreviewTask,
  canPreview,
  createPreviewTaskId,
  disposePreview,
  loadPreview,
} from "./previewApi";
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

function PreviewContent({ result, entryName }) {
  if (!result?.content) return null;
  if (result.content.type === "text") {
    return result.kind === "markdown" ? <MarkdownPreviewer content={result.content} /> : <TextPreviewer content={result.content} />;
  }
  if (result.content.type === "convertedPdf") return <PdfPreviewer content={result.content} />;
  if (result.kind === "image") return <ImagePreviewer content={result.content} title={entryName} />;
  if (result.kind === "video") return <VideoPreviewer content={result.content} title={entryName} />;
  if (result.kind === "xlsx") return <SpreadsheetPreviewer content={result.content} />;
  if (result.kind === "docx") return <OfficePreviewer content={result.content} />;
  if (result.kind === "pdf") return <PdfPreviewer content={result.content} />;
  return <UnsupportedPreviewer status="unsupported" reason="此格式暂不支持预览。" />;
}

export function PreviewPane({ entry, onClose }) {
  const [result, setResult] = useState(() => initialState(entry));
  const requestSequence = useRef(0);
  const activePreviewId = useRef("");
  const activeTaskId = useRef("");
  const definition = getPreviewDefinition(entry);

  useEffect(() => {
    const previousPreviewId = activePreviewId.current;
    const previousTaskId = activeTaskId.current;
    activePreviewId.current = "";
    activeTaskId.current = "";
    if (previousTaskId) void cancelPreviewTask(previousTaskId);
    if (previousPreviewId) void disposePreview(previousPreviewId);
    const requestId = requestSequence.current + 1;
    requestSequence.current = requestId;
    let cancelled = false;
    setResult(initialState(entry));

    if (!definition || entry.invalid || !entry.id) {
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
        const taskId = createPreviewTaskId();
        activeTaskId.current = taskId;
        const loaded = await loadPreview(entry, { taskId });
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
      const taskId = activeTaskId.current;
      activeTaskId.current = "";
      if (taskId) void cancelPreviewTask(taskId);
      if (previewId) void disposePreview(previewId);
    };
  }, [definition, entry?.id, entry?.invalid, entry?.kind, entry?.name, entry?.path]);

  const isReady = result.status === "ready" && result.content;
  return (
    <Dialog
      title={entry.name}
      description={<span className="sr-only">只读预览内容，关闭后返回资料列表。</span>}
      className="preview-dialog"
      backdropClassName="preview-modal-backdrop"
      bodyClassName={`preview-dialog-body ${isReady ? "is-ready" : ""}`}
      bodyProps={{ "aria-busy": result.status === "loading" }}
      onClose={onClose}
      dialogProps={{ "data-testid": "preview-dialog" }}
      header={({ titleId }) => (
        <header className="preview-dialog-header">
          <div className="preview-dialog-heading">
            <h2 id={titleId} title={entry.name}>{entry.name}</h2>
            <span>{definition?.displayType || entry.type || "未知格式"}</span>
          </div>
          <div className="preview-dialog-status">{getPreviewStatusLabel(result.status)}</div>
          <DialogCloseButton label="关闭预览" className="preview-close-button" onClick={onClose} />
        </header>
      )}
    >
      {result.status === "ready" && result.content ? <PreviewContent result={result} entryName={entry.name} /> : result.status === "loading" ? <div className="preview-loading-state">正在准备预览...</div> : <UnsupportedPreviewer status={result.status} reason={result.reason} />}
    </Dialog>
  );
}
