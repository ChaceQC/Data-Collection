import { useCallback, useEffect, useRef, useState } from "react";
import { save } from "@tauri-apps/plugin-dialog";
import { getOperationError } from "../../lib/ipcContracts.js";
import { createOperationId } from "../operations/operationModel.js";
import { getIndexSnapshotDecision } from "./libraryModel.js";
import { libraryRepository } from "./libraryRepository.js";

export function useIndexController({
  isTauriRuntime,
  initialFiles,
  setSelectedId,
  setPreviewEntryId,
  directoryView,
  setDirectoryView,
  showToast,
  operationReporter,
}) {
  const [files, setFiles] = useState(isTauriRuntime ? [] : initialFiles);
  const [groups, setGroups] = useState([]);
  const [undoStatus, setUndoStatus] = useState(null);
  const [indexReady, setIndexReady] = useState(!isTauriRuntime);
  const [indexing, setIndexing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState("");
  const [indexRecovery, setIndexRecovery] = useState(null);
  const [diagnosticExporting, setDiagnosticExporting] = useState(false);
  const [latestRevision, setLatestRevision] = useState(0);
  const latestRevisionRef = useRef(0);
  const reloadPromiseRef = useRef(null);
  const requestedRevisionRef = useRef(0);
  const directoryViewRef = useRef(directoryView);
  const showToastRef = useRef(showToast);

  directoryViewRef.current = directoryView;
  showToastRef.current = showToast;

  const applyIndexSnapshot = useCallback((snapshot) => {
    const loadedFiles = snapshot?.entries || [];
    const revision = Number.isSafeInteger(snapshot?.revision)
      ? snapshot.revision
      : latestRevisionRef.current;
    if (getIndexSnapshotDecision(latestRevisionRef.current, revision) === "stale") return false;
    latestRevisionRef.current = revision;
    setLatestRevision(revision);
    setFiles(loadedFiles);
    setGroups(Array.isArray(snapshot?.groups) ? snapshot.groups : []);
    setUndoStatus(snapshot?.undo || null);
    setIndexRecovery(snapshot?.recovery || null);
    const currentDirectoryEntries = directoryViewRef.current?.entries || [];
    setSelectedId((currentId) => loadedFiles.some((file) => file.id === currentId)
      || currentDirectoryEntries.some((file) => file.id === currentId)
      ? currentId
      : loadedFiles[0]?.id || "");
    setPreviewEntryId((currentId) => currentId && (
      loadedFiles.some((file) => file.id === currentId)
      || directoryViewRef.current?.entries?.some((file) => file.id === currentId)
    ) ? currentId : null);
    return true;
  }, [setPreviewEntryId, setSelectedId]);

  const reloadIndexPreservingState = useCallback(async (requiredRevision = 0) => {
    requestedRevisionRef.current = Math.max(
      requestedRevisionRef.current,
      Number.isSafeInteger(requiredRevision) ? requiredRevision : 0,
    );
    if (reloadPromiseRef.current) return reloadPromiseRef.current;
    reloadPromiseRef.current = (async () => {
      try {
        while (true) {
          const snapshot = await libraryRepository.loadIndex();
          if (getIndexSnapshotDecision(
            latestRevisionRef.current,
            snapshot.revision,
            requestedRevisionRef.current,
          ) === "accept") {
            applyIndexSnapshot(snapshot);
            const activeDirectory = directoryViewRef.current;
            const folder = activeDirectory?.trail?.at(-1);
            if (folder) {
              try {
                const entries = await libraryRepository.listDirectory(
                  folder.directoryId || folder.id,
                  Array.isArray(folder.relativePath) ? folder.relativePath : [],
                );
                setDirectoryView((current) => current === activeDirectory ? { ...current, entries } : current);
              } catch {
                setDirectoryView(null);
                setPreviewEntryId(null);
              }
            }
          }
          if (requestedRevisionRef.current <= latestRevisionRef.current) break;
        }
      } catch {
        showToastRef.current("无法同步本地资料索引，请重试");
      } finally {
        const needsAnotherReload = requestedRevisionRef.current > latestRevisionRef.current;
        reloadPromiseRef.current = null;
        if (needsAnotherReload) void reloadIndexPreservingState();
      }
    })();
    return reloadPromiseRef.current;
  }, [applyIndexSnapshot, setDirectoryView, setPreviewEntryId]);

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let cancelled = false;
    libraryRepository.loadIndex()
      .then((snapshot) => {
        if (cancelled) return;
        applyIndexSnapshot(snapshot);
        setIndexReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIndexReady(true);
        showToastRef.current("无法读取本地资料索引，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, [applyIndexSnapshot, isTauriRuntime]);

  const handleRefreshIndex = useCallback(async () => {
    if (!isTauriRuntime || refreshing) return;
    const operationId = createOperationId("refresh");
    operationReporter?.startOperation({ id: operationId, operation: "refresh", totalCount: files.length });
    setRefreshing(true);
    setRefreshError("");
    try {
      const result = await libraryRepository.refreshIndex();
      if (result.changedCount || result.recoveredCount || result.revision > latestRevisionRef.current) {
        await reloadIndexPreservingState(result.revision);
      }
      const message = result.changedCount
        ? `已刷新 ${result.changedCount} 项${result.invalidCount ? `，失效路径 ${result.invalidCount} 项` : ""}`
        : result.invalidCount
          ? `索引已是最新，当前有 ${result.invalidCount} 项失效路径`
        : "索引已是最新";
      operationReporter?.finishOperation(operationId, {
        status: "success",
        totalCount: files.length,
        updatedCount: result.changedCount,
        successCount: result.changedCount,
        invalidCount: result.invalidCount,
        recoveredCount: result.recoveredCount,
      });
      showToastRef.current(message);
    } catch (error) {
      const message = getOperationError(error, "索引刷新失败，请重试");
      setRefreshError(message);
      operationReporter?.failOperation(operationId, "索引刷新失败，请重试");
      showToastRef.current(message);
    } finally {
      setRefreshing(false);
    }
  }, [files.length, isTauriRuntime, operationReporter, refreshing, reloadIndexPreservingState]);

  const resetIndexRecovery = useCallback(async () => {
    if (!isTauriRuntime || refreshing) return;
    setRefreshing(true);
    try {
      const snapshot = await libraryRepository.resetIndexRecovery();
      applyIndexSnapshot(snapshot);
      showToastRef.current("已建立空索引，请重新导入资料");
    } catch (error) {
      showToastRef.current(getOperationError(error, "无法重建索引，请重试"));
    } finally {
      setRefreshing(false);
    }
  }, [applyIndexSnapshot, isTauriRuntime, refreshing]);

  const exportIndexDiagnostic = useCallback(async () => {
    if (!isTauriRuntime || diagnosticExporting) return;
    setDiagnosticExporting(true);
    try {
      const destination = await save({
        title: "导出索引诊断信息",
        defaultPath: "本地资料工作台-索引诊断.json",
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (!destination) return;
      await libraryRepository.exportIndexDiagnostic(destination);
      showToastRef.current("索引诊断信息已导出");
    } catch (error) {
      showToastRef.current(getOperationError(error, "诊断信息导出失败，请重试"));
    } finally {
      setDiagnosticExporting(false);
    }
  }, [diagnosticExporting, isTauriRuntime]);

  return {
    applyIndexSnapshot,
    diagnosticExporting,
    exportIndexDiagnostic,
    files,
    groups,
    indexReady,
    indexRecovery,
    indexing,
    latestRevision,
    latestRevisionRef,
    refreshError,
    refreshing,
    undoStatus,
    reloadIndexPreservingState,
    resetIndexRecovery,
    setFiles,
    setIndexing,
    handleRefreshIndex,
  };
}
