import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { open } from "@tauri-apps/plugin-dialog";
import { PreviewPane } from "./features/preview/PreviewPane";
import { DeleteOriginalDialog, RenameDialog, RemoveIndexDialog } from "./features/library/LibraryActions";
import { LibraryPanel } from "./features/library/LibraryPanel";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { loadSettings, updateSettings } from "./features/settings/settingsApi";
import { DEFAULT_SETTINGS } from "./features/settings/settingsModel";
import {
  DEFAULT_SORT,
  getExtension,
  getFileKind,
  getFileType,
  getNavigationCount,
  matchesNavigation,
} from "./features/library/libraryModel";
import {
  copyIndexedFile,
  deleteOriginalFile,
  openIndexedFile,
  revealIndexedFile,
  removeIndexEntry,
  renameIndexedFile,
  setFavorite,
} from "./features/library/libraryApi";
import {
  CheckCircle,
  Clock,
  FolderOpen,
  FolderSimple,
  GearSix,
  Minus,
  Square,
  Star,
  UploadSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

const INITIAL_FILES = [
  {
    id: "research-plan",
    name: "研究计划.md",
    type: "Markdown",
    kind: "markdown",
    status: "已登记",
    modified: "2026-08-28 10:24",
    modifiedAt: 1787883840,
    addedAt: 1787883840,
    size: 2048,
    favorite: true,
  },
  {
    id: "interview-notes",
    name: "访谈记录.docx",
    type: "Word 文档",
    kind: "docx",
    status: "已登记",
    modified: "2026-08-28 09:41",
    modifiedAt: 1787881260,
    addedAt: 1787881260,
    size: 8192,
    favorite: false,
  },
  {
    id: "data-summary",
    name: "数据汇总.xlsx",
    type: "Excel 工作簿",
    kind: "xlsx",
    status: "已登记",
    modified: "2026-08-28 09:15",
    modifiedAt: 1787879700,
    addedAt: 1787879700,
    size: 16384,
    favorite: true,
  },
  {
    id: "old-project",
    name: "旧项目资料（备份）",
    type: "文件夹",
    kind: "folder",
    status: "路径失效",
    modified: "2026-08-27 16:32",
    modifiedAt: 1787819520,
    addedAt: 1787819520,
    size: 0,
    favorite: false,
    invalid: true,
  },
];

const NAV_ITEMS = [
  { key: "library", label: "资料库", icon: FolderSimple },
  { key: "recent", label: "最近添加", icon: Clock },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "invalid", label: "失效路径", icon: WarningCircle },
];

const IS_TAURI_RUNTIME = isTauri();

function getOperationError(error, fallback) {
  return typeof error === "string" && error.length > 0 && error.length <= 180 ? error : fallback;
}

