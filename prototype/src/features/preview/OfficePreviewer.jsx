import { useEffect, useRef, useState } from "react";
import {
  DOCX_CONVERSION_TIMEOUT_MS,
  getDocxOutputLimitReason,
  isPreviewAbortError,
} from "./docxRenderModel.js";
import { normalizePreviewResourceUrl } from "./previewTypes";
import { sanitizeDocxHtmlWithCancellation } from "./previewSecurity";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";

export function OfficePreviewer({ content, onFailure, onReady, ...failureActions }) {
  const [state, setState] = useState({
    status: "loading",
    html: "",
    warningCount: 0,
    reason: "",
    phase: "正在准备 Word 文档...",
    elapsedMs: 0,
  });
  const cancelRef = useRef(() => undefined);

  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    let worker;
    let timeoutId;
    const startedAt = performance.now();

    const elapsedMs = () => Math.max(0, Math.round(performance.now() - startedAt));
    const stopWorker = () => {
      worker?.terminate();
      worker = null;
    };
    const setFailure = (status, reason) => {
      if (stopped) return;
      stopped = true;
      window.clearTimeout(timeoutId);
      window.clearInterval(progressTimer);
      controller.abort();
      stopWorker();
      setState({ status, html: "", warningCount: 0, reason, phase: "", elapsedMs: elapsedMs() });
      onFailure?.(status, reason);
    };

    setState({
      status: "loading",
      html: "",
      warningCount: 0,
      reason: "",
      phase: "正在读取 Word 文档...",
      elapsedMs: 0,
    });
    const progressTimer = window.setInterval(() => {
      if (!stopped) setState((current) => ({ ...current, elapsedMs: elapsedMs() }));
    }, 500);
    timeoutId = window.setTimeout(() => {
      setFailure("timed-out", "Word 文档解析超过 30 秒，已终止后台任务，请重试。");
    }, DOCX_CONVERSION_TIMEOUT_MS);

    async function finishConversion(data) {
      if (stopped || data.requestId !== 1) return;
      if (typeof data.html !== "string") {
        setFailure("parse-error", "Word 解析任务返回了无效内容，请重试。");
        return;
      }
      stopWorker();
      setState((current) => ({ ...current, phase: "正在清理预览内容...", elapsedMs: elapsedMs() }));
      try {
        const html = await sanitizeDocxHtmlWithCancellation(data.html, { signal: controller.signal });
        if (stopped || controller.signal.aborted) return;
        const outputLimitReason = getDocxOutputLimitReason(html);
        if (outputLimitReason) {
          setFailure("too-large", outputLimitReason);
          return;
        }
        stopped = true;
        window.clearTimeout(timeoutId);
        window.clearInterval(progressTimer);
        setState({
          status: "ready",
          html,
          warningCount: Number.isSafeInteger(data.warningCount) ? Math.max(0, data.warningCount) : 0,
          reason: "",
          phase: "",
          elapsedMs: elapsedMs(),
        });
        onReady?.();
      } catch (error) {
        if (stopped || isPreviewAbortError(error)) return;
        if (error?.code === "output-too-large") {
          setFailure("too-large", error.message);
          return;
        }
        setFailure("parse-error", "Word 文档内容清理失败，请重试。");
      }
    }

    try {
      worker = new Worker(new URL("./docxWorker.js", import.meta.url), { type: "module" });
    } catch {
      setFailure("parse-error", "当前 WebView2 无法启动 Word 解析器，请重试。");
      return () => {
        stopped = true;
        window.clearInterval(progressTimer);
        controller.abort();
      };
    }
    worker.onmessage = (event) => {
      if (stopped) return;
      if (event.data?.type === "result") {
        void finishConversion(event.data);
        return;
      }
      if (event.data?.type === "error") {
        const status = ["source-too-large", "output-too-large"].includes(event.data.code)
          ? "too-large"
          : "parse-error";
        setFailure(status, event.data.reason || "Word 文档无法解析，请重试。");
      }
    };
    worker.onerror = () => setFailure("parse-error", "Word 解析任务未能完成，请重试。");

    async function convert() {
      try {
        setState((current) => ({ ...current, phase: "正在读取 Word 文档..." }));
        const response = await fetch(normalizePreviewResourceUrl(content.resourceUrl), { signal: controller.signal });
        if (!response.ok) {
          setFailure("parse-error", "Word 文档资源读取失败，请重试。");
          return;
        }
        const arrayBuffer = await response.arrayBuffer();
        if (stopped || controller.signal.aborted) return;
        setState((current) => ({ ...current, phase: "正在后台转换 Word 文档...", elapsedMs: elapsedMs() }));
        worker?.postMessage({ type: "convert", requestId: 1, buffer: arrayBuffer }, [arrayBuffer]);
      } catch (error) {
        if (stopped || isPreviewAbortError(error)) return;
        setFailure("parse-error", "Word 文档资源读取失败，请重试。");
      }
    }
    void convert();

    cancelRef.current = () => setFailure("cancelled", "已取消 Word 文档预览。");
    return () => {
      stopped = true;
      cancelRef.current = () => undefined;
      window.clearInterval(progressTimer);
      window.clearTimeout(timeoutId);
      controller.abort();
      stopWorker();
    };
  }, [content.resourceUrl]);

  if (state.status === "loading") {
    return (
      <div className="preview-loading-state" data-phase={state.phase}>
        <span>{state.phase || "正在解析 Word 文档..."}</span>
        {state.elapsedMs >= 2000 && <small>已用时 {Math.round(state.elapsedMs / 1000)} 秒，解析仍在后台进行。</small>}
        <button type="button" className="preview-status-action is-secondary" onClick={() => cancelRef.current()}>
          取消解析
        </button>
      </div>
    );
  }
  if (state.status !== "ready") {
    return <UnsupportedPreviewer status={state.status} reason={state.reason} {...failureActions} />;
  }

  return (
    <div className="preview-office-content">
      {state.warningCount > 0 && (
        <div className="preview-notice" role="note">
          文档中有 {state.warningCount} 项复杂内容未完全转换，字体、分页、批注、目录和高级排版可能与原文不同。
        </div>
      )}
      <article className="preview-docx-body" dangerouslySetInnerHTML={{ __html: state.html }} />
    </div>
  );
}
