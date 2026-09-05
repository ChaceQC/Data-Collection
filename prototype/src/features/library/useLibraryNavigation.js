import { useCallback, useEffect, useRef, useState } from "react";
import { libraryRepository } from "./libraryRepository.js";
import { getRecentEntries, getRecentOpenedEntries } from "./libraryModel.js";

export function useLibraryNavigation({ filesRef, initialSelectedId = "", showToast, clearSelection }) {
  const [activeNav, setActiveNav] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [directoryView, updateDirectoryView] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(null);
  const [previewEntryId, setPreviewEntryId] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const directoryLoadingRef = useRef(false);
  const directoryRequestRef = useRef(0);
  const focusRequestRef = useRef(0);
  const directoryViewRef = useRef(null);

  const invalidateDirectoryRequest = useCallback(() => {
    directoryRequestRef.current += 1;
    directoryLoadingRef.current = false;
    setDirectoryLoading(false);
  }, []);
  const setDirectoryView = useCallback((value) => {
    invalidateDirectoryRequest();
    const next = typeof value === "function" ? value(directoryViewRef.current) : value;
    directoryViewRef.current = next;
    updateDirectoryView(next);
  }, [invalidateDirectoryRequest]);
  useEffect(() => () => { directoryRequestRef.current += 1; }, []);

  async function openDirectory(folder, trail) {
    const directoryId = folder.directoryId || folder.id;
    const relativePath = Array.isArray(folder.relativePath) ? folder.relativePath : [];
    if (!directoryId || folder.invalid) return false;
    const contextKey = JSON.stringify([directoryId, relativePath]);
    const requestId = ++directoryRequestRef.current;
    clearSelection?.();
    setPreviewEntryId(null);
    setDirectoryError(null);
    directoryLoadingRef.current = true;
    setDirectoryLoading(true);
    try {
      const entries = await libraryRepository.listDirectory(directoryId, relativePath);
      if (requestId !== directoryRequestRef.current) return false;
      const view = { entries, trail, contextKey };
      directoryViewRef.current = view;
      updateDirectoryView(view);
      setSelectedId(entries[0]?.id || folder.id);
      return true;
    } catch {
      if (requestId !== directoryRequestRef.current) return false;
      directoryViewRef.current = null;
      updateDirectoryView(null);
      setDirectoryError({
        message: "无法读取文件夹内容，请检查路径和访问权限。",
        folder,
        trail,
      });
      showToast("无法读取文件夹内容，请检查路径和访问权限");
      return false;
    } finally {
      if (requestId === directoryRequestRef.current) {
        directoryLoadingRef.current = false;
        setDirectoryLoading(false);
      }
    }
  }

  const refreshDirectory = useCallback(async (snapshot, signal) => {
    const view = directoryViewRef.current;
    if (!view) return;
    const root = view.trail[0];
    const registeredRoot = snapshot.entries.find((entry) => entry.id === (root.directoryId || root.id));
    if (!registeredRoot || registeredRoot.invalid || (root.path && root.path !== registeredRoot.path)) {
      setDirectoryView(null);
      setPreviewEntryId(null);
      setDirectoryError(null);
      return;
    }
    // 导航中的请求拥有视图，不让索引事件抢占正在打开的新目录。
    if (directoryLoadingRef.current) return;
    const requestId = ++directoryRequestRef.current;
    const folder = view.trail.at(-1);
    try {
      const entries = await libraryRepository.listDirectory(folder.directoryId || folder.id, folder.relativePath || []);
      if (signal?.aborted || requestId !== directoryRequestRef.current || directoryViewRef.current !== view) return;
      const next = { ...view, entries };
      directoryViewRef.current = next;
      updateDirectoryView(next);
      setSelectedId((id) => entries.some((entry) => entry.id === id) ? id : entries[0]?.id || folder.id);
      setPreviewEntryId((id) => entries.some((entry) => entry.id === id && !entry.invalid) ? id : null);
      setDirectoryError(null);
    } catch (error) {
      if (signal?.aborted || requestId !== directoryRequestRef.current || directoryViewRef.current !== view) return;
      if (["directory-missing", "directory-invalid"].includes(error?.code)) {
        setDirectoryView(null);
        setPreviewEntryId(null);
        setDirectoryError({ message: "目录已失效，请重新选择或定位。", folder, trail: view.trail, retryable: false });
      }
      // 暂时读取失败保留已有目录与预览，刷新错误由同步调用方反馈。
      throw error;
    }
  }, [setDirectoryView]);

  function openFolder(folder) {
    setSelectedId(folder?.id || "");
    if (folder.invalid) {
      showToast("文件夹路径已失效，请先重新定位");
      setDirectoryView(null);
      setDirectoryError({
        message: "该文件夹路径已失效，请先重新定位。",
        folder,
        trail: [...(directoryView?.trail || []), folder],
        retryable: false,
      });
      return false;
    }
    const trail = [...(directoryView?.trail || []), folder];
    void openDirectory(folder, trail);
    return true;
  }

  function openBreadcrumb(index) {
    if (index < 0) {
      directoryRequestRef.current += 1;
      directoryLoadingRef.current = false;
      setDirectoryLoading(false);
      clearSelection?.();
      setDirectoryView(null);
      setDirectoryError(null);
      setPreviewEntryId(null);
      setSelectedId(filesRef.current[0]?.id || "");
      return;
    }
    if (!directoryView) return;
    const trail = directoryView.trail.slice(0, index + 1);
    void openDirectory(trail[index], trail);
  }

  function selectNav(key) {
    if (key !== activeNav || directoryView) clearSelection?.();
    setDirectoryView(null);
    setDirectoryError(null);
    setPreviewEntryId(null);
    setActiveNav(key);
    const files = filesRef.current;
    const firstMatch = key === "recent"
      ? getRecentEntries(files)[0]
      : key === "recent-opened"
        ? getRecentOpenedEntries(files)[0]
      : files.find((file) => matchesNavigation(file, key));
    if (firstMatch) setSelectedId(firstMatch.id);
  }

  function focusEntry(fileId, { scroll = true, preview = false } = {}) {
    if (!fileId) return;
    clearSelection?.();
    setActiveNav("library");
    setSearchQuery("");
    setDirectoryView(null);
    setDirectoryError(null);
    setPreviewEntryId(null);
    setSelectedId(fileId);
    setFocusRequest({
      fileId,
      requestId: ++focusRequestRef.current,
      scroll,
      preview,
      resetFilters: true,
    });
  }

  function clearFocusRequest(requestId) {
    setFocusRequest((current) => current?.requestId === requestId ? null : current);
  }

  function resetToLibrary() {
    directoryRequestRef.current += 1;
    directoryLoadingRef.current = false;
    clearSelection?.();
    setActiveNav("library");
    setSearchQuery("");
    setDirectoryLoading(false);
    setDirectoryView(null);
    setDirectoryError(null);
    setFocusRequest(null);
    setPreviewEntryId(null);
    setSelectedId(filesRef.current[0]?.id || "");
  }

  function retryDirectory() {
    if (!directoryError?.folder || directoryError.retryable === false) return;
    void openDirectory(directoryError.folder, directoryError.trail || [directoryError.folder]);
  }

  function handleRowClick(file) {
    if (file.kind === "folder") {
      setPreviewEntryId(null);
      openFolder(file);
      return;
    }
    if (file.invalid) {
      setPreviewEntryId(null);
      showToast("文件路径已失效，请先重新定位");
      return;
    }
    setSelectedId(file.id);
    setPreviewEntryId(file.id);
  }

  function handleRowKeyDown(event, file) {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      handleRowClick(file);
    }
  }

  return {
    activeNav,
    directoryLoading,
    directoryError,
    directoryView,
    focusEntry,
    focusRequest,
    clearFocusRequest,
    handleRowClick,
    handleRowKeyDown,
    openBreadcrumb,
    openDirectory,
    openFolder,
    resetToLibrary,
    refreshDirectory,
    invalidateDirectoryRequest,
    retryDirectory,
    previewEntryId,
    searchQuery,
    selectNav,
    selectedId,
    setActiveNav,
    setDirectoryView,
    setDirectoryError,
    setDirectoryLoading,
    setPreviewEntryId,
    setSearchQuery,
    setSelectedId,
  };
}

function matchesNavigation(entry, activeNav) {
  if (activeNav === "favorites") return Boolean(entry.favorite);
  if (activeNav === "invalid") return Boolean(entry.invalid);
  if (activeNav === "recent") return !entry.invalid && Number.isFinite(entry.addedAt);
  if (activeNav === "recent-opened") return !entry.invalid && Number.isFinite(entry.lastOpenedAt) && entry.lastOpenedAt > 0;
  return true;
}
