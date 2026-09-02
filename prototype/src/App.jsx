import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { PreviewPane } from "./features/preview/PreviewPane";
import {
  BatchRemoveDialog,
  DeleteOriginalDialog,
  GroupManagerDialog,
  RenameDialog,
  RemoveIndexDialog,
} from "./features/library/LibraryActions";
import {
  EditGroupDialog,
  EditTagsDialog,
  EntryDetailsDialog,
} from "./features/library/LibraryEntryDialogs.jsx";
import { ImportFolderDialog } from "./features/library/ImportFolderDialog.jsx";
import { LibraryPanel } from "./features/library/LibraryPanel";
import { useIndexController } from "./features/library/useIndexController";
import { useLibraryActions } from "./features/library/useLibraryActions";
import { useLibraryNavigation } from "./features/library/useLibraryNavigation";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { DEFAULT_SETTINGS } from "./features/settings/settingsModel";
import { useSettingsController } from "./features/settings/useSettingsController";
import { useWindowController } from "./features/window/useWindowController";
import { OperationCenter } from "./features/operations/OperationCenter.jsx";
import { useOperationController } from "./features/operations/useOperationController.js";
import {
  clearSelectionOnContextChange,
  getNavigationCount,
  retainExistingSelection,
} from "./features/library/libraryModel";
import { isMainIndexEntry } from "./features/library/libraryControllerModel.js";
import {
  KEYBOARD_ACTIONS,
  getKeyboardAction,
  isLayerTarget,
} from "./lib/keyboardModel.js";
import {
  ArrowClockwise,
  CheckCircle,
  ClockCounterClockwise,
  Clock,
  DotsThree,
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
    path: "C:\\资料\\研究计划.md",
    name: "研究计划.md",
    type: "Markdown",
    kind: "markdown",
    status: "已登记",
    modified: "2026-08-28 10:24",
    modifiedAt: 1787883840,
    addedAt: 1787883840,
    lastOpenedAt: 1787883900000,
    size: 2048,
    favorite: true,
    tags: ["研究"],
    groupId: null,
  },
  {
    id: "interview-notes",
    path: "C:\\资料\\访谈记录.docx",
    name: "访谈记录.docx",
    type: "Word 文档",
    kind: "docx",
    status: "已登记",
    modified: "2026-08-28 09:41",
    modifiedAt: 1787881260,
    addedAt: 1787881260,
    lastOpenedAt: 1787883960000,
    size: 8192,
    favorite: false,
    tags: ["访谈"],
    groupId: null,
  },
  {
    id: "data-summary",
    path: "C:\\资料\\数据汇总.xlsx",
    name: "数据汇总.xlsx",
    type: "Excel 工作簿",
    kind: "xlsx",
    status: "已登记",
    modified: "2026-08-28 09:15",
    modifiedAt: 1787879700,
    addedAt: 1787879700,
    size: 16384,
    favorite: true,
    tags: ["数据"],
    groupId: null,
  },
  {
    id: "old-project",
    path: "C:\\资料\\旧项目资料（备份）",
    name: "旧项目资料（备份）",
    type: "文件夹",
    kind: "folder",
    status: "路径失效",
    modified: "2026-08-27 16:32",
    modifiedAt: 1787819520,
    addedAt: 1787819520,
    size: 0,
    favorite: false,
    tags: [],
    groupId: null,
    invalid: true,
  },
];

const NAV_ITEMS = [
  { key: "library", label: "资料库", icon: FolderSimple },
  { key: "recent", label: "最近添加", icon: Clock },
  { key: "recent-opened", label: "最近打开", icon: ClockCounterClockwise },
  { key: "favorites", label: "收藏", icon: Star },
  { key: "invalid", label: "失效路径", icon: WarningCircle },
];

const IS_TAURI_RUNTIME = isTauri();

