import { useEffect, useState } from "react";
import {
  ArrowClockwise,
  FrameCorners,
  MagnifyingGlassMinus,
  MagnifyingGlassPlus,
} from "@phosphor-icons/react";
import { normalizePreviewResourceUrl } from "./previewTypes";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";

export function ImagePreviewer({ content, title = "图片", onFailure, onReady, ...failureActions }) {
  const [mode, setMode] = useState("fit");
  const [scale, setScale] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [status, setStatus] = useState("loading");

  useEffect(() => {
    setMode("fit");
    setScale(1);
    setRotation(0);
    setStatus("loading");
  }, [content.resourceUrl]);

  return (
    <div className="preview-image-content">
      <div className="preview-media-toolbar">
        <button type="button" className={mode === "fit" ? "is-active" : ""} onClick={() => setMode("fit")}>
          <FrameCorners size={17} />
          <span>适应窗口</span>
        </button>
        <button type="button" className={mode === "actual" ? "is-active" : ""} onClick={() => { setMode("actual"); setScale(1); }}>
          实际尺寸
        </button>
        <button type="button" title="缩小" aria-label="缩小" onClick={() => { setMode("scale"); setScale((value) => Math.max(0.25, value - 0.25)); }}>
          <MagnifyingGlassMinus size={18} />
        </button>
        <button type="button" title="放大" aria-label="放大" onClick={() => { setMode("scale"); setScale((value) => Math.min(4, value + 0.25)); }}>
          <MagnifyingGlassPlus size={18} />
        </button>
        <button type="button" title="顺时针旋转" aria-label="顺时针旋转" onClick={() => setRotation((value) => (value + 90) % 360)}>
          <ArrowClockwise size={18} />
        </button>
        {content.width && content.height && <span>{content.width} × {content.height}</span>}
      </div>
      <div className="preview-image-viewport">
        {status === "loading" && <div className="preview-loading-state">正在加载图片...</div>}
        {status === "parse-error" && <UnsupportedPreviewer status="parse-error" reason="图片无法显示，请检查文件是否损坏。" {...failureActions} />}
        <img
          key={content.resourceUrl}
          className={`preview-image ${mode === "fit" ? "is-fit" : "is-free"} ${status === "ready" ? "" : "is-hidden"}`}
          src={normalizePreviewResourceUrl(content.resourceUrl)}
          alt={`${title} 图片预览`}
          onLoad={() => {
            setStatus("ready");
            onReady?.();
          }}
          onError={() => {
            const reason = "图片无法显示，请检查文件是否损坏。";
            setStatus("parse-error");
            onFailure?.("parse-error", reason);
          }}
          style={{
            transform: `rotate(${rotation}deg) scale(${mode === "fit" ? 1 : scale})`,
          }}
        />
      </div>
    </div>
  );
}
