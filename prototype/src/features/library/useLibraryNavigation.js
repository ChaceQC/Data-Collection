import { useRef, useState } from "react";
import { libraryRepository } from "./libraryRepository.js";
import { getRecentEntries, getRecentOpenedEntries } from "./libraryModel.js";

export function useLibraryNavigation({ filesRef, initialSelectedId = "", showToast, clearSelection }) {
  const [activeNav, setActiveNav] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [directoryView, setDirectoryView] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [directoryError, setDirectoryError] = useState(null);
  const [previewEntryId, setPreviewEntryId] = useState(null);
  const [focusRequest, setFocusRequest] = useState(null);
  const directoryLoadingRef = useRef(false);
  const directoryRequestRef = useRef(0);
  const focusRequestRef = useRef(0);

  async function openDirectory(folder, trail) {
    const directoryId = folder.directoryId || folder.id;
    const relativePath = Array.isArray(folder.relativePath) ? folder.relativePath : [];
    if (!directoryId || folder.invalid || directoryLoadingRef.current) return false;
    const requestId = ++directoryRequestRef.current;
    clearSelection?.();
    setPreviewEntryId(null);
    setDirectoryError(null);
    directoryLoadingRef.current = true;
    setDirectoryLoading(true);
    try {
      const entries = await libraryRepository.listDirectory(directoryId, relativePath);
      if (requestId !== directoryRequestRef.current) return false;
      setDirectoryView({ entries, trail });
      setSelectedId(entries[0]?.id || folder.id);
      return true;
    } catch {
      if (requestId !== directoryRequestRef.current) return false;
      setDirectoryView(null);
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

  function focusEntry(fileId, { scroll = true } = {}) {
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
      resetFilters: true,
    });
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
    handleRowClick,
    handleRowKeyDown,
    openBreadcrumb,
    openDirectory,
    openFolder,
    resetToLibrary,
    retryDirectory,
    previewEntryId,
    searchQuery,
    selectNav,
    selectedId,
    setActiveNav,
    setDirectoryView,
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
