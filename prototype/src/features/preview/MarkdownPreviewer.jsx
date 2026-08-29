import { useMemo, useState } from "react";
import { renderMarkdown } from "./previewSecurity";
import { TextPreviewer } from "./TextPreviewer";

export function MarkdownPreviewer({ content }) {
  const [mode, setMode] = useState("rendered");
  const renderedHtml = useMemo(() => renderMarkdown(content.value), [content.value]);

  return (
    <div className="preview-markdown-content">
      <div className="preview-mode-switch" role="tablist" aria-label="Markdown 查看模式">
        <button
          type="button"
          role="tab"
          aria-selected={mode === "rendered"}
          className={mode === "rendered" ? "is-active" : ""}
          onClick={() => setMode("rendered")}
        >
          渲染
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === "source"}
          className={mode === "source" ? "is-active" : ""}
          onClick={() => setMode("source")}
        >
          原文
        </button>
      </div>
      {mode === "rendered" ? (
        <article className="preview-markdown-body" dangerouslySetInnerHTML={{ __html: renderedHtml }} />
      ) : (
        <TextPreviewer content={content} />
      )}
    </div>
  );
}
