import { useEffect, useRef, useState } from "react";
import {
  getFloatingFiles,
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
  const [entries, setEntries] = useState(isTauriRuntime ? [] : DEMO_RECENT);
  const [entriesStatus, setEntriesStatus] = useState(isTauriRuntime ? "loading" : "ready");
  const [libraryCount, setLibraryCount] = useState(isTauriRuntime ? null : DEMO_RECENT.length);
  const [libraryCountStatus, setLibraryCountStatus] = useState(isTauriRuntime ? "loading" : "ready");
  const [favoriteBusyId, setFavoriteBusyId] = useState("");
  const showFeedbackRef = useRef(showFeedback);
  const recordingRef = useRef(false);
  const favoriteBusyRef = useRef("");
  const pendingPathsRef = useRef([]);
  const entriesRequestRef = useRef(0);
  const countRequestRef = useRef(0);
  showFeedbackRef.current = showFeedback;

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    void refreshRecent({ initial: true });
    return () => {
      entriesRequestRef.current += 1;
      countRequestRef.current += 1;
    };
  }, [isTauriRuntime]);

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

  async function refreshRecent({ initial = false } = {}) {
    if (!isTauriRuntime) return;
    const entriesRequestId = ++entriesRequestRef.current;
    const countRequestId = ++countRequestRef.current;
    if (initial || !entries.length) setEntriesStatus("loading");
    setLibraryCountStatus("loading");

    const recentRequest = getFloatingRecent()
      .then((result) => {
        if (entriesRequestId !== entriesRequestRef.current) return;
        setEntries(getRecentEntries(result?.recent || result));
        setEntriesStatus("ready");
      })
      .catch(() => {
        if (entriesRequestId !== entriesRequestRef.current) return;
        setEntriesStatus("error");
        if (initial) showFeedbackRef.current("悬浮球状态读取失败，请重试", "error");
        else showFeedbackRef.current("文件库暂时无法刷新", "error");
      });
    const countRequest = getFloatingFiles({ offset: 0, limit: 1 })
      .then((result) => {
        if (countRequestId !== countRequestRef.current) return;
        setLibraryCount(result.total);
        setLibraryCountStatus("ready");
      })
      .catch(() => {
        if (countRequestId !== countRequestRef.current) return;
        setLibraryCountStatus("error");
        if (initial) showFeedbackRef.current("文件库数量读取失败，请重试", "error");
        else showFeedbackRef.current("文件库数量暂时无法刷新", "error");
      });
    await Promise.allSettled([recentRequest, countRequest]);
  }

  async function handleFavorite(entry) {
    if (!entry?.id || favoriteBusyRef.current) return;
    const favorite = !entry.favorite;
    favoriteBusyRef.current = entry.id;
    setFavoriteBusyId(entry.id);
    try {
      if (isTauriRuntime) {
        const result = await setFavorite(entry.id, favorite);
        const updatedEntry = result.entry;
        setEntries((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite: updatedEntry?.favorite ?? favorite } : item
        )));
      } else {
        setEntries((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite } : item
        )));
      }
      showFeedbackRef.current(favorite ? "已加入收藏" : "已取消收藏", "recorded");
    } catch (error) {
      showFeedbackRef.current(getErrorMessage(error, "收藏状态更新失败，请重试"), "error");
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
      setEntries(getRecentEntries(result.recent));
      setEntriesStatus("ready");
      void refreshLibraryCount();
      showFeedbackRef.current(getRecordMessage(result), getRecordStatus(result));
    } catch (error) {
      showFeedbackRef.current(getErrorMessage(error, "悬浮球记录失败，请重试"), "error");
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
    setEntries((current) => getRecentEntries([...additions, ...current]));
    setLibraryCount((current) => (Number.isSafeInteger(current) ? current : 0) + additions.length);
    setLibraryCountStatus("ready");
    showFeedbackRef.current(`演示记录 ${additions.length} 项`, "recorded");
  }

  async function refreshLibraryCount() {
    if (!isTauriRuntime) return;
    const requestId = ++countRequestRef.current;
    setLibraryCountStatus("loading");
    try {
      const result = await getFloatingFiles({ offset: 0, limit: 1 });
      if (requestId !== countRequestRef.current) return;
      setLibraryCount(result.total);
      setLibraryCountStatus("ready");
    } catch {
      if (requestId !== countRequestRef.current) return;
      setLibraryCountStatus("error");
    }
  }

  return {
    entries,
    entriesStatus,
    favoriteBusyId,
    handleBrowserDrop,
    handleDropEvent,
    handleFavorite,
    libraryCount,
    libraryCountStatus,
    refreshRecent,
  };
}

function getErrorMessage(error, fallback) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.length <= 180 ? message : fallback;
}
