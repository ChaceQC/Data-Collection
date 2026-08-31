import { useEffect, useState } from "react";
import { normalizePreviewResourceUrl } from "./previewTypes";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "未知时长";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function VideoPreviewer({ content }) {
  const [status, setStatus] = useState("loading");
  const [metadata, setMetadata] = useState(null);

  useEffect(() => {
    setStatus("loading");
    setMetadata(null);
  }, [content.resourceUrl]);

  return (
    <div className="preview-video-content">
      <video
        key={content.resourceUrl}
        className="preview-video"
        controls
        playsInline
        preload="metadata"
        src={normalizePreviewResourceUrl(content.resourceUrl)}
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          setMetadata({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
          setStatus("ready");
        }}
        onCanPlay={() => setStatus("ready")}
        onError={() => setStatus("parse-error")}
      />
      {status === "loading" && <div className="preview-loading-state">正在读取视频元数据...</div>}
      {status === "parse-error" && <div className="preview-error-state">当前 WebView2 无法播放此视频容器或编码。</div>}
      {metadata && (
        <div className="preview-content-meta">
          <span>时长：{formatDuration(metadata.duration)}</span>
          {metadata.width > 0 && <span>分辨率：{metadata.width} × {metadata.height}</span>}
        </div>
      )}
    </div>
  );
}
