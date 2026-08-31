import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getOperationError } from "../../lib/ipcContracts.js";
import { getFileKind, getFileType } from "../../lib/fileTypes.js";
import { libraryRepository } from "./libraryRepository.js";
import {
  createBrowserEntries,
  getNextSelection,
  getSelectedEntries,
  normalizeTagInput,
  summarizeBatchResult,
  validateRename,
  validateTagInput,
} from "./libraryControllerModel.js";
import { getEntryLocation } from "./libraryModel.js";

export function useLibraryActions({
  isTauriRuntime,
  files,
  setFiles,
  settings,
  setActiveNav,
  setSelectedId,
  setDirectoryView,
  previewEntryId,
  setPreviewEntryId,
  openDirectory,
  applyIndexSnapshot,
  reloadIndexPreservingState,
  setSelectedIds,
  setIndexing,
  showToast,
}) {
  const [busyFileId, setBusyFileId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [retryBatch, setRetryBatch] = useState(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const repositionInputRef = useRef(null);
  const repositionTargetIdRef = useRef(null);
  const busyFileIdRef = useRef("");
  const batchBusyRef = useRef(false);
  const activeBatchOperationIdRef = useRef("");
  const groupBusyRef = useRef(false);
  const indexingRef = useRef(false);
  const indexRealPathsRef = useRef(null);

  indexRealPathsRef.current = indexRealPaths;

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    let unlisten;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragActive(true);
        if (event.payload.type === "leave") setDragActive(false);
        if (event.payload.type === "drop") {
          setDragActive(false);
          void indexRealPathsRef.current(event.payload.paths);
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
  }, [isTauriRuntime]);

  const [dragActive, setDragActive] = useState(false);
  const renameValidation = useMemo(() => (
    pendingAction?.type === "rename"
      ? validateRename(pendingAction.file, renameName, files)
      : { valid: true, errors: [], message: "" }
  ), [files, pendingAction, renameName]);

  function showActionError(error, fallback) {
    showToast(getOperationError(error, fallback));
  }

  async function releasePreviewForAction(fileId) {
    if (previewEntryId !== fileId) return;
    setPreviewEntryId(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  async function handleFavorite(file) {
    if (!file?.id || busyFileIdRef.current) return;
    const favorite = !file.favorite;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      if (isTauriRuntime) {
        const result = await libraryRepository.setFavorite(file.id, favorite);
        if (result.entry) setFiles((current) => current.map((item) => item.id === file.id ? result.entry : item));
      } else {
        setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite } : item));
      }
      setSelectedId(file.id);
      showToast(favorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      showActionError(error, "收藏状态更新失败，请重试");
    } finally {
      finishBusy();
    }
  }

  function requestRemove(file) {
    if (settings.confirmBeforeRemove) setPendingAction({ type: "remove", file });
    else void removeIndexRecord(file);
  }

  function requestRename(file) {
    setRenameName(file.name);
    setPendingAction({ type: "rename", file });
  }

  function requestDelete(file) {
    if (!isTauriRuntime) {
      showToast("删除原文件请在桌面应用中执行");
      return;
    }
    setPendingAction({ type: "delete", file });
  }

  function closePendingAction() {
    if (!busyFileIdRef.current && !batchBusyRef.current) setPendingAction(null);
  }

  async function removeIndexRecord(file) {
    if (!file || busyFileIdRef.current) return;
    const fileId = file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      if (isTauriRuntime) await libraryRepository.removeIndexEntry(fileId);
      const updatedFiles = files.filter((item) => item.id !== fileId);
      setFiles(updatedFiles);
      setDirectoryView(null);
      setSelectedId((currentId) => currentId === fileId ? getNextSelection(updatedFiles, "") : currentId);
      setPendingAction(null);
      showToast("已从资料库移除，原文件未改变");
    } catch (error) {
      showActionError(error, "移除记录失败，原文件未改变");
    } finally {
      finishBusy();
    }
  }

  async function confirmRemove() {
    if (pendingAction?.type === "remove" && !busyFileIdRef.current) await removeIndexRecord(pendingAction.file);
  }

  async function confirmRename() {
    if (pendingAction?.type !== "rename" || busyFileIdRef.current || !renameValidation.valid) return;
    const file = pendingAction.file;
    const fileId = file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      if (isTauriRuntime) {
        const result = await libraryRepository.renameIndexedFile(fileId, renameName);
        if (result.entry) setFiles((current) => current.map((item) => item.id === fileId ? result.entry : item));
      } else {
        setFiles((current) => current.map((item) => {
          if (item.id !== fileId) return item;
          const kind = getFileKind(renameName);
          return { ...item, name: renameName, kind, type: getFileType(renameName, kind) };
        }));
      }
      setSelectedId(fileId);
      setPendingAction(null);
      showToast("文件已重命名");
    } catch (error) {
      showActionError(error, "重命名失败，原文件未改变");
    } finally {
      finishBusy();
    }
  }

  async function handleCopy(file) {
    await runNamedAction(file, libraryRepository.copyIndexedFile, "复制到系统剪贴板", "复制失败，原文件未改变");
  }

  async function handleOpenDefault(file) {
    await runNamedAction(file, libraryRepository.openIndexedFile, "已请求系统默认程序打开", "无法用默认程序打开，请检查文件关联");
  }

  async function handleReveal(file, directoryView) {
    if (directoryView && !file?.path) {
      if (!isTauriRuntime) {
        showToast("定位文件夹子项请在桌面应用中执行");
        return;
      }
      if (!file.directoryId || !Array.isArray(file.relativePath)) return;
      try {
        const result = await libraryRepository.revealDirectoryChild(file.directoryId, file.relativePath);
        showToast(`已在资源管理器中定位：${result.name}`);
      } catch (error) {
        showActionError(error, "无法在资源管理器中定位，请检查路径");
      }
      return;
    }
    await runNamedAction(file, libraryRepository.revealIndexedFile, "已在资源管理器中定位", "无法在资源管理器中定位，请检查路径");
  }

  async function runNamedAction(file, action, successPrefix, fallback) {
    if (!isTauriRuntime) {
      showToast("此操作请在桌面应用中执行");
      return;
    }
    if (!file?.id || busyFileIdRef.current) return;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      const result = await action(file.id);
      setSelectedId(file.id);
      showToast(`${successPrefix}：${result.name}${successPrefix.includes("复制") ? "，可在目标文件夹粘贴" : ""}`);
    } catch (error) {
      showActionError(error, fallback);
    } finally {
      finishBusy();
    }
  }

  async function confirmDelete() {
    if (pendingAction?.type !== "delete" || busyFileIdRef.current || !isTauriRuntime) return;
    const fileId = pendingAction.file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      await libraryRepository.deleteOriginalFile(fileId);
      const updatedFiles = files.filter((item) => item.id !== fileId);
      setFiles(updatedFiles);
      setSelectedId((currentId) => currentId === fileId ? getNextSelection(updatedFiles, "") : currentId);
      setPendingAction(null);
      showToast("原文件已移入回收站");
    } catch (error) {
      showActionError(error, "删除原文件失败，索引和原文件状态未确认");
    } finally {
      finishBusy();
    }
  }

  function requestBatchRemove(fileIds) {
    const entries = getSelectedEntries(files, fileIds);
    if (!entries.length) {
      showToast("请先选择资料");
      return;
    }
    setPendingAction({
      type: "batch-remove",
      fileIds: entries.map((entry) => entry.id),
      files: entries,
    });
  }

  async function confirmBatchRemove() {
    if (pendingAction?.type !== "batch-remove" || !pendingAction.fileIds?.length) return;
    const fileIds = [...pendingAction.fileIds];
    setPendingAction(null);
    await runBatchAction(
      fileIds,
      (ids, operationId) => libraryRepository.batchRemoveIndexEntries(ids, operationId),
      "批量移除完成",
      "批量移除失败，请刷新索引确认状态",
      true,
    );
  }

  async function handleBatchFavorite(fileIds, favorite) {
    await runBatchAction(
      fileIds,
      (ids, operationId) => libraryRepository.batchSetFavorite(ids, favorite, operationId),
      favorite ? "批量收藏完成" : "批量取消收藏完成",
      "批量更新收藏失败，请重试",
    );
  }

  async function handleBatchTags(fileIds, value, add) {
    const validation = validateTagInput(value);
    if (!validation.valid) {
      showToast(validation.message);
      return;
    }
    await runBatchAction(
      fileIds,
      (ids, operationId) => libraryRepository.batchUpdateTags(ids, [validation.value], add, operationId),
      add ? "批量添加标签完成" : "批量移除标签完成",
      "批量更新标签失败，请重试",
    );
  }

  async function handleBatchGroup(fileIds, groupId) {
    await runBatchAction(
      fileIds,
      (ids, operationId) => libraryRepository.batchSetGroup(ids, groupId || null, operationId),
      groupId ? "批量分组完成" : "已解除所选资料的分组归属",
      "批量更新分组失败，请重试",
    );
  }

  async function runBatchAction(fileIds, action, successPrefix, fallback, removeSuccessful = false) {
    if (!isTauriRuntime) {
      showToast("批量操作请在桌面应用中执行");
      return;
    }
    const stableIds = [...new Set(fileIds || [])].filter(Boolean);
    if (!stableIds.length || batchBusyRef.current) return;
    const operationId = createOperationId();
    activeBatchOperationIdRef.current = operationId;
    setRetryBatch(null);
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await action(stableIds, operationId);
      const successIds = (result.results || []).filter((item) => item.status === "success").map((item) => item.id);
      const retryIds = (result.results || []).filter(isRetryableBatchItem).map((item) => item.id);
      setRetryBatch(retryIds.length ? { fileIds: retryIds, action, successPrefix, fallback, removeSuccessful } : null);
      if (result.changedIds?.length || result.revision > 0) await reloadIndexPreservingState(result.revision);
      if (removeSuccessful) setSelectedIds((current) => current.filter((id) => !successIds.includes(id)));
      const summary = summarizeBatchResult(result);
      const details = [`成功 ${summary.success} 项`];
      if (summary.skipped) details.push(`跳过 ${summary.skipped} 项`);
      if (summary.failed) details.push(`失败 ${summary.failed} 项`);
      showToast(`${successPrefix}：${details.join("，")}`);
    } catch (error) {
      showActionError(error, fallback);
    } finally {
      activeBatchOperationIdRef.current = "";
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  }

  async function handleRetryBatch() {
    if (!retryBatch || batchBusyRef.current) return;
    const { fileIds, action, successPrefix, fallback, removeSuccessful } = retryBatch;
    await runBatchAction(fileIds, action, successPrefix, fallback, removeSuccessful);
  }

  async function handleCancelBatch() {
    const operationId = activeBatchOperationIdRef.current;
    if (!isTauriRuntime || !operationId) return;
    try {
      await libraryRepository.cancelBatchOperation(operationId);
      showToast("已请求取消批量操作，正在整理已完成项");
    } catch (error) {
      showActionError(error, "无法取消批量操作，请稍候查看结果");
    }
  }

  async function handleUndo() {
    if (!isTauriRuntime || batchBusyRef.current) return;
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await libraryRepository.undoLast();
      await reloadIndexPreservingState(result.revision);
      showToast("已撤销上一项可撤销的索引操作");
      setSelectedIds([]);
    } catch (error) {
      showActionError(error, "撤销不可用，索引可能已经发生变化");
    } finally {
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  }

  async function createGroup(name) {
    const normalized = validateGroupName(name);
    if (!normalized) {
      showToast("分组名称不能为空，且不能超过 64 个字符");
      return false;
    }
    if (!isTauriRuntime) {
      showToast("分组管理请在桌面应用中执行");
      return false;
    }
    if (groupBusyRef.current) return false;
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await libraryRepository.createGroup(normalized);
      await reloadIndexPreservingState(result.revision);
      showToast(`已创建分组“${normalized}”`);
      return true;
    } catch (error) {
      showActionError(error, "创建分组失败，请重试");
      return false;
    } finally {
      groupBusyRef.current = false;
      setGroupBusy(false);
    }
  }

  async function renameGroup(groupId, name) {
    const normalized = validateGroupName(name);
    if (!normalized) {
      showToast("分组名称不能为空，且不能超过 64 个字符");
      return false;
    }
    if (!isTauriRuntime || groupBusyRef.current) return false;
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await libraryRepository.renameGroup(groupId, normalized);
      await reloadIndexPreservingState(result.revision);
      showToast(`分组已重命名为“${normalized}”`);
      return true;
    } catch (error) {
      showActionError(error, "重命名分组失败，请重试");
      return false;
    } finally {
      groupBusyRef.current = false;
      setGroupBusy(false);
    }
  }

  async function deleteGroup(groupId) {
    if (!isTauriRuntime || groupBusyRef.current) return false;
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await libraryRepository.deleteGroup(groupId);
      await reloadIndexPreservingState(result.revision);
      showToast("分组已删除，资料记录和原文件未改变");
      return true;
    } catch (error) {
      showActionError(error, "删除分组失败，请重试");
      return false;
    } finally {
      groupBusyRef.current = false;
      setGroupBusy(false);
    }
  }

  async function handleCopyLocation(file, directoryView) {
    const location = getEntryLocation(file, directoryView);
    if (!location.fullPath || location.fullPath === "登记文件夹") {
      showToast("当前位置暂时不可用");
      return;
    }
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(location.fullPath);
      showToast("资料位置已复制");
    } catch {
      showToast("无法复制资料位置，请展开位置后手动选择");
    }
  }

  async function indexRealPaths(paths) {
    if (!isTauriRuntime || !paths?.length || indexingRef.current) return;
    indexingRef.current = true;
    setIndexing(true);
    try {
      const result = await libraryRepository.indexPaths(paths);
      const snapshot = await libraryRepository.loadIndex();
      applyIndexSnapshot(snapshot);
      setDirectoryView(null);
      setPreviewEntryId(null);
      setActiveNav("library");
      setSelectedId(result.addedIds[0] || snapshot.entries[0]?.id || "");
      const messages = [];
      if (result.indexedCount) messages.push(`已索引 ${result.indexedCount} 项`);
      if (result.refreshedCount) messages.push(`更新 ${result.refreshedCount} 项`);
      if (result.skippedCount) messages.push(`跳过 ${result.skippedCount} 项${result.skippedReasons.length ? `（${result.skippedReasons.join("、")}）` : ""}`);
      if (result.truncated) messages.push("已达到本次索引上限");
      showToast(messages.join("，") || "没有找到可索引的文件");
    } catch (error) {
      showActionError(error, "索引失败，请检查路径和访问权限");
    } finally {
      indexingRef.current = false;
      setIndexing(false);
    }
  }

  function addBrowserFiles(fileList) {
    const additions = createBrowserEntries(fileList);
    if (!additions.length) return;
    setFiles((current) => [...additions, ...current]);
    setSelectedId(additions[0].id);
    setPreviewEntryId(null);
    setActiveNav("library");
    showToast(`已登记 ${additions.length} 项`);
  }

  async function choosePaths(mode) {
    if (!isTauriRuntime) {
      if (mode === "folder") folderInputRef.current?.click();
      if (mode === "file") fileInputRef.current?.click();
      return;
    }
    try {
      const selected = await open({ directory: mode === "folder" || mode === "reposition", multiple: mode !== "reposition", title: mode === "folder" ? "选择资料文件夹" : "选择资料文件" });
      const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : [];
      if (!paths.length) return;
      if (mode === "reposition") await repositionRealPath(paths[0]);
      else await indexRealPaths(paths);
    } catch (error) {
      showActionError(error, "无法打开文件选择器，请重试");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    if (!isTauriRuntime) addBrowserFiles(event.dataTransfer.files);
  }

  function handleDragOver(event) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event) {
    if (event.currentTarget === event.target) setDragActive(false);
  }

  async function repositionRealPath(newPath) {
    const fileId = repositionTargetIdRef.current;
    if (!fileId) return;
    setPreviewEntryId(null);
    try {
      const result = await libraryRepository.repositionFile(fileId, newPath);
      if (result.entry) setFiles((current) => current.map((item) => item.id === fileId ? result.entry : item));
      setSelectedId(fileId);
      showToast("路径已更新");
    } catch (error) {
      showActionError(error, "重新定位失败，请选择可访问的文件");
    }
  }

  function openRepositionPicker(file) {
    repositionTargetIdRef.current = file.id;
    if (isTauriRuntime) void choosePaths("reposition");
    else repositionInputRef.current?.click();
  }

  function repositionInvalidPath(fileList) {
    const pickedFile = Array.from(fileList || {})[0];
    const targetId = repositionTargetIdRef.current;
    if (!pickedFile) return;
    const kind = getFileKind(pickedFile.name);
    setFiles((current) => current.map((file) => file.id === targetId ? { ...file, name: pickedFile.name, kind, type: getFileType(pickedFile.name, kind), status: "已登记", invalid: false, modified: "刚刚" } : file));
    setSelectedId(targetId);
    showToast("路径已更新");
  }

  async function openFromFloating(payload) {
    const fileId = payload?.fileId;
    if (!fileId || !isTauriRuntime) return;
    try {
      const snapshot = await libraryRepository.loadIndex();
      const target = snapshot.entries.find((file) => file.id === fileId);
      applyIndexSnapshot(snapshot);
      setDirectoryView(null);
      setActiveNav("library");
      setSelectedId(fileId);
      setPreviewEntryId(target && !target.invalid && target.kind !== "folder" ? fileId : null);
      if (!target) showToast("资料已从索引中移除");
      else if (target.invalid) showToast("该资料路径已失效，请重新定位");
      else if (target.kind === "folder") {
        showToast("已打开资料库中的文件夹记录");
        openDirectory(target, [target]);
      }
    } catch (error) {
      showActionError(error, "无法定位悬浮球记录，请重试");
    }
  }

  function finishBusy() {
    busyFileIdRef.current = "";
    setBusyFileId("");
  }

  return {
    addBrowserFiles,
    busyFileId,
    choosePaths,
    closePendingAction,
    confirmDelete,
    confirmRemove,
    confirmRename,
    confirmBatchRemove,
    batchBusy,
    dragActive,
    fileInputRef,
    folderInputRef,
    handleCopy,
    handleDragLeave,
    handleDragOver,
    handleDrop,
    handleFavorite,
    handleOpenDefault,
    handleReveal,
    handleBatchFavorite,
    handleBatchGroup,
    handleBatchTags,
    handleCancelBatch,
    handleCopyLocation,
    handleRetryBatch,
    handleUndo,
    indexRealPaths,
    openFromFloating,
    openRepositionPicker,
    pendingAction,
    repositionInputRef,
    repositionInvalidPath,
    renameName,
    renameValidation,
    requestDelete,
    requestBatchRemove,
    requestRemove,
    requestRename,
    setRenameName,
    createGroup,
    deleteGroup,
    groupBusy,
    renameGroup,
    retryBatch,
  };
}

function validateGroupName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return "";
  return normalized;
}

function createOperationId() {
  if (globalThis.crypto?.randomUUID) return `batch-${globalThis.crypto.randomUUID()}`;
  return `batch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function isRetryableBatchItem(item) {
  return item?.status === "failed"
    || (item?.status === "skipped" && (item.reason === "用户已取消" || item.reason === "批量操作超时"));
}