function App() {
  const [files, setFiles] = useState(IS_TAURI_RUNTIME ? [] : INITIAL_FILES);
  const [activeNav, setActiveNav] = useState("library");
  const [searchQuery, setSearchQuery] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [selectedId, setSelectedId] = useState(IS_TAURI_RUNTIME ? "" : "research-plan");
  const [toast, setToast] = useState("");
  const [indexing, setIndexing] = useState(false);
  const [indexReady, setIndexReady] = useState(!IS_TAURI_RUNTIME);
  const [directoryView, setDirectoryView] = useState(null);
  const [previewEntryId, setPreviewEntryId] = useState(null);
  const [directoryLoading, setDirectoryLoading] = useState(false);
  const [sort, setSort] = useState(DEFAULT_SORT);
  const [pageSize, setPageSize] = useState(DEFAULT_SETTINGS.pageSize);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(IS_TAURI_RUNTIME);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [busyFileId, setBusyFileId] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [renameName, setRenameName] = useState("");
  const folderInputRef = useRef(null);
  const fileInputRef = useRef(null);
  const repositionInputRef = useRef(null);
  const repositionTargetIdRef = useRef(null);
  const indexingRef = useRef(false);
  const busyFileIdRef = useRef("");

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    if (!IS_TAURI_RUNTIME) return undefined;
    let cancelled = false;
    invoke("load_file_index")
      .then((loadedFiles) => {
        if (cancelled) return;
        setFiles(loadedFiles);
        setSelectedId(loadedFiles[0]?.id || "");
        setPreviewEntryId(null);
        setIndexReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        setIndexReady(true);
        showToast("无法读取本地资料索引，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    loadSettings()
      .then((loadedSettings) => {
        if (cancelled) return;
        setSettings(loadedSettings);
        setSort(loadedSettings.defaultSort);
        setPageSize(loadedSettings.pageSize);
      })
      .catch(() => {
        if (!cancelled) showToast("无法读取本地设置，已使用默认设置");
      })
      .finally(() => {
        if (!cancelled) setSettingsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!IS_TAURI_RUNTIME) return undefined;
    let disposed = false;
    let unlisten;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "over") setDragActive(true);
        if (event.payload.type === "leave") setDragActive(false);
        if (event.payload.type === "drop") {
          setDragActive(false);
          indexRealPaths(event.payload.paths);
        }
      })
      .then((stopListening) => {
        if (disposed) {
          stopListening();
        } else {
          unlisten = stopListening;
        }
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, []);

  function showToast(message) {
    setToast(message);
  }

  function selectNav(key) {
    setDirectoryView(null);
    setPreviewEntryId(null);
    setActiveNav(key);
    const firstMatch = files.find((file) => matchesNavigation(file, key));
    if (firstMatch) setSelectedId(firstMatch.id);
  }

  function addFiles(fileList) {
    const pickedFiles = Array.from(fileList || {}).slice(0, 8);
    if (!pickedFiles.length) return;

    const timestamp = Date.now();
    const additions = pickedFiles.map((file, index) => {
      const kind = getFileKind(file.name || "新资料.txt");
      return {
        id: `imported-${timestamp}-${index}`,
        name: file.name || "未命名资料",
        type: getFileType(file.name || "新资料.txt", kind),
        kind,
        status: "已登记",
        modified: "刚刚",
        modifiedAt: Math.floor(timestamp / 1000),
        addedAt: Math.floor(timestamp / 1000),
        size: file.size,
        favorite: false,
      };
    });

    setFiles((currentFiles) => [...additions, ...currentFiles]);
    setSelectedId(additions[0].id);
    setPreviewEntryId(null);
    setActiveNav("library");
    showToast(`已登记 ${additions.length} 项`);
  }

  async function handleFavorite(file) {
    if (busyFileIdRef.current) return;
    const favorite = !file.favorite;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      if (IS_TAURI_RUNTIME) {
        setFiles(await setFavorite(file.id, favorite));
      } else {
        setFiles((currentFiles) => currentFiles.map((item) => item.id === file.id ? { ...item, favorite } : item));
      }
      setSelectedId(file.id);
      showToast(favorite ? "已加入收藏" : "已取消收藏");
    } catch (error) {
      showToast(getOperationError(error, "收藏状态更新失败，请重试"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  function requestRemove(file) {
    if (settings.confirmBeforeRemove) {
      setPendingAction({ type: "remove", file });
    } else {
      void removeIndexRecord(file);
    }
  }

  function requestRename(file) {
    setRenameName(file.name);
    setPendingAction({ type: "rename", file });
  }

  function requestDelete(file) {
    if (!IS_TAURI_RUNTIME) {
      showToast("删除原文件请在桌面应用中执行");
      return;
    }
    setPendingAction({ type: "delete", file });
  }

  function closePendingAction() {
    if (!busyFileIdRef.current) setPendingAction(null);
  }

  async function releasePreviewForAction(fileId) {
    if (previewEntryId !== fileId) return;
    setPreviewEntryId(null);
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  }

  async function removeIndexRecord(file) {
    if (!file || busyFileIdRef.current) return;
    const fileId = file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      const updatedFiles = IS_TAURI_RUNTIME ? await removeIndexEntry(fileId) : files.filter((item) => item.id !== fileId);
      setFiles(updatedFiles);
      setDirectoryView(null);
      setSelectedId((currentId) => currentId === fileId ? updatedFiles[0]?.id || "" : currentId);
      setPendingAction(null);
      showToast("已从资料库移除，原文件未改变");
    } catch (error) {
      showToast(getOperationError(error, "移除记录失败，原文件未改变"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function confirmRemove() {
    if (pendingAction?.type !== "remove" || busyFileIdRef.current) return;
    await removeIndexRecord(pendingAction.file);
  }

  async function confirmRename() {
    if (pendingAction?.type !== "rename" || busyFileIdRef.current) return;
    const file = pendingAction.file;
    const newName = renameName;
    if (!newName.trim() || getExtension(file.name) !== getExtension(newName)) {
      showToast("文件名不能为空，且扩展名必须保持不变");
      return;
    }
    const fileId = file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      if (IS_TAURI_RUNTIME) {
        setFiles(await renameIndexedFile(fileId, newName));
      } else {
        setFiles((currentFiles) => currentFiles.map((item) => {
          if (item.id !== fileId) return item;
          const kind = getFileKind(newName);
          return { ...item, name: newName, kind, type: getFileType(newName, kind) };
        }));
      }
      setSelectedId(fileId);
      setPendingAction(null);
      showToast("文件已重命名");
    } catch (error) {
      showToast(getOperationError(error, "重命名失败，原文件未改变"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function handleCopy(file) {
    if (!IS_TAURI_RUNTIME) {
      showToast("复制到剪贴板请在桌面应用中执行");
      return;
    }
    if (busyFileIdRef.current) return;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      const result = await copyIndexedFile(file.id);
      setSelectedId(file.id);
      showToast(`已复制到系统剪贴板：${result.name}，可在目标文件夹粘贴`);
    } catch (error) {
      showToast(getOperationError(error, "复制失败，原文件未改变"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function handleOpenDefault(file) {
    if (!IS_TAURI_RUNTIME) {
      showToast("用默认程序打开请在桌面应用中执行");
      return;
    }
    if (busyFileIdRef.current) return;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      const result = await openIndexedFile(file.id);
      setSelectedId(file.id);
      showToast(`已请求系统默认程序打开：${result.name}`);
    } catch (error) {
      showToast(getOperationError(error, "无法用默认程序打开，请检查文件关联"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function handleReveal(file) {
    if (!IS_TAURI_RUNTIME) {
      showToast("在资源管理器中定位请在桌面应用中执行");
      return;
    }
    if (busyFileIdRef.current) return;
    busyFileIdRef.current = file.id;
    setBusyFileId(file.id);
    try {
      const result = await revealIndexedFile(file.id);
      setSelectedId(file.id);
      showToast(`已在资源管理器中定位：${result.name}`);
    } catch (error) {
      showToast(getOperationError(error, "无法在资源管理器中定位，请检查路径"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function handleSettingsSave(nextSettings) {
    if (settingsSaving) return;
    setSettingsSaving(true);
    try {
      const savedSettings = await updateSettings(nextSettings);
      setSettings(savedSettings);
      setSort(savedSettings.defaultSort);
      setPageSize(savedSettings.pageSize);
      setSettingsOpen(false);
      showToast(IS_TAURI_RUNTIME ? "设置已保存" : "设置已应用，仅在当前浏览器会话有效");
    } catch (error) {
      showToast(getOperationError(error, "设置保存失败，请重试"));
    } finally {
      setSettingsSaving(false);
    }
  }

  async function confirmDelete() {
    if (pendingAction?.type !== "delete" || busyFileIdRef.current) return;
    if (!IS_TAURI_RUNTIME) {
      setPendingAction(null);
      showToast("删除原文件请在桌面应用中执行");
      return;
    }
    const fileId = pendingAction.file.id;
    busyFileIdRef.current = fileId;
    setBusyFileId(fileId);
    await releasePreviewForAction(fileId);
    try {
      const updatedFiles = await deleteOriginalFile(fileId);
      setFiles(updatedFiles);
      setSelectedId((currentId) => currentId === fileId ? updatedFiles[0]?.id || "" : currentId);
      setPendingAction(null);
      showToast("原文件已移入回收站");
    } catch (error) {
      showToast(getOperationError(error, "删除原文件失败，索引和原文件状态未确认"));
    } finally {
      busyFileIdRef.current = "";
      setBusyFileId("");
    }
  }

  async function indexRealPaths(paths) {
    if (!IS_TAURI_RUNTIME || !paths?.length || indexingRef.current) return;
    indexingRef.current = true;
    setIndexing(true);
    try {
      const result = await invoke("index_paths", { paths });
      setFiles(result.entries);
      setDirectoryView(null);
      setPreviewEntryId(null);
      setActiveNav("library");
      setSelectedId(result.addedIds[0] || result.entries[0]?.id || "");
      const messages = [];
      if (result.indexedCount) messages.push(`已索引 ${result.indexedCount} 项`);
      if (result.refreshedCount) messages.push(`更新 ${result.refreshedCount} 项`);
      if (result.skippedCount) messages.push(`跳过 ${result.skippedCount} 项`);
      if (result.truncated) messages.push("已达到本次索引上限");
      showToast(messages.join("，") || "没有找到可索引的文件");
    } catch {
      showToast("索引失败，请检查路径和访问权限");
    } finally {
      indexingRef.current = false;
      setIndexing(false);
    }
  }

  async function choosePaths(mode, directory = false) {
    if (!IS_TAURI_RUNTIME) {
      if (mode === "folder") folderInputRef.current?.click();
      if (mode === "file") fileInputRef.current?.click();
      return;
    }

    try {
      const selected = await open({
        directory: mode === "folder" || directory,
        multiple: mode !== "reposition",
        title: mode === "folder" ? "选择资料文件夹" : "选择资料文件",
      });
      const paths = selected ? (Array.isArray(selected) ? selected : [selected]) : [];
      if (!paths.length) return;
      if (mode === "reposition") {
        await repositionRealPath(paths[0]);
      } else {
        await indexRealPaths(paths);
      }
    } catch {
      showToast("无法打开文件选择器，请重试");
    }
  }

  function handleDrop(event) {
    event.preventDefault();
    setDragActive(false);
    if (IS_TAURI_RUNTIME) return;
    addFiles(event.dataTransfer.files);
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
      const updatedFiles = await invoke("reposition_file", { fileId, newPath });
      setFiles(updatedFiles);
      setSelectedId(fileId);
      showToast("路径已更新");
    } catch {
      showToast("重新定位失败，请选择可访问的文件");
    }
  }

  function openRepositionPicker(file) {
    repositionTargetIdRef.current = file.id;
    if (IS_TAURI_RUNTIME) {
      void choosePaths("reposition", file.kind === "folder");
    } else {
      repositionInputRef.current?.click();
    }
  }

  function repositionInvalidPath(fileList) {
    const pickedFile = Array.from(fileList || {})[0];
    const targetId = repositionTargetIdRef.current;
    if (!pickedFile) return;

    setFiles((currentFiles) =>
      currentFiles.map((file) =>
        file.id === targetId
          ? {
              ...file,
              name: pickedFile.name,
              kind: getFileKind(pickedFile.name),
              type: getFileType(pickedFile.name, getFileKind(pickedFile.name)),
              status: "已登记",
              invalid: false,
              modified: "刚刚",
            }
          : file,
      ),
    );
    setSelectedId(targetId);
    showToast("路径已更新");
  }

  async function handleWindowAction(action) {
    if (!IS_TAURI_RUNTIME) {
      showToast("窗口控制仅在桌面应用中可用");
      return;
    }
    try {
      const currentWindow = getCurrentWindow();
      if (action === "minimize") await currentWindow.minimize();
      if (action === "maximize") await currentWindow.toggleMaximize();
      if (action === "close") await currentWindow.close();
    } catch {
      showToast("窗口操作失败，请重试");
    }
  }

  async function openDirectory(folder, trail) {
    if (!folder.path || folder.invalid || directoryLoading) return;
    setPreviewEntryId(null);
    setDirectoryLoading(true);
    try {
      const entries = await invoke("list_directory", { path: folder.path });
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
      setDirectoryView(null);
      setPreviewEntryId(null);
      setSelectedId(files[0]?.id || "");
      return;
    }
    const trail = directoryView.trail.slice(0, index + 1);
    void openDirectory(trail[index], trail);
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

  return (
    <div className="app-shell">
      <div className="window-controls" aria-label="窗口控制">
        <button type="button" aria-label="最小化" title="最小化" onClick={() => void handleWindowAction("minimize")}>
          <Minus size={14} weight="regular" />
        </button>
        <button type="button" aria-label="最大化" title="最大化" onClick={() => void handleWindowAction("maximize")}>
          <Square size={13} weight="regular" />
        </button>
        <button type="button" aria-label="关闭" title="关闭" className="window-close" onClick={() => void handleWindowAction("close")}>
          <X size={16} weight="regular" />
        </button>
      </div>

      <aside className="sidebar" aria-label="主导航">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              <FolderOpen size={22} weight="regular" />
            </span>
            <span>本地资料工作台</span>
          </div>

          <nav className="primary-nav">
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
              <button
                type="button"
                key={key}
                className={`nav-item ${activeNav === key ? "is-active" : ""}`}
                onClick={() => selectNav(key)}
                >
                <Icon size={23} weight={activeNav === key ? "fill" : "regular"} />
                <span>{label}</span>
                <span className="nav-count">{getNavigationCount(files, key)}</span>
                </button>
              ))}
            <button
              type="button"
              className="nav-item settings-nav-item"
              aria-busy={settingsLoading}
              onClick={() => {
                if (settingsLoading) {
                  showToast("正在读取设置，请稍候");
                  return;
                }
                setSettingsOpen(true);
              }}
            >
              <GearSix size={23} weight="regular" />
              <span>设置</span>
            </button>
          </nav>
        </div>

        <div className="sidebar-bottom">
          <button type="button" className="nav-item" onClick={() => void choosePaths("folder")}>
            <FolderOpen size={23} weight="regular" />
            <span>打开本地文件夹</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header" data-tauri-drag-region="true">
          <h1>把资料放进一个可检索的本地库</h1>
        </header>

        <section
          className={`drop-zone ${dragActive ? "is-dragging" : ""}`}
          data-testid="drop-zone"
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
        >
          <div className="drop-zone-icon" aria-hidden="true">
            <FolderOpen size={42} weight="regular" />
          </div>
          <h2>
            {indexing ? "正在建立本地索引..." : dragActive ? "松开鼠标即可登记资料" : "将文件或文件夹拖到这里"}
          </h2>
          <div className="drop-actions">
            <button
              type="button"
              className="button button-primary"
              data-testid="import-folder"
              onClick={() => void choosePaths("folder")}
              disabled={indexing}
            >
              <FolderOpen size={19} weight="regular" />
              <span>导入文件夹</span>
            </button>
            <button
              type="button"
              className="button button-secondary"
              data-testid="choose-file"
              onClick={() => void choosePaths("file")}
              disabled={indexing}
            >
              <UploadSimple size={19} weight="regular" />
              <span>选择文件</span>
            </button>
          </div>
        </section>

        <LibraryPanel
          files={files}
          activeNav={activeNav}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          sort={sort}
          onSortChange={setSort}
          pageSize={pageSize}
          selectedId={selectedId}
          onSelectionChange={setSelectedId}
          directoryView={directoryView}
          directoryLoading={directoryLoading}
          indexReady={indexReady}
          busyFileId={busyFileId}
          onRowClick={handleRowClick}
          onRowKeyDown={handleRowKeyDown}
          onOpenBreadcrumb={openBreadcrumb}
          onReposition={openRepositionPicker}
          onFavorite={handleFavorite}
          onRemove={requestRemove}
          onCopy={handleCopy}
          onRename={requestRename}
          onDelete={requestDelete}
          onOpenDefault={handleOpenDefault}
          onReveal={handleReveal}
        />

      </main>

      {previewEntryId &&
        (() => {
          const currentEntries = directoryView?.entries || files;
          const previewEntry = currentEntries.find((file) => file.id === previewEntryId);
         return previewEntry ? <PreviewPane entry={previewEntry} onClose={() => setPreviewEntryId(null)} /> : null;
         })()}

      {settingsOpen && (
        <SettingsPanel
          settings={settings}
          saving={settingsSaving}
          onCancel={() => setSettingsOpen(false)}
          onSave={handleSettingsSave}
        />
      )}

      {pendingAction?.type === "remove" && (
        <RemoveIndexDialog
          file={pendingAction.file}
          busy={busyFileId === pendingAction.file.id}
          onCancel={closePendingAction}
          onConfirm={() => void confirmRemove()}
        />
      )}
      {pendingAction?.type === "rename" && (
        <RenameDialog
          file={pendingAction.file}
          value={renameName}
          busy={busyFileId === pendingAction.file.id}
          onChange={setRenameName}
          onCancel={closePendingAction}
          onConfirm={() => void confirmRename()}
        />
      )}
      {pendingAction?.type === "delete" && (
        <DeleteOriginalDialog
          file={pendingAction.file}
          busy={busyFileId === pendingAction.file.id}
          onCancel={closePendingAction}
          onConfirm={() => void confirmDelete()}
        />
      )}

      <input
        ref={folderInputRef}
        className="hidden-input"
        type="file"
        multiple
        webkitdirectory="true"
        directory="true"
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        multiple
        onChange={(event) => {
          addFiles(event.target.files);
          event.target.value = "";
        }}
        aria-hidden="true"
        tabIndex={-1}
      />
      <input
        ref={repositionInputRef}
        className="hidden-input"
        type="file"
        onChange={(event) => {
          repositionInvalidPath(event.target.files);
          event.target.value = "";
        }}
        aria-hidden="true"
        tabIndex={-1}
      />

      {toast && (
        <div className="toast" role="status">
          <CheckCircle size={18} weight="fill" />
          <span>{toast}</span>
        </div>
      )}
    </div>
  );
}

export { App };
