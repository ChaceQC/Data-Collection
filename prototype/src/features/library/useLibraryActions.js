import { useEffect, useMemo, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getOperationError } from "../../lib/ipcContracts.js";
import { getFileKind, getFileType } from "../../lib/fileTypes.js";
import { libraryRepository } from "./libraryRepository.js";
import { createBrowserEntries, getNextSelection, validateRename } from "./libraryControllerModel.js";

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
  setIndexing,
  showToast,
}) {
  const [busyFileId, setBusyFileId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [renameName, setRenameName] = useState("");
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const repositionInputRef = useRef(null);
  const repositionTargetIdRef = useRef(null);
  const busyFileIdRef = useRef("");
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
    if (!busyFileIdRef.current) setPendingAction(null);
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

  async function handleReveal(file) {
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
    indexRealPaths,
    openFromFloating,
    openRepositionPicker,
    pendingAction,
    repositionInputRef,
    repositionInvalidPath,
    renameName,
    renameValidation,
    requestDelete,
    requestRemove,
    requestRename,
    setRenameName,
  };
}
