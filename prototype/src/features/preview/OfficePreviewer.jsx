import { useEffect, useState } from "react";
import mammoth from "mammoth/mammoth.browser.js";
import { normalizePreviewResourceUrl } from "./previewTypes";
import { sanitizeDocxHtml } from "./previewSecurity";

export function OfficePreviewer({ content }) {
  const [state, setState] = useState({ status: "loading", html: "", warningCount: 0, reason: "" });

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    setState({ status: "loading", html: "", warningCount: 0, reason: "" });
    async function convert() {
      try {
        const response = await fetch(normalizePreviewResourceUrl(content.resourceUrl), { signal: controller.signal });
        if (!response.ok) throw new Error("resource unavailable");
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammoth.convertToHtml({ arrayBuffer });
        if (cancelled) return;
        setState({
          status: "ready",
          html: sanitizeDocxHtml(result.value),
          warningCount: result.messages.length,
          reason: "",
        });
      } catch (error) {
        if (cancelled || error?.name === "AbortError") return;
        setState({
          status: "parse-error",
          html: "",
          warningCount: 0,
          reason: "Word 文档无法解析，请检查文件是否损坏或加密。",
        });
      }
    }
    void convert();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [content.resourceUrl]);

  if (state.status === "loading") {
    return <div className="preview-loading-state">正在解析 Word 文档...</div>;
  }
  if (state.status !== "ready") {
    return <div className="preview-error-state">{state.reason}</div>;
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
