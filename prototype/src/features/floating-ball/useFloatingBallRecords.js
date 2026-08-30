import { useEffect, useRef, useState } from "react";
import {
  getFloatingRecent,
  listenFloatingDrop,
  recordFloatingPaths,
} from "./floatingBallApi.js";
import { setFavorite } from "../library/libraryApi.js";
import {
  getRecentEntries,
  getRecordMessage,
  getRecordStatus,
  mergePendingPaths,
} from "./floatingBallModel.js";

const DEMO_RECENT = [
  {
    id: "floating-demo-note",
    name: "悬浮球演示.md",
    type: "Markdown",
    kind: "markdown",
    status: "已记录",
    invalid: false,
    recordedAt: 1,
  },
];

export function useFloatingBallRecords({
  isTauriRuntime,
  panelOpenRef,
  setFeedback,
  setStatus,
  showFeedback,
}) {
  const [recent, setRecent] = useState(isTauriRuntime ? [] : DEMO_RECENT);
  const [favoriteBusyId, setFavoriteBusyId] = useState("");
  const showFeedbackRef = useRef(showFeedback);
  const recordingRef = useRef(false);
  const favoriteBusyRef = useRef("");
  const pendingPathsRef = useRef([]);
  showFeedbackRef.current = showFeedback;

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let cancelled = false;
    getFloatingRecent()
      .then((loadedRecent) => {
        if (!cancelled) setRecent(getRecentEntries(loadedRecent));
      })
      .catch(() => {
        if (!cancelled) setFeedback("悬浮球状态读取失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [isTauriRuntime, setFeedback]);

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

  async function refreshRecent() {
    if (!isTauriRuntime) return;
    try {
      setRecent(getRecentEntries(await getFloatingRecent()));
    } catch {
      showFeedbackRef.current("最近记录暂时无法刷新", "error");
    }
  }

  async function handleFavorite(entry) {
    if (!entry?.id || favoriteBusyRef.current) return;
    const favorite = !entry.favorite;
    favoriteBusyRef.current = entry.id;
    setFavoriteBusyId(entry.id);
    try {
      if (isTauriRuntime) {
        const entries = await setFavorite(entry.id, favorite);
        const updatedEntry = entries.find((item) => item.id === entry.id);
        setRecent((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite: updatedEntry?.favorite ?? favorite } : item
        )));
      } else {
        setRecent((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite } : item
        )));
      }
      showFeedbackRef.current(favorite ? "已加入收藏" : "已取消收藏", "recorded");
    } catch (error) {
      showFeedbackRef.current(typeof error === "string" ? error : "收藏状态更新失败，请重试", "error");
    } finally {
      favoriteBusyRef.current = "";
      setFavoriteBusyId("");
    }
  }

  function handleDropEvent(event) {
    const type = event.payload?.type;
    if (type === "enter" || type === "over") {
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
    const nextPaths = mergePendingPaths([], paths);
    if (!nextPaths.length) {
      showFeedbackRef.current("没有找到可记录的路径", "error");
      return;
    }
    if (recordingRef.current) {
      pendingPathsRef.current = mergePendingPaths(pendingPathsRef.current, nextPaths);
      return;
    }
    void processRecordPaths(nextPaths);
  }

  async function processRecordPaths(paths) {
    recordingRef.current = true;
    setStatus("recording");
    setFeedback("正在记录资料...");
    try {
      const result = await recordFloatingPaths(paths);
      setRecent(getRecentEntries(result.recent));
      showFeedbackRef.current(getRecordMessage(result), getRecordStatus(result));
    } catch (error) {
      showFeedbackRef.current(typeof error === "string" ? error : "悬浮球记录失败，请重试", "error");
    } finally {
      recordingRef.current = false;
      const pendingPaths = pendingPathsRef.current;
      pendingPathsRef.current = [];
      if (pendingPaths.length) void processRecordPaths(pendingPaths);
    }
  }

  function handleBrowserDrop(event) {
    if (isTauriRuntime) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].slice(0, 8);
    if (!files.length) return;
    const timestamp = Date.now();
    const additions = files.map((file, index) => ({
      id: `floating-demo-${timestamp}-${index}`,
      name: file.name || "未命名资料",
      type: "演示记录",
      kind: "other",
      status: "已记录",
      invalid: false,
      recordedAt: timestamp + index,
    }));
    setRecent((current) => getRecentEntries([...additions, ...current]));
    showFeedbackRef.current(`演示记录 ${additions.length} 项`, "recorded");
  }

  return {
    favoriteBusyId,
    handleBrowserDrop,
    handleDropEvent,
    handleFavorite,
    recent,
    refreshRecent,
  };
}
