import { useState } from "react";
import { libraryRepository } from "./libraryRepository.js";
import { getRecentEntries, getRecentOpenedEntries } from "./libraryModel.js";

export function useLibraryNavigation({ filesRef, initialSelectedId = "", showToast, clearSelection }) {
  const [activeNav, setActiveNav] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedId, setSelectedId] = useState(initialSelectedId);
  const [directoryView, setDirectoryView] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [previewEntryId, setPreviewEntryId] = useState(null);

  async function openDirectory(folder, trail) {
    const directoryId = folder.directoryId || folder.id;
    const relativePath = Array.isArray(folder.relativePath) ? folder.relativePath : [];
    if (!directoryId || folder.invalid || directoryLoading) return;
    clearSelection?.();
    setPreviewEntryId(null);
    setDirectoryLoading(true);
    try {
      const entries = await libraryRepository.listDirectory(directoryId, relativePath);
      setDirectoryView({ entries, trail });
      setSelectedId(entries[0]?.id || folder.id);
    } catch {
      showToast("无法读取文件夹内容，请检查路径和访问权限");
    } finally {
      setDirectoryLoading(false);
    }
  }

  function openFolder(folder) {
    if (folder.invalid) {
      showToast("文件夹路径已失效，请先重新定位");
      return;
    }
    const trail = [...(directoryView?.trail || []), folder];
    void openDirectory(folder, trail);
  }

  function openBreadcrumb(index) {
    if (!directoryView) return;
    if (index < 0) {
      clearSelection?.();
      setDirectoryView(null);
      setPreviewEntryId(null);
      setSelectedId(filesRef.current[0]?.id || "");
      return;
    }
    const trail = directoryView.trail.slice(0, index + 1);
    void openDirectory(trail[index], trail);
  }

  function selectNav(key) {
    if (key !== activeNav || directoryView) clearSelection?.();
    setDirectoryView(null);
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
    directoryView,
    handleRowClick,
    handleRowKeyDown,
    openBreadcrumb,
    openDirectory,
    openFolder,
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
