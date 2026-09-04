import { useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight, MagnifyingGlassMinus, MagnifyingGlassPlus } from "@phosphor-icons/react";
import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { normalizePreviewResourceUrl } from "./previewTypes";
import {
  getPdfCanvasMetrics,
  PDF_CANVAS_PIXEL_LIMIT,
} from "./pdfRenderModel";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

const MAX_PDF_PAGES = 200;
const PDF_PREVIEW_TIMEOUT_MS = 30_000;

export function PdfPreviewer({ content, onFailure, onReady, ...failureActions }) {
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
      cMapUrl: new URL("pdfjs/cmaps/", globalThis.document.baseURI).href,
      cMapPacked: true,
      standardFontDataUrl: new URL("pdfjs/standard_fonts/", globalThis.document.baseURI).href,
      maxImageSize: PDF_CANVAS_PIXEL_LIMIT,
    });
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      if (cancelled) return;
      timedOut = true;
      void loadingTask.destroy().catch(() => undefined);
      const reason = "PDF 读取超过 30 秒，已终止预览任务，请重试。";
      setDocumentState({ status: "timed-out", document: null, reason });
      onFailure?.("timed-out", reason);
    }, PDF_PREVIEW_TIMEOUT_MS);
    loadingTask.promise
      .then((document) => {
        loadedDocument = document;
        if (cancelled || timedOut || loadSequence.current !== sequence) {
          void document.destroy().catch(() => undefined);
          return;
        }
        window.clearTimeout(timeoutId);
        if (!Number.isInteger(document.numPages) || document.numPages < 1 || document.numPages > MAX_PDF_PAGES) {
          void document.destroy().catch(() => undefined);
          const reason = "PDF 页数超过 200 页预览限制。";
          setDocumentState({ status: "too-large", document: null, reason });
          onFailure?.("too-large", reason);
          return;
        }
        setDocumentState({ status: "ready", document, reason: "" });
      })
      .catch((error) => {
        window.clearTimeout(timeoutId);
        if (!cancelled && !timedOut && loadSequence.current === sequence) {
          const reason = error?.name === "PasswordException"
            ? "加密 PDF 暂不支持预览。"
            : "PDF 无法解析，请检查文件是否损坏。";
          setDocumentState({ status: "parse-error", document: null, reason });
          onFailure?.("parse-error", reason);
        }
      });
    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
      void loadingTask.destroy().catch(() => undefined);
      if (loadedDocument) void loadedDocument.destroy().catch(() => undefined);
    };
  }, [content.resourceUrl]);

  useEffect(() => {
    const document = documentState.document;
    if (!document) return undefined;
    let cancelled = false;
    let renderTask;
    let renderedCanvas;
    let renderTimedOut = false;
    let renderTimeoutId;
    const sequence = renderSequence.current + 1;
    renderSequence.current = sequence;
    async function renderPage() {
      try {
        const pdfPage = await document.getPage(page);
        if (cancelled || renderSequence.current !== sequence) return;
        const viewport = pdfPage.getViewport({ scale });
        const metrics = getPdfCanvasMetrics(viewport, globalThis.devicePixelRatio);
        if (!metrics) {
          throw new Error("page-too-large");
        }
        // 先在不可见画布中完成整页绘制，避免异步绘制过程暴露半成品。
        renderedCanvas = globalThis.document.createElement("canvas");
        renderedCanvas.width = metrics.pixelWidth;
        renderedCanvas.height = metrics.pixelHeight;
        const renderContext = renderedCanvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!renderContext) throw new Error("canvas-context");
        renderTask = pdfPage.render({
          canvasContext: renderContext,
          viewport,
          transform: [metrics.outputScale, 0, 0, metrics.outputScale, 0, 0],
        });
        renderTimeoutId = window.setTimeout(() => {
          if (cancelled) return;
          renderTimedOut = true;
          renderTask?.cancel();
          const reason = "PDF 页面绘制超过 30 秒，已终止预览任务，请重试。";
          setDocumentState((current) => ({ ...current, status: "timed-out", reason }));
          onFailure?.("timed-out", reason);
        }, 30_000);
        await renderTask.promise;
        window.clearTimeout(renderTimeoutId);
        if (cancelled || renderSequence.current !== sequence) return;
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = metrics.pixelWidth;
        canvas.height = metrics.pixelHeight;
        canvas.style.width = `${metrics.cssWidth}px`;
        canvas.style.height = `${metrics.cssHeight}px`;
        const visibleContext = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
        if (!visibleContext) throw new Error("canvas-context");
        visibleContext.drawImage(renderedCanvas, 0, 0);
        onReady?.();
      } catch (error) {
        window.clearTimeout(renderTimeoutId);
        if (!cancelled && !renderTimedOut && renderSequence.current === sequence && error?.name !== "RenderingCancelledException") {
          setDocumentState((current) => ({
            ...current,
            status: error?.message === "page-too-large" ? "too-large" : "parse-error",
            reason: error?.message === "page-too-large"
              ? "当前 PDF 页面尺寸超过预览像素限制，请缩小或使用系统程序打开。"
              : "PDF 页面渲染失败，请重试。",
          }));
          onFailure?.(
            error?.message === "page-too-large" ? "too-large" : "parse-error",
            error?.message === "page-too-large"
              ? "当前 PDF 页面尺寸超过预览像素限制，请缩小或使用系统程序打开。"
              : "PDF 页面渲染失败，请重试。",
          );
        }
      }
    }
    void renderPage();
    return () => {
      cancelled = true;
      renderSequence.current += 1;
      window.clearTimeout(renderTimeoutId);
      renderTask?.cancel();
      if (renderedCanvas) {
        renderedCanvas.width = 0;
        renderedCanvas.height = 0;
      }
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [documentState.document, page, scale]);

  if (documentState.status === "loading") return <div className="preview-loading-state">正在加载 PDF...</div>;
  if (documentState.status !== "ready" || !documentState.document) return <UnsupportedPreviewer status={documentState.status} reason={documentState.reason} {...failureActions} />;

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
