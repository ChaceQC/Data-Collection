import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import {
  getOperationError,
  parseContentIndexStatus,
} from "../../lib/ipcContracts.js";
import { createOperationId } from "../operations/operationModel.js";
import { libraryRepository } from "./libraryRepository.js";

const BROWSER_STATUS = Object.freeze({
  state: "unavailable",
  indexedCount: 0,
  totalBytes: 0,
  failedCount: 0,
  sourceRevision: 0,
  lastError: "正文检索只在桌面应用中可用",
});

export function useContentIndexController({
  isTauriRuntime,
  searchMode,
  searchQuery,
  useRegex,
  showToast,
  operationReporter,
}) {
  const [status, setStatus] = useState(isTauriRuntime ? null : BROWSER_STATUS);
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [rebuilding, setRebuilding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [statusVersion, setStatusVersion] = useState(0);
  const searchSequenceRef = useRef(0);
  const rebuildOperationIdRef = useRef("");
  const showToastRef = useRef(showToast);

  showToastRef.current = showToast;

  const applyStatus = useCallback((nextStatus, refreshSearch = true) => {
    setStatus(nextStatus);
    if (refreshSearch) setStatusVersion((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    let unlisten;
    libraryRepository.contentIndexStatus()
      .then((nextStatus) => {
        if (!disposed) applyStatus(nextStatus);
      })
      .catch((error) => {
        if (!disposed) applyStatus({ ...BROWSER_STATUS, lastError: getOperationError(error, "正文索引状态暂不可用") });
      });
    getCurrentWebview()
      .listen("content-index-changed", (event) => {
        try {
          const nextStatus = parseContentIndexStatus(event.payload, "content-index-changed");
          if (!disposed) applyStatus(nextStatus);
        } catch {
          // Ignore malformed events; the next status request can recover the UI.
        }
      })
      .then((stopListening) => {
        if (disposed) stopListening();
        else unlisten = stopListening;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [applyStatus, isTauriRuntime]);

  useEffect(() => {
    const sequence = ++searchSequenceRef.current;
    const query = String(searchQuery ?? "").trim();
    if (searchMode !== "content" || !query) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError("");
      return undefined;
    }
    if (!isTauriRuntime) {
      setSearchResults([]);
      setSearchLoading(false);
      setSearchError(BROWSER_STATUS.lastError);
      return undefined;
    }
    setSearchResults([]);
    setSearchLoading(true);
    setSearchError("");
    const timeoutId = window.setTimeout(() => {
      libraryRepository.searchContent(searchQuery, useRegex)
        .then((response) => {
          if (sequence !== searchSequenceRef.current) return;
          setStatus(response.status);
          setSearchResults(response.results);
          setSearchLoading(false);
        })
        .catch((error) => {
          if (sequence !== searchSequenceRef.current) return;
          setSearchResults([]);
          setSearchLoading(false);
          setSearchError(getOperationError(error, "正文搜索失败，请重试或重建正文索引"));
        });
    }, 140);
    return () => window.clearTimeout(timeoutId);
  }, [isTauriRuntime, searchMode, searchQuery, statusVersion, useRegex]);

  const rebuild = useCallback(async () => {
    if (!isTauriRuntime || rebuilding || clearing) return;
    const operationId = createOperationId("content-index");
    rebuildOperationIdRef.current = operationId;
    setRebuilding(true);
    operationReporter?.startOperation({ id: operationId, operation: "content-index" });
    try {
      const result = await libraryRepository.rebuildContentIndex(operationId);
      setStatus(result.status);
      setStatusVersion((value) => value + 1);
      operationReporter?.finishOperation(operationId, {
        status: result.timedOut ? "timed-out" : result.cancelled ? "cancelled" : result.skippedCount ? "partial-success" : "success",
        totalCount: result.indexedCount + result.updatedCount + result.skippedCount,
        addedCount: result.indexedCount,
        updatedCount: result.updatedCount,
        successCount: result.indexedCount + result.updatedCount,
        skippedCount: result.skippedCount,
        skippedReasons: result.skippedReasons,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
      });
      if (result.cancelled) showToastRef.current("正文索引重建已取消，保留原有索引");
      else if (result.skippedCount) showToastRef.current(`正文索引已重建，跳过 ${result.skippedCount} 项`);
      else showToastRef.current(`正文索引已重建，共 ${result.status.indexedCount} 项`);
    } catch (error) {
      operationReporter?.failOperation(operationId, "正文索引重建失败，请重试");
      showToastRef.current(getOperationError(error, "正文索引重建失败，请重试"));
    } finally {
      rebuildOperationIdRef.current = "";
      setRebuilding(false);
    }
  }, [clearing, isTauriRuntime, operationReporter, rebuilding]);

  const clear = useCallback(async () => {
    if (!isTauriRuntime || rebuilding || clearing) return;
    setClearing(true);
    try {
      const nextStatus = await libraryRepository.clearContentIndex();
      setStatus(nextStatus);
      setStatusVersion((value) => value + 1);
      setSearchResults([]);
      showToastRef.current("正文索引已清除");
    } catch (error) {
      showToastRef.current(getOperationError(error, "正文索引清除失败，请重试"));
    } finally {
      setClearing(false);
    }
  }, [clearing, isTauriRuntime, rebuilding]);

  const cancelRebuild = useCallback(async () => {
    const operationId = rebuildOperationIdRef.current;
    if (!isTauriRuntime || !operationId) return;
    try {
      await libraryRepository.cancelContentIndex(operationId);
      showToastRef.current("已请求取消正文索引重建");
    } catch (error) {
      showToastRef.current(getOperationError(error, "无法取消正文索引重建，请稍候重试"));
    }
  }, [isTauriRuntime]);

  return {
    cancelRebuild,
    clearing,
    clear,
    rebuild,
    rebuilding,
    searchError,
    searchLoading,
    searchResults,
    status,
  };
}