function App() {
  const [toast, setToast] = useState("");
  const [sort, setSort] = useState({ key: "addedAt", direction: "desc" });
  const [pageSize, setPageSize] = useState(DEFAULT_SETTINGS.pageSize);
  const [selectedIds, setSelectedIds] = useState([]);
  const [groupManagerOpen, setGroupManagerOpen] = useState(false);
  const [detailsEntryId, setDetailsEntryId] = useState("");
  const [tagFilterRequest, setTagFilterRequest] = useState(null);
  const [previewEntries, setPreviewEntries] = useState([]);
  const [previewRetryNonce, setPreviewRetryNonce] = useState(0);
  const appShellRef = useRef(null);
  const searchInputRef = useRef(null);
  const keyboardStateRef = useRef(null);
  const showToast = useCallback((message) => setToast(message), []);
  const filesRef = useRef([]);
  const previewEntriesRef = useRef([]);
  const tagFilterSequenceRef = useRef(0);
  const libraryContextKeyRef = useRef("");
  const clearBatchSelection = useCallback(() => setSelectedIds([]), []);
  const navigation = useLibraryNavigation({
    filesRef,
    initialSelectedId: IS_TAURI_RUNTIME ? "" : "research-plan",
    showToast,
    clearSelection: clearBatchSelection,
  });
  const operations = useOperationController({ isTauriRuntime: IS_TAURI_RUNTIME, showToast });
  const handleLibraryContextChange = useCallback((nextContextKey) => {
    const previousContextKey = libraryContextKeyRef.current;
    libraryContextKeyRef.current = nextContextKey;
    setSelectedIds((current) => clearSelectionOnContextChange(previousContextKey, nextContextKey, current));
    if (previousContextKey && previousContextKey !== nextContextKey) {
      previewEntriesRef.current = [];
      setPreviewEntries([]);
      setPreviewRetryNonce(0);
      navigation.setPreviewEntryId(null);
    }
  }, [navigation.setPreviewEntryId]);
  const handleVisibleEntriesChange = useCallback((entries) => {
    previewEntriesRef.current = entries;
    setPreviewEntries(entries);
  }, []);
  const index = useIndexController({
    isTauriRuntime: IS_TAURI_RUNTIME,
    initialFiles: INITIAL_FILES,
    setSelectedId: navigation.setSelectedId,
    setPreviewEntryId: navigation.setPreviewEntryId,
    setDirectoryView: navigation.setDirectoryView,
    showToast,
    operationReporter: operations,
  });
  filesRef.current = index.files;
  const settingsController = useSettingsController({
    isTauriRuntime: IS_TAURI_RUNTIME,
    showToast,
    onSortChange: setSort,
    onPageSizeChange: setPageSize,
  });
  const actions = useLibraryActions({
    isTauriRuntime: IS_TAURI_RUNTIME,
    files: index.files,
    setFiles: index.setFiles,
    settings: settingsController.settings,
    setActiveNav: navigation.setActiveNav,
    setSelectedId: navigation.setSelectedId,
    directoryView: navigation.directoryView,
    setDirectoryView: navigation.setDirectoryView,
    previewEntryId: navigation.previewEntryId,
    setPreviewEntryId: navigation.setPreviewEntryId,
    openDirectory: navigation.openDirectory,
    applyIndexSnapshot: index.applyIndexSnapshot,
    reloadIndexPreservingState: index.reloadIndexPreservingState,
    setSelectedIds,
    setIndexing: index.setIndexing,
    showToast,
    operationReporter: operations,
  });
  const {
    applySettings,
    handleSettingsSave,
    settings,
    settingsLoading,
    settingsOpen,
    settingsSaving,
    setSettingsOpen,
  } = settingsController;
  const handleSettingsChanged = useCallback((nextSettings, warning) => {
    if (!nextSettings) return;
    applySettings(nextSettings);
    if (warning) showToast(warning);
  }, [applySettings, showToast]);
  const windowController = useWindowController({
    isTauriRuntime: IS_TAURI_RUNTIME,
    onIndexChanged: index.reloadIndexPreservingState,
    onOpenFloating: actions.openFromFloating,
    onOpenSettings: () => setSettingsOpen(true),
    onSettingsChanged: handleSettingsChanged,
    showToast,
  });
  const { files, groups, indexReady, indexRecovery, indexing, refreshing, refreshError, diagnosticExporting, undoStatus } = index;
  const { activeNav, directoryLoading, directoryView, handleRowClick, handleRowKeyDown, openBreadcrumb, previewEntryId, searchQuery, selectNav, selectedId, setSearchQuery } = navigation;
  const { addTag, batchBusy, busyFileId, canRetryOperation, choosePaths, closePendingAction, confirmBatchRemove, confirmDelete, confirmFolderImport, confirmGroup, confirmRemove, confirmRename, confirmTags, createGroup, deleteGroup, dragActive, fileInputRef, folderInputRef, groupBusy, groupDraft, handleBatchFavorite, handleBatchGroup, handleBatchTags, handleCancelBatch, handleCancelImport, handleCopy, handleCopyLocation, handleDragLeave, handleDragOver, handleDrop, handleFavorite, handleOpenDefault, handleReveal, handleRetryBatch, handleUndo, openRepositionPicker, pendingAction, recursiveImportProgress, repositionInputRef, repositionInvalidPath, removeTag, renameName, renameGroup, renameValidation, requestBatchRemove, requestDelete, requestEditTags, requestRemove, requestRename, requestSetGroup, retryBatch, retryOperation, setGroupDraft, setRenameName, setTagInput, tagDraft, tagInput } = actions;
  const { floatingWindowError, floatingWindowRetrying, handleWindowAction, retryFloatingBall } = windowController;

  const handlePreviewNavigate = useCallback((nextEntry) => {
    if (!nextEntry?.id || !previewEntriesRef.current.some((entry) => entry.id === nextEntry.id)) return;
    navigation.setSelectedId(nextEntry.id);
    setPreviewRetryNonce(0);
    navigation.setPreviewEntryId(nextEntry.id);
  }, [navigation.setPreviewEntryId, navigation.setSelectedId]);
  const handlePreviewRetry = useCallback(() => {
    setPreviewRetryNonce((current) => current + 1);
    showToast("正在重试预览");
  }, [showToast]);
  const handlePreviewClose = useCallback(() => {
    setPreviewRetryNonce(0);
    navigation.setPreviewEntryId(null);
  }, [navigation.setPreviewEntryId]);
  const handlePreviewReveal = useCallback((entry, currentDirectoryView) => handleReveal(entry, currentDirectoryView), [handleReveal]);
  const handlePreviewCopyLocation = useCallback((entry, currentDirectoryView) => handleCopyLocation(entry, currentDirectoryView), [handleCopyLocation]);

  const handleOpenDetails = useCallback((file) => {
    if (!isMainIndexEntry(file)) return;
    navigation.setSelectedId(file.id);
    setDetailsEntryId(file.id);
  }, [navigation.setSelectedId]);
  const handleTagFilter = useCallback((tag) => {
    const normalized = String(tag ?? "").trim();
    if (!normalized) return;
    tagFilterSequenceRef.current += 1;
    setTagFilterRequest({ tag: normalized, sequence: tagFilterSequenceRef.current });
    setDetailsEntryId("");
  }, []);
  const handleOpenEditTags = useCallback((file) => {
    setDetailsEntryId("");
    requestEditTags(file);
  }, [requestEditTags]);
  const handleOpenSetGroup = useCallback((file) => {
    setDetailsEntryId("");
    requestSetGroup(file);
  }, [requestSetGroup]);
  const handleDetailsPreview = useCallback((file) => {
    if (!file?.id || file.invalid || file.kind === "folder") return;
    setDetailsEntryId("");
    navigation.setSelectedId(file.id);
    navigation.setPreviewEntryId(file.id);
  }, [navigation.setPreviewEntryId, navigation.setSelectedId]);
  const detailsEntry = detailsEntryId ? files.find((file) => file.id === detailsEntryId) : null;

  useEffect(() => {
    setSelectedIds((current) => retainExistingSelection(current, files));
  }, [files]);

  const toggleSelection = useCallback((fileId) => {
    setSelectedIds((current) => current.includes(fileId) ? current.filter((id) => id !== fileId) : [...current, fileId]);
  }, []);

  const selectRange = useCallback((rangeIds) => {
    setSelectedIds((current) => [...new Set([...current, ...rangeIds])]);
  }, []);

  const selectPage = useCallback((pageIds, selected) => {
    setSelectedIds((current) => {
      const next = new Set(current);
      pageIds.forEach((id) => selected ? next.add(id) : next.delete(id));
      return [...next];
    });
  }, []);

  keyboardStateRef.current = {
    closePendingAction,
    detailsEntryId,
    groupManagerOpen,
    handlePreviewClose,
    modalOpen: Boolean(settingsOpen || detailsEntryId || previewEntryId || pendingAction || groupManagerOpen),
    refreshIndex: index.handleRefreshIndex,
    settingsOpen,
    undoStatus,
    choosePaths,
    handleUndo,
  };

  useEffect(() => {
    function isInsideApp(target, shell) {
      return target === document.body
        || target === document.documentElement
        || Boolean(shell?.contains(target));
    }

    function closeTopLayer(state) {
      if (state.pendingAction) {
        state.closePendingAction();
        return true;
      }
      if (state.groupManagerOpen) {
        setGroupManagerOpen(false);
        return true;
      }
      if (state.detailsEntryId) {
        setDetailsEntryId("");
        return true;
      }
      if (navigation.previewEntryId) {
        state.handlePreviewClose();
        return true;
      }
      if (state.settingsOpen) {
        setSettingsOpen(false);
        return true;
      }
      return false;
    }

    function handleKeyDown(event) {
      const shell = appShellRef.current;
      if (!isInsideApp(event.target, shell)) return;
      if (event.key === "Escape") {
        if (event.defaultPrevented || isLayerTarget(event.target)) return;
        const state = keyboardStateRef.current;
        if (state && closeTopLayer(state)) event.preventDefault();
        return;
      }
      const action = getKeyboardAction(event);
      if (!action || isLayerTarget(event.target)) return;
      const state = keyboardStateRef.current;
      if (!state || state.modalOpen) return;
      event.preventDefault();
      if (action === KEYBOARD_ACTIONS.FOCUS_SEARCH) searchInputRef.current?.focus();
      if (action === KEYBOARD_ACTIONS.REFRESH_INDEX) void state.refreshIndex?.();
      if (action === KEYBOARD_ACTIONS.CHOOSE_FILE) void state.choosePaths?.("file");
      if (action === KEYBOARD_ACTIONS.CHOOSE_FOLDER) void state.choosePaths?.("folder");
      if (action === KEYBOARD_ACTIONS.UNDO && state.undoStatus) void state.handleUndo?.();
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [navigation.previewEntryId, setSettingsOpen]);

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  return (
    <div ref={appShellRef} className="app-shell">
      <div className="window-drag-strip" aria-hidden="true" data-tauri-drag-region="deep" />
      <div className="window-controls" aria-label="窗口控制" data-tauri-drag-region="false">
        <button type="button" data-tauri-drag-region="false" aria-label="最小化" title="最小化" onClick={() => void handleWindowAction("minimize")}>
          <Minus size={14} weight="regular" />
        </button>
        <button type="button" data-tauri-drag-region="false" aria-label="最大化" title="最大化" onClick={() => void handleWindowAction("maximize")}>
          <Square size={13} weight="regular" />
        </button>
        <button type="button" data-tauri-drag-region="false" aria-label="关闭" title="关闭" className="window-close" onClick={() => void handleWindowAction("close")}>
          <X size={16} weight="regular" />
        </button>
      </div>

      <aside className="sidebar" aria-label="主导航">
        <div>
          <div className="brand">
            <span className="brand-mark" aria-hidden="true"><FolderOpen size={22} weight="regular" /></span>
            <span>本地资料工作台</span>
          </div>
          <nav className="primary-nav" aria-label="资料视图">
            {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
              <button type="button" key={key} className={`nav-item ${activeNav === key ? "is-active" : ""}`} aria-current={activeNav === key ? "page" : undefined} onClick={() => selectNav(key)}>
                <Icon size={23} weight={activeNav === key ? "fill" : "regular"} aria-hidden="true" />
                <span>{label}</span>
                <span className="nav-count" aria-label={`${getNavigationCount(files, key)} 项`}>{getNavigationCount(files, key)}</span>
              </button>
            ))}
            <button type="button" className="nav-item settings-nav-item" aria-busy={settingsLoading} onClick={() => settingsLoading ? showToast("正在读取设置，请稍候") : setSettingsOpen(true)}>
              <GearSix size={23} weight="regular" aria-hidden="true" />
              <span>设置</span>
            </button>
          </nav>
          <button type="button" className="nav-item mobile-more-nav" aria-busy={settingsLoading} onClick={() => settingsLoading ? showToast("正在读取设置，请稍候") : setSettingsOpen(true)}>
            <DotsThree size={23} weight="bold" aria-hidden="true" />
            <span>更多</span>
          </button>
        </div>
        <div className="sidebar-bottom">
          <button type="button" className="nav-item" onClick={() => void choosePaths("folder")}>
            <FolderOpen size={23} weight="regular" aria-hidden="true" />
            <span>打开本地文件夹</span>
          </button>
        </div>
      </aside>

      <main className="main-content">
        <header className="page-header" data-tauri-drag-region="deep">
          <div className="page-header-row" data-tauri-drag-region="deep">
            <h1>把资料放进一个可检索的本地库</h1>
            <OperationCenter records={operations.records} files={files} loading={operations.historyLoading} warning={operations.historyWarning} onClear={operations.clearHistory} onRetry={retryOperation} canRetry={canRetryOperation} />
          </div>
        </header>

        {floatingWindowError && (
          <div className="floating-window-alert" role="alert" data-tauri-drag-region="false">
            <WarningCircle size={18} weight="fill" aria-hidden="true" />
            <span>{floatingWindowError}</span>
            <button type="button" onClick={() => void retryFloatingBall()} disabled={floatingWindowRetrying}>
              <ArrowClockwise size={16} weight="bold" aria-hidden="true" />
              <span>{floatingWindowRetrying ? "重试中..." : "重试"}</span>
            </button>
          </div>
        )}

        {indexRecovery?.required && (
          <div className="index-recovery-alert" role="alert" data-tauri-drag-region="false">
            <WarningCircle size={18} weight="fill" aria-hidden="true" />
            <div>
              <strong>本地索引需要恢复</strong>
              <span>{indexRecovery.issue}。{indexRecovery.backupCreated ? "原文件已保留备份。" : "原文件备份未能创建。"}请重建空索引后重新导入资料。</span>
            </div>
            <div className="index-recovery-actions">
              <button type="button" onClick={index.exportIndexDiagnostic} disabled={diagnosticExporting}>
                {diagnosticExporting ? "导出中..." : "导出诊断"}
              </button>
              <button type="button" onClick={index.resetIndexRecovery} disabled={refreshing}>
                {refreshing ? "处理中..." : "重建空索引"}
              </button>
            </div>
          </div>
        )}

        <section className={`drop-zone ${files.length ? "has-library-files" : ""} ${dragActive ? "is-dragging" : ""}`} data-tauri-drag-region="false" data-testid="drop-zone" onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
          <div className="drop-zone-icon" aria-hidden="true"><FolderOpen size={42} weight="regular" /></div>
          <h2>{recursiveImportProgress ? "正在扫描文件夹..." : indexing ? "正在建立本地索引..." : dragActive ? "松开鼠标即可登记资料" : files.length ? "继续添加资料或拖放到这里" : "将文件或文件夹拖到这里"}</h2>
          {recursiveImportProgress && (
            <div className="recursive-import-progress" role="status" aria-live="polite">
              <progress aria-label="递归导入进度" />
              <span>已检查 {recursiveImportProgress.scannedCount} 项，发现 {recursiveImportProgress.candidateCount} 个文件，已准备 {recursiveImportProgress.acceptedCount} 项，跳过 {recursiveImportProgress.skippedCount} 项{recursiveImportProgress.currentName ? `：${recursiveImportProgress.currentName}` : ""}</span>
              <button type="button" className="text-button" onClick={() => void handleCancelImport()}>取消扫描</button>
            </div>
          )}
          <div className="drop-actions">
            <button type="button" className="button button-primary" data-testid="import-folder" aria-keyshortcuts="Control+Shift+O" onClick={() => void choosePaths("folder")} disabled={indexing}>
              <FolderOpen size={19} weight="regular" aria-hidden="true" /><span>导入文件夹</span>
            </button>
            <button type="button" className="button button-secondary" data-testid="choose-file" aria-keyshortcuts="Control+O" onClick={() => void choosePaths("file")} disabled={indexing}>
              <UploadSimple size={19} weight="regular" aria-hidden="true" /><span>选择文件</span>
            </button>
          </div>
        </section>

        <LibraryPanel
          files={files}
          groups={groups}
          activeNav={activeNav}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          sort={sort}
          onSortChange={setSort}
          pageSize={pageSize}
          selectedId={selectedId}
          selectedIds={selectedIds}
          searchInputRef={searchInputRef}
          onContextChange={handleLibraryContextChange}
          onVisibleEntriesChange={handleVisibleEntriesChange}
          onSelectionChange={navigation.setSelectedId}
          onToggleSelection={toggleSelection}
          onSelectRange={selectRange}
          onSelectPage={selectPage}
          directoryView={directoryView}
          directoryLoading={directoryLoading}
          indexReady={indexReady}
          refreshing={refreshing}
          refreshError={refreshError}
          onRefresh={index.handleRefreshIndex}
          busyFileId={busyFileId}
          batchBusy={batchBusy}
          retryBatch={retryBatch}
          undoStatus={undoStatus}
          onBatchFavorite={handleBatchFavorite}
          onBatchGroup={handleBatchGroup}
          onBatchTags={handleBatchTags}
          onBatchRemove={requestBatchRemove}
          onUndo={handleUndo}
          onRetryBatch={handleRetryBatch}
          onCancelBatch={handleCancelBatch}
          onClearSelection={clearBatchSelection}
          onManageGroups={() => setGroupManagerOpen(true)}
          onCopyLocation={handleCopyLocation}
          onImport={() => void choosePaths("file")}
          onClearSearch={() => navigation.setSearchQuery("")}
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
          onDetails={handleOpenDetails}
          onEditTags={handleOpenEditTags}
          onSetGroup={handleOpenSetGroup}
          tagFilterRequest={tagFilterRequest}
          onTagFilter={handleTagFilter}
        />
      </main>

      {previewEntryId && (() => {
        const currentEntries = previewEntries.length ? previewEntries : (directoryView?.entries || files);
        const previewEntry = currentEntries.find((file) => file.id === previewEntryId);
        return previewEntry ? (
          <PreviewPane
            entry={previewEntry}
            navigationEntries={currentEntries}
            directoryView={directoryView}
            onClose={handlePreviewClose}
            onRetry={handlePreviewRetry}
            onReposition={openRepositionPicker}
            onOpenDefault={handleOpenDefault}
            onReveal={handlePreviewReveal}
            onCopyLocation={handlePreviewCopyLocation}
            onFavorite={handleFavorite}
            onNavigate={handlePreviewNavigate}
            retryNonce={previewRetryNonce}
          />
        ) : null;
      })()}

      {detailsEntry && <EntryDetailsDialog file={detailsEntry} groups={groups} busy={busyFileId === detailsEntry.id} onClose={() => setDetailsEntryId("")} onFavorite={handleFavorite} onPreview={handleDetailsPreview} onCopyLocation={handleCopyLocation} onReveal={handleReveal} onOpenDefault={handleOpenDefault} onEditTags={handleOpenEditTags} onSetGroup={handleOpenSetGroup} onTagClick={handleTagFilter} />}

      {settingsOpen && <SettingsPanel settings={settings} saving={settingsSaving} onCancel={() => setSettingsOpen(false)} onSave={handleSettingsSave} />}
      {pendingAction?.type === "remove" && <RemoveIndexDialog file={pendingAction.file} busy={busyFileId === pendingAction.file.id} onCancel={closePendingAction} onConfirm={() => void confirmRemove()} />}
      {pendingAction?.type === "batch-remove" && <BatchRemoveDialog files={pendingAction.files} busy={batchBusy} onCancel={closePendingAction} onConfirm={() => void confirmBatchRemove()} />}
      {pendingAction?.type === "folder-import" && <ImportFolderDialog folderName={pendingAction.folderName} onCancel={closePendingAction} onConfirm={(mode, policy) => void confirmFolderImport(mode, policy)} />}
      {pendingAction?.type === "rename" && <RenameDialog file={pendingAction.file} value={renameName} validation={renameValidation} busy={busyFileId === pendingAction.file.id} onChange={setRenameName} onCancel={closePendingAction} onConfirm={() => void confirmRename()} />}
      {pendingAction?.type === "edit-tags" && <EditTagsDialog file={pendingAction.file} tags={tagDraft} tagInput={tagInput} busy={busyFileId === pendingAction.file.id} onInputChange={setTagInput} onAdd={addTag} onRemove={removeTag} onCancel={closePendingAction} onConfirm={() => void confirmTags()} />}
      {pendingAction?.type === "set-group" && <EditGroupDialog file={pendingAction.file} groups={groups} value={groupDraft} busy={busyFileId === pendingAction.file.id} onChange={setGroupDraft} onCancel={closePendingAction} onConfirm={() => void confirmGroup()} />}
      {pendingAction?.type === "delete" && <DeleteOriginalDialog file={pendingAction.file} busy={busyFileId === pendingAction.file.id} onCancel={closePendingAction} onConfirm={() => void confirmDelete()} />}
      {groupManagerOpen && <GroupManagerDialog groups={groups} files={files} busy={groupBusy} onClose={() => setGroupManagerOpen(false)} onCreate={createGroup} onRename={renameGroup} onDelete={deleteGroup} />}

      <input ref={folderInputRef} className="hidden-input" type="file" multiple webkitdirectory="true" directory="true" onChange={(event) => { actions.addBrowserFiles(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />
      <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={(event) => { actions.addBrowserFiles(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />
      <input ref={repositionInputRef} className="hidden-input" type="file" onChange={(event) => { repositionInvalidPath(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />

      {toast && <div className="toast" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" /><span>{toast}</span></div>}
    </div>
  );
}

export { App };
