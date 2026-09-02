import { useEffect, useRef } from "react";
import {
  listenFloatingDrop,
  recordFloatingPaths,
} from "./floatingBallApi.js";
import { useFloatingBallFiles } from "./useFloatingBallFiles.js";
import {
  getRecordMessage,
  getRecordStatus,
  mergePendingPaths,
  normalizeFloatingPathKey,
} from "./floatingBallModel.js";

export function useFloatingBallRecords({
  isTauriRuntime,
  panelOpenRef,
  setStatus,
  showFeedback,
}) {
  const fileLibrary = useFloatingBallFiles({ isTauriRuntime, showFeedback });
  const recordingRef = useRef(false);
  const pendingPathsRef = useRef([]);
  const activePathKeysRef = useRef(new Set());
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      pendingPathsRef.current = [];
      activePathKeysRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    let unlisten;
    listenFloatingDrop(handleDropEvent)
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [isTauriRuntime]);

  function handleDropEvent(event) {
    if (disposedRef.current) return;
    const type = event.payload?.type;
    if (type === "enter" || type === "over") {
      if (recordingRef.current) return;
      showFeedback("", "drag-over", 0);
      setStatus("drag-over");
      return;
    }
    if (type === "leave") {
      if (!recordingRef.current) setStatus(panelOpenRef.current ? "near" : "idle");
      return;
    }
    if (type === "drop") void recordPaths(event.payload?.paths || []);
  }

  function recordPaths(paths) {
    const nextPaths = mergePendingPaths([], paths, activePathKeysRef.current);
    if (!nextPaths.length) {
      if (!recordingRef.current) showFeedback("没有找到可记录的路径", "error");
      return;
    }
    if (recordingRef.current) {
      pendingPathsRef.current = mergePendingPaths(pendingPathsRef.current, nextPaths, activePathKeysRef.current);
      return;
    }
    void processRecordPaths(nextPaths);
  }

  async function processRecordPaths(paths) {
    recordingRef.current = true;
    activePathKeysRef.current = new Set(paths.map(normalizeFloatingPathKey).filter(Boolean));
    showFeedback("正在记录资料...", "recording", 0);
    try {
      const result = await recordFloatingPaths(paths);
      if (disposedRef.current) return;
      const refreshed = await fileLibrary.refreshFiles({ background: true });
      await fileLibrary.refreshLibraryCount();
      if (!disposedRef.current && refreshed) showFeedback(getRecordMessage(result), getRecordStatus(result));
    } catch (error) {
      if (!disposedRef.current) showFeedback(getErrorMessage(error, "悬浮球记录失败，请重试"), "error");
    } finally {
      recordingRef.current = false;
      activePathKeysRef.current.clear();
      const pendingPaths = pendingPathsRef.current;
      pendingPathsRef.current = [];
      if (!disposedRef.current && pendingPaths.length) void processRecordPaths(pendingPaths);
    }
  }

  function handleBrowserDrop(event) {
    if (isTauriRuntime || disposedRef.current) return;
    event.preventDefault();
    const droppedFiles = [...(event.dataTransfer?.files || [])].slice(0, 8);
    if (!droppedFiles.length) return;
    const count = fileLibrary.addDemoFiles(droppedFiles);
    void fileLibrary.refreshFiles({ background: true }).then((refreshed) => {
      if (refreshed) showFeedback(`演示记录 ${count} 项`, "recorded");
    });
  }

  return {
    ...fileLibrary,
    handleBrowserDrop,
    handleDropEvent,
  };
}

function getErrorMessage(error, fallback) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.length <= 180 ? message : fallback;
}
