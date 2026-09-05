import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getOperationError, parseRecursiveImportProgress } from "../../lib/ipcContracts.js";
import { getFileKind, getFileType } from "../../lib/fileTypes.js";
import { createOperationId } from "../operations/operationModel.js";
import { libraryRepository } from "./libraryRepository.js";
import { createLibraryBatchActions } from "./useLibraryBatchActions.js";
import { createFloatingHandoff } from "./useFloatingHandoff.js";
import { createLibraryFileActions } from "./useLibraryFileActions.js";
import { createLibraryHistoryActions } from "./useLibraryHistoryActions.js";
import { createLibraryImportActions } from "./useLibraryImportActions.js";
import { createLibraryMutationActions } from "./useLibraryMutationActions.js";
import {
  addTagToList,
  createBrowserEntries,
  getNextSelection,
  getSelectedEntries,
  isMainIndexEntry,
  MAX_TAGS_PER_ENTRY,
  normalizeTagList,
  removeTagFromList,
  summarizeBatchResult,
  validateDirectPathInput,
  validateRename,
  validateTagInput,
} from "./libraryControllerModel.js";
import { getEntryLocation } from "./libraryModel.js";
import {
  DEFAULT_RECURSIVE_IMPORT_POLICY,
  describeRecursiveImportPolicy,
  getRecursiveImportFolderName,
  normalizeRecursiveImportPolicy,
} from "./recursiveImportModel.js";

