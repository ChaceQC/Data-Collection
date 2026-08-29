export function TextPreviewer({ content }) {
  return (
    <div className="preview-text-content">
      <div className="preview-content-meta">
        <span>编码：{content.encoding}</span>
        {content.language && <span>语言：{content.language}</span>}
      </div>
      <pre className="preview-source"><code>{content.value}</code></pre>
    </div>
  );
}
