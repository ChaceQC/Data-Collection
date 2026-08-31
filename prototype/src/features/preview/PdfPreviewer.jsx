import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { normalizePreviewResourceUrl } from "./previewTypes";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PDF_PAGES = 200;
const MAX_PDF_PAGE_DIMENSION = 8192;
const MAX_PDF_CANVAS_PIXELS = 16_777_216;

export function PdfPreviewer({ content }) {
  const canvasRef = useRef(null);
  const [documentState, setDocumentState] = useState({ status: "loading", document: null, reason: "" });
  const [page, setPage] = useState(1);
  const [scale, setScale] = useState(1);
  const loadSequence = useRef(0);
  const renderSequence = useRef(0);

  useEffect(() => {
    let cancelled = false;
    let loadedDocument = null;
    const sequence = loadSequence.current + 1;
    loadSequence.current = sequence;
    setDocumentState({ status: "loading", document: null, reason: "" });
    setPage(1);
    setScale(1);
    const loadingTask = pdfjsLib.getDocument({
      url: normalizePreviewResourceUrl(content.resourceUrl),
      isEvalSupported: false,
      disableAutoFetch: false,
      maxImageSize: MAX_PDF_CANVAS_PIXELS,
    });
    loadingTask.promise
      .then((document) => {
        loadedDocument = document;
        if (cancelled || loadSequence.current !== sequence) {
          void document.destroy().catch(() => undefined);
          return;
        }
        if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > MAX_PDF_PAGES) {
          void document.destroy().catch(() => undefined);
          setDocumentState({ status: "too-large", document: null, reason: "PDF 页数超过 200 页预览限制。" });
          return;
        }
        setDocumentState({ status: "ready", document, reason: "" });
      })
      .catch((error) => {
        if (!cancelled && loadSequence.current === sequence) {
          const reason = error?.name === "PasswordException"
            ? "加密 PDF 暂不支持预览。"
            : "PDF 无法解析，请检查文件是否损坏。";
          setDocumentState({ status: "parse-error", document: null, reason });
        }
      });
    return () => {
      cancelled = true;
      void loadingTask.destroy().catch(() => undefined);
      if (loadedDocument) void loadedDocument.destroy().catch(() => undefined);
    };
  }, [content.resourceUrl]);

  useEffect(() => {
    const document = documentState.document;
    if (!document) return undefined;
    let cancelled = false;
    let renderTask;
    const sequence = renderSequence.current + 1;
    renderSequence.current = sequence;
    async function renderPage() {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || renderSequence.current !== sequence) return;
        const viewport = pdfPage.getViewport({ scale });
        const width = Math.ceil(viewport.width);
        const height = Math.ceil(viewport.height);
        if (width < 1 || height < 1 || width > MAX_PDF_PAGE_DIMENSION || height > MAX_PDF_PAGE_DIMENSION
          || width * height > MAX_PDF_CANVAS_PIXELS) {
          throw new Error("page-too-large");
        }
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = width;
        canvas.height = height;
        renderTask = pdfPage.render({
          canvasContext: canvas.getContext("2d", { alpha: false }),
          viewport,
        });
        await renderTask.promise;
      } catch (error) {
        if (!cancelled && renderSequence.current === sequence && error?.name !== "RenderingCancelledException") {
          setDocumentState((current) => ({
            ...current,
            status: error?.message === "page-too-large" ? "too-large" : "parse-error",
            reason: error?.message === "page-too-large"
              ? "当前 PDF 页面尺寸超过预览像素限制，请缩小或使用系统程序打开。"
              : "PDF 页面渲染失败，请重试。",
          }));
        }
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderSequence.current += 1;
      renderTask?.cancel();
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
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
