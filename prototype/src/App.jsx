import { useCallback, useEffect, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { PreviewPane } from "./features/preview/PreviewPane";
import { DeleteOriginalDialog, RenameDialog, RemoveIndexDialog } from "./features/library/LibraryActions";
import { LibraryPanel } from "./features/library/LibraryPanel";
import { useIndexController } from "./features/library/useIndexController";
import { useLibraryActions } from "./features/library/useLibraryActions";
import { useLibraryNavigation } from "./features/library/useLibraryNavigation";
import { SettingsPanel } from "./features/settings/SettingsPanel";
import { DEFAULT_SETTINGS } from "./features/settings/settingsModel";
import { useSettingsController } from "./features/settings/useSettingsController";
import { useWindowController } from "./features/window/useWindowController";
import { getNavigationCount } from "./features/library/libraryModel";
import {
  ArrowClockwise,
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

function App() {
  const [toast, setToast] = useState("");
  const [sort, setSort] = useState({ key: "addedAt", direction: "desc" });
  const [pageSize, setPageSize] = useState(DEFAULT_SETTINGS.pageSize);
  const showToast = useCallback((message) => setToast(message), []);
  const filesRef = useRef([]);
  const navigation = useLibraryNavigation({
    filesRef,
    initialSelectedId: IS_TAURI_RUNTIME ? "" : "research-plan",
    showToast,
  });
  const index = useIndexController({
    isTauriRuntime: IS_TAURI_RUNTIME,
    initialFiles: INITIAL_FILES,
    setSelectedId: navigation.setSelectedId,
    setPreviewEntryId: navigation.setPreviewEntryId,
    setDirectoryView: navigation.setDirectoryView,
    showToast,
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
    setIndexing: index.setIndexing,
    showToast,
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
  const { files, indexReady, indexRecovery, indexing, refreshing, refreshError, diagnosticExporting } = index;
  const { activeNav, directoryLoading, directoryView, handleRowClick, handleRowKeyDown, openBreadcrumb, previewEntryId, searchQuery, selectNav, selectedId, setSearchQuery } = navigation;
  const { busyFileId, choosePaths, closePendingAction, confirmDelete, confirmRemove, confirmRename, dragActive, fileInputRef, folderInputRef, handleCopy, handleDragLeave, handleDragOver, handleDrop, handleFavorite, handleOpenDefault, handleReveal, openRepositionPicker, pendingAction, repositionInputRef, repositionInvalidPath, renameName, renameValidation, requestDelete, requestRemove, requestRename, setRenameName } = actions;
  const { floatingWindowError, floatingWindowRetrying, handleWindowAction, retryFloatingBall } = windowController;

  useEffect(() => {
    if (!toast) return undefined;
    const timeoutId = window.setTimeout(() => setToast(""), 3600);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  return (
    <div className="app-shell">
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
          <h1>把资料放进一个可检索的本地库</h1>
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

        <section className={`drop-zone ${dragActive ? "is-dragging" : ""}`} data-tauri-drag-region="false" data-testid="drop-zone" onDrop={handleDrop} onDragOver={handleDragOver} onDragLeave={handleDragLeave}>
          <div className="drop-zone-icon" aria-hidden="true"><FolderOpen size={42} weight="regular" /></div>
          <h2>{indexing ? "正在建立本地索引..." : dragActive ? "松开鼠标即可登记资料" : "将文件或文件夹拖到这里"}</h2>
          <div className="drop-actions">
            <button type="button" className="button button-primary" data-testid="import-folder" onClick={() => void choosePaths("folder")} disabled={indexing}>
              <FolderOpen size={19} weight="regular" aria-hidden="true" /><span>导入文件夹</span>
            </button>
            <button type="button" className="button button-secondary" data-testid="choose-file" onClick={() => void choosePaths("file")} disabled={indexing}>
              <UploadSimple size={19} weight="regular" aria-hidden="true" /><span>选择文件</span>
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
          onSelectionChange={navigation.setSelectedId}
          directoryView={directoryView}
          directoryLoading={directoryLoading}
          indexReady={indexReady}
          refreshing={refreshing}
          refreshError={refreshError}
          onRefresh={index.handleRefreshIndex}
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

      {previewEntryId && (() => {
        const currentEntries = directoryView?.entries || files;
        const previewEntry = currentEntries.find((file) => file.id === previewEntryId);
        return previewEntry ? <PreviewPane entry={previewEntry} onClose={() => navigation.setPreviewEntryId(null)} /> : null;
      })()}

      {settingsOpen && <SettingsPanel settings={settings} saving={settingsSaving} onCancel={() => setSettingsOpen(false)} onSave={handleSettingsSave} />}
      {pendingAction?.type === "remove" && <RemoveIndexDialog file={pendingAction.file} busy={busyFileId === pendingAction.file.id} onCancel={closePendingAction} onConfirm={() => void confirmRemove()} />}
      {pendingAction?.type === "rename" && <RenameDialog file={pendingAction.file} value={renameName} validation={renameValidation} busy={busyFileId === pendingAction.file.id} onChange={setRenameName} onCancel={closePendingAction} onConfirm={() => void confirmRename()} />}
      {pendingAction?.type === "delete" && <DeleteOriginalDialog file={pendingAction.file} busy={busyFileId === pendingAction.file.id} onCancel={closePendingAction} onConfirm={() => void confirmDelete()} />}

      <input ref={folderInputRef} className="hidden-input" type="file" multiple webkitdirectory="true" directory="true" onChange={(event) => { actions.addBrowserFiles(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />
      <input ref={fileInputRef} className="hidden-input" type="file" multiple onChange={(event) => { actions.addBrowserFiles(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />
      <input ref={repositionInputRef} className="hidden-input" type="file" onChange={(event) => { repositionInvalidPath(event.target.files); event.target.value = ""; }} aria-hidden="true" tabIndex={-1} />

      {toast && <div className="toast" role="status"><CheckCircle size={18} weight="fill" aria-hidden="true" /><span>{toast}</span></div>}
    </div>
  );
}

export { App };
