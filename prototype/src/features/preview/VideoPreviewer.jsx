import { useEffect, useRef, useState } from "react";
import { normalizePreviewResourceUrl } from "./previewTypes";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "未知时长";
  const totalSeconds = Math.round(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  return `${String(minutes).padStart(2, "0")}:${String(totalSeconds % 60).padStart(2, "0")}`;
}

export function VideoPreviewer({ content, title = "视频", onFailure, onReady, ...failureActions }) {
  const [status, setStatus] = useState("loading");
  const [metadata, setMetadata] = useState(null);
  const timedOutRef = useRef(false);
  const timeoutRef = useRef(null);

  useEffect(() => {
    timedOutRef.current = false;
    setStatus("loading");
    setMetadata(null);
    timeoutRef.current = window.setTimeout(() => {
      timedOutRef.current = true;
      const reason = "视频元数据读取超过 30 秒，已终止预览任务，请重试。";
      setStatus("timed-out");
      onFailure?.("timed-out", reason);
    }, 30_000);
    return () => {
      timedOutRef.current = true;
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    };
  }, [content.resourceUrl, onFailure]);

  return (
    <div className="preview-video-content">
      <video
        key={content.resourceUrl}
        className="preview-video"
        controls
        playsInline
        preload="metadata"
        aria-label={`${title} 视频预览`}
        src={normalizePreviewResourceUrl(content.resourceUrl)}
        onLoadedMetadata={(event) => {
          if (timedOutRef.current) return;
          window.clearTimeout(timeoutRef.current);
          const video = event.currentTarget;
          setMetadata({ duration: video.duration, width: video.videoWidth, height: video.videoHeight });
          setStatus("ready");
          onReady?.();
        }}
        onCanPlay={() => {
          if (timedOutRef.current) return;
          window.clearTimeout(timeoutRef.current);
          setStatus("ready");
          onReady?.();
        }}
        onError={() => {
          if (timedOutRef.current) return;
          window.clearTimeout(timeoutRef.current);
          const reason = "当前 WebView2 无法播放此视频容器或编码。";
          setStatus("parse-error");
          onFailure?.("parse-error", reason);
        }}
      />
      {status === "loading" && <div className="preview-loading-state">正在读取视频元数据...</div>}
      {status === "parse-error" && <UnsupportedPreviewer status="parse-error" reason="当前 WebView2 无法播放此视频容器或编码。" {...failureActions} />}
      {status === "timed-out" && <UnsupportedPreviewer status="timed-out" reason="视频元数据读取超过 30 秒，已终止预览任务，请重试。" {...failureActions} />}
      {metadata && (
        <div className="preview-content-meta">
          <span>时长：{formatDuration(metadata.duration)}</span>
          {metadata.width > 0 && <span>分辨率：{metadata.width} × {metadata.height}</span>}
        </div>
      )}
    </div>
  );
}
