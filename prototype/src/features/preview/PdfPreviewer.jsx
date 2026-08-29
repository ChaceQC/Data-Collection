import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { normalizePreviewResourceUrl } from "./previewTypes";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export function PdfPreviewer({ content }) {
  const canvasRef = useRef(null);
  const [documentState, setDocumentState] = useState({ status: "loading", document: null, reason: "" });
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument = null;
    setDocumentState({ status: "loading", document: null, reason: "" });
    setPage(1);
    const loadingTask = pdfjsLib.getDocument({
      url: normalizePreviewResourceUrl(content.resourceUrl),
      isEvalSupported: false,
      disableAutoFetch: false,
    });
    loadingTask.promise
      .then((document) => {
        loadedDocument = document;
        if (cancelled) {
          void document.destroy();
          return;
        }
        setDocumentState({ status: "ready", document, reason: "" });
      })
      .catch((error) => {
        if (!cancelled) {
          const reason = error?.name === "PasswordException"
            ? "加密 PDF 暂不支持预览。"
            : "PDF 无法解析，请检查文件是否损坏。";
          setDocumentState({ status: "parse-error", document: null, reason });
        }
      });
    return () => {
      cancelled = true;
      void loadingTask.destroy();
      if (loadedDocument) void loadedDocument.destroy();
    };
  }, [content.resourceUrl]);

  useEffect(() => {
    const document = documentState.document;
    if (!document) return undefined;
    let cancelled = false;
    let renderTask;
    async function renderPage() {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        renderTask = pdfPage.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && error?.name !== "RenderingCancelledException") {
          setDocumentState((current) => ({ ...current, status: "parse-error", reason: "PDF 页面渲染失败，请重试。" }));
        }
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderTask?.cancel();
    };
  }, [documentState.document, page, scale]);

  if (documentState.status === "loading") return <div className="preview-loading-state">正在加载 PDF...</div>;
  if (documentState.status !== "ready" || !documentState.document) return <div className="preview-error-state">{documentState.reason}</div>;

  const pageCount = documentState.document.numPages;
  return (
    <div className="preview-pdf-content">
      <div className="preview-media-toolbar">
        <button type="button" title="上一页" aria-label="上一页" disabled={page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
          <CaretLeft size={18} />
        </button>
        <label className="preview-page-control">
          <span>第</span>
          <input type="number" min="1" max={pageCount} value={page} onChange={(event) => setPage(Math.min(pageCount, Math.max(1, Number(event.target.value) || 1)))} />
          <span>/ {pageCount} 页</span>
        </label>
        <button type="button" title="下一页" aria-label="下一页" disabled={page >= pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>
          <CaretRight size={18} />
        </button>
        <button type="button" title="缩小" aria-label="缩小" disabled={scale <= 0.5} onClick={() => setScale((value) => Math.max(0.5, value - 0.25))}>
          <MagnifyingGlassMinus size={18} />
        </button>
        <span>{Math.round(scale * 100)}%</span>
        <button type="button" title="放大" aria-label="放大" disabled={scale >= 2.5} onClick={() => setScale((value) => Math.min(2.5, value + 0.25))}>
          <MagnifyingGlassPlus size={18} />
        </button>
      </div>
      <div className="preview-pdf-viewport">
        <canvas ref={canvasRef} aria-label={`PDF 第 ${page} 页`} />
      </div>
    </div>
  );
}