export function useLibraryActions({
  isTauriRuntime,
  files,
  setFiles,
  settings,
  setActiveNav,
  setSelectedId,
  setDirectoryView,
  setDirectoryError,
  previewEntryId,
  setPreviewEntryId,
  focusEntry,
  resetToLibrary,
  openDirectory,
  applyIndexSnapshot,
  reloadIndexPreservingState,
  setSelectedIds,
  setIndexing,
  showToast,
  operationReporter,
}) {
  const importActions = useMemo(() => createLibraryImportActions(libraryRepository), []);
  const mutationActions = useMemo(() => createLibraryMutationActions(libraryRepository), []);
  const batchActions = useMemo(() => createLibraryBatchActions(libraryRepository), []);
  const fileActions = useMemo(() => createLibraryFileActions(libraryRepository), []);
  const historyActions = useMemo(() => createLibraryHistoryActions(libraryRepository), []);
  const floatingHandoff = useMemo(() => createFloatingHandoff(libraryRepository), []);
  const [busyFileId, setBusyFileId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [renameName, setRenameName] = useState("");
  const [tagDraft, setTagDraft] = useState([]);
  const [tagInput, setTagInput] = useState("");
  const [groupDraft, setGroupDraft] = useState("");
  const [batchBusy, setBatchBusy] = useState(false);
  const [retryBatch, setRetryBatch] = useState(null);
  const [recursiveImportProgress, setRecursiveImportProgress] = useState(null);
  const [groupBusy, setGroupBusy] = useState(false);
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const repositionInputRef = useRef(null);
  const repositionTargetIdRef = useRef(null);
  const busyFileIdRef = useRef("");
  const batchBusyRef = useRef(false);
  const activeBatchOperationIdRef = useRef("");
  const activeImportOperationIdRef = useRef("");
  const retryImportRef = useRef(null);
  const groupBusyRef = useRef(false);
  const indexingRef = useRef(false);
  const indexRealPathsRef = useRef(null);
  const floatingOpenRequestRef = useRef(0);

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

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    let unlisten;
    getCurrentWebview()
      .listen("recursive-import-progress", (event) => {
        const payload = safeParse(parseRecursiveImportProgress, event.payload, "recursive-import-progress");
        if (!payload || payload.operationId !== activeImportOperationIdRef.current) return;
        setRecursiveImportProgress((current) => ({ ...current, ...payload }));
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
    const operationId = createOperationId("favorite");
    operationReporter?.startOperation({ id: operationId, operation: "favorite", totalCount: 1, request: { favorite } });
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      if (isTauriRuntime) {
        const result = await mutationActions.setFavorite(file.id, favorite);
        if (result.entry) setFiles((current) => current.map((item) => item.id === file.id ? result.entry : item));
      } else {
        setFiles((current) => current.map((item) => item.id === file.id ? { ...item, favorite } : item));
      }
      setSelectedId(file.id);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1, request: { favorite } });
      showToast(favorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      operationReporter?.failOperation(operationId, "收藏状态更新失败，请重试");
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

  function requestEditTags(file) {
    if (!isMainIndexEntry(file)) return;
    setTagDraft(normalizeTagList(file.tags));
    setTagInput("");
    setPendingAction({ type: "edit-tags", file });
  }

  function requestSetGroup(file) {
    if (!isMainIndexEntry(file)) return;
    setGroupDraft(file.groupId || "");
    setPendingAction({ type: "set-group", file });
  }

  function requestDelete(file) {
    if (!isTauriRuntime) {
      showToast("删除原文件请在桌面应用中执行");
      return;
    }
    setPendingAction({ type: "delete", file });
  }

  function closePendingAction() {
    if (!busyFileIdRef.current && !batchBusyRef.current && !indexingRef.current) setPendingAction(null);
  }

  async function removeIndexRecord(file) {
    if (!file || busyFileIdRef.current) return;
    const fileId = file.id;
    const operationId = createOperationId("index-remove");
    operationReporter?.startOperation({ id: operationId, operation: "index-remove", totalCount: 1 });
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      if (isTauriRuntime) await mutationActions.removeIndexEntry(fileId);
      const updatedFiles = files.filter((item) => item.id !== fileId);
      setFiles(updatedFiles);
      setDirectoryView(null);
      setSelectedId((currentId) => currentId === fileId ? getNextSelection(updatedFiles, "") : currentId);
      setPendingAction(null);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast("已从资料库移除，原文件未改变");
    } catch (error) {
      operationReporter?.failOperation(operationId, "移除记录失败，原文件未改变");
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
    const operationId = createOperationId("rename");
    operationReporter?.startOperation({ id: operationId, operation: "rename", totalCount: 1 });
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      if (isTauriRuntime) {
        const result = await mutationActions.renameIndexedFile(fileId, renameName);
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
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast("文件已重命名");
    } catch (error) {
      operationReporter?.failOperation(operationId, "重命名失败，原文件未改变");
      showActionError(error, "重命名失败，原文件未改变");
    } finally {
      finishBusy();
    }
  }

  function addTag() {
    const next = addTagToList(tagDraft, tagInput);
    if (!next.valid) {
      showToast(next.message);
      return false;
    }
    setTagDraft(next.tags);
    setTagInput("");
    return true;
  }

  function removeTag(tag) {
    setTagDraft((current) => removeTagFromList(current, tag));
  }

  async function confirmTags() {
    if (pendingAction?.type !== "edit-tags" || busyFileIdRef.current) return;
    if (tagInput.trim()) {
      const validation = validateTagInput(tagInput);
      showToast(validation.valid ? "请先点击添加标签" : validation.message);
      return;
    }
    const file = pendingAction.file;
    const fileId = file.id;
    const operationId = createOperationId("tags");
    operationReporter?.startOperation({ id: operationId, operation: "tags", totalCount: 1 });
    const tags = normalizeTagList(tagDraft);
    if (tags.length > MAX_TAGS_PER_ENTRY) {
      showToast(`每条资料最多 ${MAX_TAGS_PER_ENTRY} 个标签`);
      return;
    }
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    try {
      if (isTauriRuntime) {
        const result = await mutationActions.setEntryTags(fileId, tags);
        if (result.entry) setFiles((current) => current.map((item) => item.id === fileId ? result.entry : item));
        await reloadIndexPreservingState(result.revision);
      } else {
        setFiles((current) => current.map((item) => item.id === fileId ? { ...item, tags } : item));
      }
      setSelectedId(fileId);
      setPendingAction(null);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast("标签已更新");
    } catch (error) {
      operationReporter?.failOperation(operationId, "更新标签失败，请重试");
      showActionError(error, "更新标签失败，请重试");
    } finally {
      finishBusy();
    }
  }

  async function confirmGroup() {
    if (pendingAction?.type !== "set-group" || busyFileIdRef.current) return;
    const file = pendingAction.file;
    const fileId = file.id;
    const operationId = createOperationId("group");
    operationReporter?.startOperation({ id: operationId, operation: "group", totalCount: 1 });
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    try {
      if (isTauriRuntime) {
        const result = await mutationActions.setEntryGroup(fileId, groupDraft || null);
        if (result.entry) setFiles((current) => current.map((item) => item.id === fileId ? result.entry : item));
        await reloadIndexPreservingState(result.revision);
      } else {
        setFiles((current) => current.map((item) => item.id === fileId ? { ...item, groupId: groupDraft || null } : item));
      }
      setSelectedId(fileId);
      setPendingAction(null);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast(groupDraft ? "资料已设置分组" : "资料已解除分组归属");
    } catch (error) {
      operationReporter?.failOperation(operationId, "更新分组失败，请重试");
      showActionError(error, "更新分组失败，请重试");
    } finally {
      finishBusy();
    }
  }

  async function handleCopy(file) {
    await runNamedAction(file, fileActions.copy, "复制到系统剪贴板", "复制失败，原文件未改变");
  }

  async function handleOpenDefault(file) {
    await runNamedAction(file, fileActions.openDefault, "已请求系统默认程序打开", "无法用默认程序打开，请检查文件关联");
  }

  async function handleReveal(file, directoryView) {
    if (directoryView && !file?.path) {
      if (!isTauriRuntime) {
        showToast("定位文件夹子项请在桌面应用中执行");
        return;
      }
      if (!file.directoryId || !Array.isArray(file.relativePath)) return;
      try {
        const result = await fileActions.revealDirectoryChild(file.directoryId, file.relativePath);
        showToast(`已在资源管理器中定位：${result.name}`);
      } catch (error) {
        showActionError(error, "无法在资源管理器中定位，请检查路径");
      }
      return;
    }
    await runNamedAction(file, fileActions.reveal, "已在资源管理器中定位", "无法在资源管理器中定位，请检查路径");
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
      await fileActions.deleteOriginal(fileId);
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
    await runBatchAction({
      fileIds,
      action: (ids, operationId) => batchActions.removeIndexEntries(ids, operationId),
      successPrefix: "批量移除完成",
      fallback: "批量移除失败，请刷新索引确认状态",
      removeSuccessful: true,
      operation: "batch-remove-index",
    });
  }

  async function handleBatchFavorite(fileIds, favorite) {
    await runBatchAction({
      fileIds,
      action: (ids, operationId) => batchActions.setFavorite(ids, favorite, operationId),
      successPrefix: favorite ? "批量收藏完成" : "批量取消收藏完成",
      fallback: "批量更新收藏失败，请重试",
      operation: "batch-favorite",
      request: { favorite },
    });
  }

  async function handleBatchTags(fileIds, value, add) {
    const validation = validateTagInput(value);
    if (!validation.valid) {
      showToast(validation.message);
      return;
    }
    await runBatchAction({
      fileIds,
      action: (ids, operationId) => batchActions.updateTags(ids, [validation.value], add, operationId),
      successPrefix: add ? "批量添加标签完成" : "批量移除标签完成",
      fallback: "批量更新标签失败，请重试",
      operation: "batch-tags",
      request: { tags: [validation.value], add },
    });
  }

  async function handleBatchGroup(fileIds, groupId) {
    await runBatchAction({
      fileIds,
      action: (ids, operationId) => batchActions.setGroup(ids, groupId || null, operationId),
      successPrefix: groupId ? "批量分组完成" : "已解除所选资料的分组归属",
      fallback: "批量更新分组失败，请重试",
      operation: "batch-group",
      request: { groupId: groupId || null },
    });
  }

  async function runBatchAction({ fileIds, action, successPrefix, fallback, removeSuccessful = false, operation, request = null }) {
    if (!isTauriRuntime) {
      showToast("批量操作请在桌面应用中执行");
      return;
    }
    if (indexingRef.current) {
      showToast("递归导入进行中，请先等待扫描完成");
      return;
    }
    const stableIds = [...new Set(fileIds || [])].filter(Boolean);
    if (!stableIds.length || batchBusyRef.current) return;
    const operationId = createOperationId("batch");
    operationReporter?.startOperation({ id: operationId, operation, totalCount: stableIds.length, request });
    activeBatchOperationIdRef.current = operationId;
    setRetryBatch(null);
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await action(stableIds, operationId);
      const successIds = (result.results || []).filter((item) => item.status === "success").map((item) => item.id);
      const retryIds = (result.results || []).filter(isRetryableBatchItem).map((item) => item.id);
      setRetryBatch(retryIds.length ? { operationId, operation, request, fileIds: retryIds, action, successPrefix, fallback, removeSuccessful } : null);
      if (result.changedIds?.length || result.revision > 0) await reloadIndexPreservingState(result.revision);
      if (removeSuccessful) setSelectedIds((current) => current.filter((id) => !successIds.includes(id)));
      const summary = summarizeBatchResult(result);
      const details = [`成功 ${summary.success} 项`];
      if (summary.skipped) details.push(`跳过 ${summary.skipped} 项`);
      if (summary.failed) details.push(`失败 ${summary.failed} 项`);
      operationReporter?.finishOperation(operationId, {
        totalCount: result.results.length || stableIds.length,
        successCount: summary.success,
        skippedCount: summary.skipped,
        failedCount: summary.failed,
        results: result.results,
        retryableIds: retryIds,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
        request,
      });
      showToast(`${successPrefix}：${details.join("，")}`);
    } catch (error) {
      operationReporter?.failOperation(operationId, fallback);
      showActionError(error, fallback);
    } finally {
      activeBatchOperationIdRef.current = "";
      batchBusyRef.current = false;
      setBatchBusy(false);
    }
  }

  async function handleRetryBatch() {
    if (!retryBatch || batchBusyRef.current) return;
    const { fileIds, action, successPrefix, fallback, removeSuccessful, operation, request } = retryBatch;
    await runBatchAction({ fileIds, action, successPrefix, fallback, removeSuccessful, operation, request });
  }

  async function handleRetryOperation(record) {
    if (!record?.retryableIds?.length || batchBusyRef.current) return;
    if (record.operation === "recursive-import") {
      const retry = retryImportRef.current;
      if (!retry || retry.operationId !== record.id) {
        showToast("该导入任务只保留了摘要，请重新选择文件夹");
        return;
      }
      await importFoldersRecursive(retry.paths, retry.policy, retry.operationId);
      return;
    }
    if (retryBatch?.operationId === record.id) {
      await handleRetryBatch();
      return;
    }
    const request = record.request || {};
    if (record.operation === "batch-favorite" && typeof request.favorite === "boolean") {
      await runBatchAction({
        fileIds: record.retryableIds,
        action: (ids, operationId) => batchActions.setFavorite(ids, request.favorite, operationId),
        successPrefix: request.favorite ? "批量收藏完成" : "批量取消收藏完成",
        fallback: "批量更新收藏失败，请重试",
        operation: record.operation,
        request: { favorite: request.favorite },
      });
    } else if (record.operation === "batch-tags" && Array.isArray(request.tags) && typeof request.add === "boolean") {
      await runBatchAction({
        fileIds: record.retryableIds,
        action: (ids, operationId) => batchActions.updateTags(ids, request.tags, request.add, operationId),
        successPrefix: request.add ? "批量添加标签完成" : "批量移除标签完成",
        fallback: "批量更新标签失败，请重试",
        operation: record.operation,
        request: { tags: request.tags, add: request.add },
      });
    } else if (record.operation === "batch-group" && (request.groupId == null || typeof request.groupId === "string")) {
      await runBatchAction({
        fileIds: record.retryableIds,
        action: (ids, operationId) => batchActions.setGroup(ids, request.groupId, operationId),
        successPrefix: request.groupId ? "批量分组完成" : "已解除所选资料的分组归属",
        fallback: "批量更新分组失败，请重试",
        operation: record.operation,
        request: { groupId: request.groupId || null },
      });
    } else if (record.operation === "batch-remove-index") {
      await runBatchAction({
        fileIds: record.retryableIds,
        action: (ids, operationId) => batchActions.removeIndexEntries(ids, operationId),
        successPrefix: "批量移除完成",
        fallback: "批量移除失败，请刷新索引确认状态",
        removeSuccessful: true,
        operation: record.operation,
      });
    } else {
      showToast("该操作缺少可重试参数，请重新执行");
    }
  }

  async function handleCancelBatch() {
    const operationId = activeBatchOperationIdRef.current;
    if (!isTauriRuntime || !operationId) return;
    try {
      await batchActions.cancel(operationId);
      showToast("已请求取消批量操作，正在整理已完成项");
    } catch (error) {
      showActionError(error, "无法取消批量操作，请稍候查看结果");
    }
  }

  async function handleUndo() {
    if (!isTauriRuntime || batchBusyRef.current) return;
    const operationId = createOperationId("undo");
    operationReporter?.startOperation({ id: operationId, operation: "undo" });
    batchBusyRef.current = true;
    setBatchBusy(true);
    try {
      const result = await historyActions.undoLast();
      await reloadIndexPreservingState(result.revision);
      operationReporter?.finishOperation(operationId, {
        status: "success",
        totalCount: result.changedIds.length,
        successCount: result.changedIds.length,
      });
      showToast("已撤销上一项可撤销的索引操作");
      setSelectedIds([]);
    } catch (error) {
      operationReporter?.failOperation(operationId, "撤销不可用，索引可能已经发生变化");
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
    const operationId = createOperationId("group");
    operationReporter?.startOperation({ id: operationId, operation: "group", totalCount: 1 });
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await mutationActions.createGroup(normalized);
      await reloadIndexPreservingState(result.revision);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast(`已创建分组“${normalized}”`);
      return true;
    } catch (error) {
      operationReporter?.failOperation(operationId, "创建分组失败，请重试");
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
    const operationId = createOperationId("group");
    operationReporter?.startOperation({ id: operationId, operation: "group", totalCount: 1 });
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await mutationActions.renameGroup(groupId, normalized);
      await reloadIndexPreservingState(result.revision);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast(`分组已重命名为“${normalized}”`);
      return true;
    } catch (error) {
      operationReporter?.failOperation(operationId, "重命名分组失败，请重试");
      showActionError(error, "重命名分组失败，请重试");
      return false;
    } finally {
      groupBusyRef.current = false;
      setGroupBusy(false);
    }
  }

  async function deleteGroup(groupId) {
    if (!isTauriRuntime || groupBusyRef.current) return false;
    const operationId = createOperationId("group");
    operationReporter?.startOperation({ id: operationId, operation: "group", totalCount: 1 });
    groupBusyRef.current = true;
    setGroupBusy(true);
    try {
      const result = await mutationActions.deleteGroup(groupId);
      await reloadIndexPreservingState(result.revision);
      operationReporter?.finishOperation(operationId, { status: "success", totalCount: 1, successCount: 1 });
      showToast("分组已删除，资料记录和原文件未改变");
      return true;
    } catch (error) {
      operationReporter?.failOperation(operationId, "删除分组失败，请重试");
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
    if (!isTauriRuntime || !paths?.length || indexingRef.current || batchBusyRef.current) return;
    const pathInput = validateDirectPathInput(paths);
    if (!pathInput.valid) {
      showToast(pathInput.message);
      return;
    }
    const acceptedPaths = pathInput.paths;
    const operationId = createOperationId("import");
    operationReporter?.startOperation({ id: operationId, operation: "import", totalCount: acceptedPaths.length });
    indexingRef.current = true;
    setIndexing(true);
    try {
      const result = await importActions.indexPaths(acceptedPaths);
      const snapshot = await importActions.loadIndex();
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
      const acceptedCount = result.indexedCount + result.refreshedCount;
      operationReporter?.finishOperation(operationId, {
        status: acceptedCount || !result.skippedCount ? (result.skippedCount || result.truncated ? "partial-success" : "success") : "failed",
        totalCount: acceptedCount + result.skippedCount,
        addedCount: result.indexedCount,
        updatedCount: result.refreshedCount,
        successCount: acceptedCount,
        skippedCount: result.skippedCount,
        skippedReasons: result.skippedReasons,
        truncated: result.truncated,
      });
      showToast(messages.join("，") || "没有找到可索引的文件");
    } catch (error) {
      operationReporter?.failOperation(operationId, "索引失败，请检查路径和访问权限");
      showActionError(error, "索引失败，请检查路径和访问权限");
    } finally {
      indexingRef.current = false;
      setIndexing(false);
    }
  }

  async function handleCancelImport() {
    const operationId = activeImportOperationIdRef.current;
    if (!isTauriRuntime || !operationId) return;
    try {
      await importActions.cancel(operationId);
      showToast("已请求取消扫描，正在整理已完成项");
    } catch (error) {
      showActionError(error, "无法取消扫描，请稍候查看操作中心");
    }
  }

  function canRetryOperation(record) {
    if (record?.operation !== "recursive-import") return true;
    return Boolean(record.retryableIds?.length && retryImportRef.current?.operationId === record.id);
  }

  function requestFolderImport(paths) {
    if (!paths?.length || indexingRef.current || batchBusyRef.current) return;
    setPendingAction({
      type: "folder-import",
      paths: [...paths],
      folderName: paths.length === 1
        ? getRecursiveImportFolderName(paths[0])
        : `已选择 ${paths.length} 个文件夹`,
    });
  }

  async function importFoldersRecursive(paths, policy, retryOperationId = "") {
    if (!isTauriRuntime || !paths?.length || indexingRef.current || batchBusyRef.current) return;
    const normalizedPolicy = normalizeRecursiveImportPolicy(policy || DEFAULT_RECURSIVE_IMPORT_POLICY);
    const operationId = retryOperationId || createOperationId("recursive-import");
    const policyDescription = describeRecursiveImportPolicy(normalizedPolicy);
    operationReporter?.startOperation({ id: operationId, operation: "recursive-import" });
    activeImportOperationIdRef.current = operationId;
    retryImportRef.current = { operationId, paths: [...paths], policy: normalizedPolicy };
    setRecursiveImportProgress({
      operationId,
      phase: "scanning",
      scannedCount: 0,
      candidateCount: 0,
      acceptedCount: 0,
      skippedCount: 0,
      currentName: null,
      truncated: false,
      cancelled: false,
      timedOut: false,
    });
    indexingRef.current = true;
    setIndexing(true);
    try {
      const result = await importActions.importFoldersRecursive(paths, operationId, normalizedPolicy);
      const snapshot = await importActions.loadIndex();
      applyIndexSnapshot(snapshot);
      setDirectoryView(null);
      setPreviewEntryId(null);
      setActiveNav("library");
      setSelectedId(result.addedIds[0] || snapshot.entries[0]?.id || "");

      const acceptedCount = result.indexedCount + result.refreshedCount;
      const retryable = result.cancelled || result.timedOut || result.truncated || result.skippedCount > 0;
      if (!retryable) retryImportRef.current = null;
      const messages = [`扫描 ${result.scannedCount} 项，发现 ${result.candidateCount} 个普通文件`];
      if (result.indexedCount) messages.push(`新增 ${result.indexedCount} 项`);
      if (result.refreshedCount) messages.push(`更新 ${result.refreshedCount} 项`);
      if (result.skippedCount) messages.push(`跳过 ${result.skippedCount} 项（${result.skippedReasons.join("、") || "原因未提供"}）`);
      if (result.truncated) messages.push("已达到扫描或导入上限");
      if (result.cancelled) messages.push("已取消，已保留完成部分");
      if (result.timedOut) messages.push("扫描超时，已保留完成部分");
      const operationSkippedCount = Math.min(result.skippedCount, Math.max(0, 20_000 - acceptedCount));
      const totalCount = acceptedCount + operationSkippedCount;
      operationReporter?.finishOperation(operationId, {
        status: result.timedOut ? "timed-out" : result.cancelled ? "cancelled" : retryable ? "partial-success" : acceptedCount ? "success" : "failed",
        totalCount,
        addedCount: result.indexedCount,
        updatedCount: result.refreshedCount,
        successCount: acceptedCount,
        skippedCount: operationSkippedCount,
        skippedReasons: result.skippedReasons,
        truncated: result.truncated,
        cancelled: result.cancelled,
        timedOut: result.timedOut,
        retryableIds: retryable ? [operationId] : [],
        message: `策略：${policyDescription}；扫描 ${result.scannedCount} 项，发现 ${result.candidateCount} 个普通文件。`,
      });
      showToast(messages.join("，") || "没有找到可导入的文件");
    } catch (error) {
      retryImportRef.current = null;
      operationReporter?.failOperation(operationId, "递归导入失败，请检查文件夹和访问权限");
      showActionError(error, "递归导入失败，请检查文件夹和访问权限");
    } finally {
      activeImportOperationIdRef.current = "";
      setRecursiveImportProgress(null);
      indexingRef.current = false;
      setIndexing(false);
    }
  }

  async function confirmFolderImport(mode, policy) {
    if (pendingAction?.type !== "folder-import") return;
    const { paths } = pendingAction;
    setPendingAction(null);
    if (mode === "recursive") await importFoldersRecursive(paths, policy);
    else await indexRealPaths(paths);
  }

  function addBrowserFiles(fileList) {
    const additions = createBrowserEntries(fileList);
    if (!additions.length) return;
    const operationId = createOperationId("import");
    operationReporter?.startOperation({ id: operationId, operation: "import", totalCount: additions.length });
    setFiles((current) => [...additions, ...current]);
    setSelectedId(additions[0].id);
    setPreviewEntryId(null);
    setActiveNav("library");
    operationReporter?.finishOperation(operationId, {
      status: "success",
      totalCount: additions.length,
      addedCount: additions.length,
      successCount: additions.length,
    });
    showToast(`已登记 ${additions.length} 项`);
  }

  async function choosePaths(mode) {
    if (indexingRef.current || batchBusyRef.current) {
      showToast("已有导入或批量操作进行中，请先等待完成");
      return;
    }
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
      else if (mode === "folder") requestFolderImport(paths);
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
      const result = await fileActions.reposition(fileId, newPath);
      if (result.entry) setFiles((current) => current.map((item) => item.id === fileId ? result.entry : item));
      setDirectoryError?.(null);
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
    setDirectoryError?.(null);
    setSelectedId(targetId);
    showToast("路径已更新");
  }

  async function openFromFloating(payload) {
    const fileId = payload?.fileId;
    if (!fileId || !isTauriRuntime) return;
    let action;
    try {
      action = floatingHandoff.normalizeAction(payload?.action);
    } catch {
      showToast("悬浮球打开动作无效，请重试");
      return;
    }
    const requestId = ++floatingOpenRequestRef.current;
    try {
      const snapshot = await floatingHandoff.loadIndex();
      if (requestId !== floatingOpenRequestRef.current) return;
      const target = snapshot.entries.find((file) => file.id === fileId);
      applyIndexSnapshot(snapshot);
      if (!target) {
        resetToLibrary?.();
        showToast("资料已从索引中移除");
      }
      else if (target.invalid) {
        focusEntry?.(fileId);
        showToast("该资料路径已失效，请重新定位");
      } else if (target.kind === "folder") {
        focusEntry?.(fileId, { scroll: false });
        showToast("已打开资料库中的文件夹记录");
        await openDirectory(target, [target]);
      } else {
        focusEntry?.(fileId, { preview: action === "preview" });
        if (action === "preview") setPreviewEntryId(fileId);
        else showToast("已在资料库中定位该资料");
      }
    } catch (error) {
      if (requestId !== floatingOpenRequestRef.current) return;
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
    confirmTags,
    confirmGroup,
    confirmBatchRemove,
    confirmFolderImport,
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
    handleCancelImport,
    handleCopyLocation,
    handleRetryBatch,
    retryOperation: handleRetryOperation,
    canRetryOperation,
    recursiveImportProgress,
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
    requestEditTags,
    requestSetGroup,
    groupDraft,
    setGroupDraft,
    tagDraft,
    tagInput,
    setTagInput,
    addTag,
    removeTag,
    setRenameName,
    createGroup,
    deleteGroup,
    groupBusy,
    renameGroup,
    retryBatch,
  };
}

function safeParse(parser, value, command) {
  try {
    return parser(value, command);
  } catch {
    return null;
  }
}

function validateGroupName(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized || normalized.length > 64 || /[\u0000-\u001f\u007f-\u009f]/.test(normalized)) return "";
  return normalized;
}

function isRetryableBatchItem(item) {
  return item?.status === "failed"
    || (item?.status === "skipped" && (item.reason === "用户已取消" || item.reason === "批量操作超时"));
}
