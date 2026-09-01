import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Clock,
  FileDoc,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  FileXls,
  FolderSimple,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { BulkLibraryToolbar } from "./LibraryActions";
import { LibraryRowActions } from "./LibraryRowActionMenu.jsx";
import {
  EmptyState,
  EntryLocation,
  EntryMetadata,
  LibraryFilterMenu,
  getActiveFilterChips,
  getEmptyActions,
  getEmptyDescription,
  getEmptyTitle,
  getGroupName,
  getModifiedLabel,
  getNavigationLabel,
} from "./LibraryPanelParts.jsx";
import {
  DEFAULT_SORT,
  PAGE_SIZE,
  SORT_OPTIONS,
  filterEntries,
  formatFileSize,
  getDisplayType,
  getDuplicateNameIds,
  getParentSummary,
  getRecentEntries,
  getRecentOpenedEntries,
  getLibraryContextKey,
  getSelectedIdsInEntries,
  getSelectionRangeIds,
  paginateEntries,
  sortEntries,
} from "./libraryModel";

function FileTypeIcon({ kind }) {
  const iconByKind = {
    doc: FileDoc,
    docx: FileDoc,
    pdf: FilePdf,
    xlsx: FileXls,
    image: FileImage,
    video: FileVideo,
    folder: FolderSimple,
    markdown: FileText,
    text: FileText,
    other: FileText,
  };
  const Icon = iconByKind[kind] || FileText;
  return <span className={`file-type-icon file-type-icon-${kind}`} aria-hidden="true"><Icon size={25} weight="regular" /></span>;
}
export function LibraryPanel({
  files,
  groups = [],
  activeNav,
  searchQuery,
  onSearchQueryChange,
  sort = DEFAULT_SORT,
  onSortChange,
  pageSize = PAGE_SIZE,
  selectedId,
  selectedIds = [],
  onContextChange,
  onVisibleEntriesChange,
  onSelectionChange,
  onToggleSelection,
  onSelectRange,
  onSelectPage,
  searchInputRef,
  directoryView,
  directoryLoading,
  indexReady,
  refreshing,
  refreshError,
  onRefresh,
  busyFileId,
  batchBusy,
  retryBatch,
  undoStatus,
  onBatchFavorite,
  onBatchGroup,
  onBatchTags,
  onBatchRemove,
  onUndo,
  onRetryBatch,
  onCancelBatch,
  onClearSelection,
  onManageGroups,
  onCopyLocation,
  onImport,
  onClearSearch,
  onRowClick,
  onRowKeyDown,
  onOpenBreadcrumb,
  onReposition,
  onFavorite,
  onRemove,
  onCopy,
  onRename,
  onDelete,
  onOpenDefault,
  onReveal,
  onDetails,
  onEditTags,
  onSetGroup,
  tagFilterRequest,
  onTagFilter,
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({ type: "", tags: [], groupIds: [] });
  const headerCheckboxRef = useRef(null);
  const tableScrollRef = useRef(null);
  const selectionAnchorRef = useRef("");
  const handledSelectionKeyRef = useRef(new Set());
  const previousContextKeyRef = useRef("");
  const previousRefreshingRef = useRef(false);
  const refreshScrollTopRef = useRef(0);
  const sourceEntries = directoryView?.entries || files;
  const contextKey = useMemo(() => getLibraryContextKey({ activeNav, searchQuery, filters, directoryView }), [activeNav, directoryView, filters, searchQuery]);
  const visibleFiles = useMemo(() => {
    const filtered = filterEntries(sourceEntries, {
      activeNav,
      query: searchQuery,
      directory: Boolean(directoryView),
      types: filters.type ? [filters.type] : [],
      tags: filters.tags,
      groupIds: filters.groupIds,
      groups,
      directoryView,
    });
    const directorySort = sort.key === "addedAt" ? { key: "name", direction: "asc" } : sort;
    if (!directoryView && activeNav === "recent-opened") return filtered;
    return sortEntries(filtered, directoryView ? directorySort : sort);
  }, [activeNav, directoryView, filters, groups, searchQuery, sort, sourceEntries]);
  const page = useMemo(() => paginateEntries(visibleFiles, currentPage, pageSize), [currentPage, pageSize, visibleFiles]);
  const duplicateIds = useMemo(() => getDuplicateNameIds(sourceEntries), [sourceEntries]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectablePageIds = directoryView ? [] : page.entries.map((file) => file.id);
  const allPageSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIdSet.has(id));
  const somePageSelected = selectablePageIds.some((id) => selectedIdSet.has(id));
  const visibleSelectedCount = getSelectedIdsInEntries(selectedIds, visibleFiles).length;
  const totalEntryCount = directoryView
    ? sourceEntries.length
    : activeNav === "recent"
      ? getRecentEntries(files).length
      : activeNav === "recent-opened"
        ? getRecentOpenedEntries(files).length
        : files.length;
  const activeFilterChips = getActiveFilterChips(filters, groups);

  useEffect(() => {
    onContextChange?.(contextKey);
  }, [contextKey, onContextChange]);

  useEffect(() => {
    selectionAnchorRef.current = "";
  }, [contextKey]);

  useEffect(() => {
    if (selectionAnchorRef.current && !visibleFiles.some((file) => file.id === selectionAnchorRef.current)) {
      selectionAnchorRef.current = "";
    }
  }, [visibleFiles]);

  useEffect(() => {
    if (!selectedIds.length) selectionAnchorRef.current = "";
  }, [selectedIds.length]);

  useEffect(() => {
    onVisibleEntriesChange?.(visibleFiles, contextKey);
  }, [contextKey, onVisibleEntriesChange, visibleFiles]);

  useEffect(() => {
    const tag = tagFilterRequest?.tag;
    if (!tag) return;
    setFilters((current) => current.tags.includes(tag) ? current : { ...current, tags: [...current.tags, tag] });
  }, [tagFilterRequest]);

  useEffect(() => {
    const groupIds = new Set(groups.map((group) => group.id));
    setFilters((current) => {
      const retained = current.groupIds.filter((groupId) => groupIds.has(groupId));
      return retained.length === current.groupIds.length ? current : { ...current, groupIds: retained };
    });
  }, [groups]);

  useEffect(() => {
    if (!previousContextKeyRef.current) {
      previousContextKeyRef.current = contextKey;
      return;
    }
    if (previousContextKeyRef.current === contextKey) return;
    previousContextKeyRef.current = contextKey;
    tableScrollRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [contextKey]);

  useEffect(() => {
    if (!previousRefreshingRef.current && refreshing) {
      refreshScrollTopRef.current = tableScrollRef.current?.scrollTop || 0;
    } else if (previousRefreshingRef.current && !refreshing) {
      tableScrollRef.current?.scrollTo({ top: refreshScrollTopRef.current, left: 0, behavior: "auto" });
    }
    previousRefreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    setCurrentPage(1);
  }, [contextKey, pageSize, sort]);

  useEffect(() => {
    if (selectedId && visibleFiles.some((file) => file.id === selectedId)) return;
    onSelectionChange(visibleFiles[0]?.id || "");
  }, [onSelectionChange, selectedId, visibleFiles]);

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = !allPageSelected && somePageSelected;
  }, [allPageSelected, somePageSelected]);

  function clearFilter(key, value) {
    setFilters((current) => {
      if (key === "type") return { ...current, type: "" };
      const filterKey = key.startsWith("tag:") ? "tags" : "groupIds";
      return { ...current, [filterKey]: current[filterKey].filter((item) => item !== value) };
    });
  }

  function handleToggleSelection(fileId, shiftKey) {
    const rangeIds = shiftKey
      ? getSelectionRangeIds(visibleFiles, selectionAnchorRef.current, fileId)
      : [];
    if (rangeIds.length && onSelectRange) onSelectRange(rangeIds);
    else onToggleSelection?.(fileId);
    selectionAnchorRef.current = fileId;
  }

  function handleSelectPage(pageIds, selected) {
    onSelectPage?.(pageIds, selected);
    selectionAnchorRef.current = selected ? pageIds.at(-1) || "" : "";
  }

  function handleSelectionKeyDown(fileId, event) {
    if (event.key !== " " && event.key !== "Spacebar") return;
    event.preventDefault();
    event.stopPropagation();
    handledSelectionKeyRef.current.add(fileId);
    window.setTimeout(() => handledSelectionKeyRef.current.delete(fileId), 0);
    handleToggleSelection(fileId, event.shiftKey);
  }

  function handleSelectionClick(fileId, event) {
    event.stopPropagation();
    if (handledSelectionKeyRef.current.has(fileId)) {
      handledSelectionKeyRef.current.delete(fileId);
      return;
    }
    handleToggleSelection(fileId, event.shiftKey);
  }

  const heading = directoryView ? (
    <nav id="recent-title" className="folder-breadcrumbs" aria-label="文件夹路径">
      <button type="button" className="breadcrumb-button" onClick={() => onOpenBreadcrumb(-1)}><ArrowLeft size={17} weight="regular" /><span>资料库</span></button>
      {directoryView.trail.map((folder, index) => (
        <span className="breadcrumb-segment" key={folder.id}>
          <CaretRight size={14} weight="regular" aria-hidden="true" />
          <button type="button" className="breadcrumb-button" onClick={() => onOpenBreadcrumb(index)}>{folder.name}</button>
        </span>
      ))}
    </nav>
  ) : <h2 id="recent-title">{activeNav === "library" ? "资料库" : getNavigationLabel(activeNav)}</h2>;

  return (
    <section className="recent-section" aria-labelledby="recent-title" data-tauri-drag-region="false">
      <div className="section-heading-row">
        {heading}
        <div className="section-heading-actions">
          <span className="result-count" aria-live="polite">显示 {visibleFiles.length} 项 / 共 {totalEntryCount} 项</span>
          {onRefresh && <button type="button" className="icon-button" aria-label="刷新索引" aria-keyshortcuts="F5" title="刷新索引" aria-busy={refreshing} disabled={refreshing || !indexReady} onClick={onRefresh}><ArrowClockwise size={17} weight="bold" className={refreshing ? "is-spinning" : ""} aria-hidden="true" /></button>}
        </div>
      </div>
      {refreshError && <div className="inline-error" role="alert">{refreshError}</div>}
      <div className="library-toolbar">
        <label className="search-field">
          <MagnifyingGlass size={17} weight="regular" aria-hidden="true" />
          <span className="sr-only">搜索资料</span>
          <input ref={searchInputRef} aria-label="搜索资料" aria-keyshortcuts="Control+F" value={searchQuery} placeholder="搜索名称、类型、状态、位置或标签" onChange={(event) => onSearchQueryChange(event.target.value)} />
          {searchQuery && <button type="button" className="search-clear-button" aria-label="清空搜索" title="清空搜索" onClick={() => onSearchQueryChange("")}><X size={15} weight="bold" aria-hidden="true" /></button>}
        </label>
        <LibraryFilterMenu files={files} groups={groups} filters={filters} onChange={setFilters} onManageGroups={onManageGroups} />
        <div className="sort-controls">
          <label className="sort-control"><span>排序</span><select aria-label="排序字段" value={sort.key} onChange={(event) => onSortChange({ ...sort, key: event.target.value })}>{SORT_OPTIONS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
          <button type="button" className="sort-direction-button" aria-label={sort.direction === "asc" ? "升序" : "降序"} title={sort.direction === "asc" ? "升序" : "降序"} onClick={() => onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}>{sort.direction === "asc" ? <CaretUp size={17} weight="bold" aria-hidden="true" /> : <CaretDown size={17} weight="bold" aria-hidden="true" />}</button>
        </div>
      </div>
      {activeFilterChips.length > 0 && (
        <div className="active-filter-summary" role="group" aria-label="当前筛选条件">
          <span className="active-filter-label">当前筛选</span>
          {activeFilterChips.map((chip) => (
            <button type="button" className="active-filter-chip" key={chip.key} onClick={() => clearFilter(chip.key, chip.value)}>
              <span>{chip.label}</span>
              <X size={13} weight="bold" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {!directoryView && selectedIds.length > 0 && <BulkLibraryToolbar selectedIds={selectedIds} visibleSelectedCount={visibleSelectedCount} groups={groups} busy={batchBusy} retryBatch={retryBatch} undoStatus={undoStatus} onBatchFavorite={onBatchFavorite} onBatchGroup={onBatchGroup} onBatchTags={onBatchTags} onBatchRemove={onBatchRemove} onUndo={onUndo} onRetry={onRetryBatch} onCancelBatch={onCancelBatch} onClear={onClearSelection} />}

      {!indexReady ? <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取本地索引" description="请稍候。" /> : directoryLoading ? <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取文件夹" description="请稍候。" /> : visibleFiles.length ? (
        <div className="file-table">
          <div ref={tableScrollRef} className="file-table-scroll" data-testid="recent-list">
            <table className="file-table-grid">
              <caption className="sr-only">{directoryView ? "当前文件夹内容" : getNavigationLabel(activeNav)}，显示 {visibleFiles.length} 项，共 {totalEntryCount} 项</caption>
              <thead>
                <tr className="file-row file-row-header">
                  <th scope="col" className="file-selection-cell">{!directoryView && <input ref={headerCheckboxRef} type="checkbox" aria-label="选择当前页资料" checked={allPageSelected} onChange={() => handleSelectPage(selectablePageIds, !allPageSelected)} />}</th>
                  <th scope="col">名称</th><th scope="col">类型</th><th scope="col">分组</th><th scope="col">大小</th><th scope="col">状态</th><th scope="col">修改时间</th><th scope="col" className="file-actions-header">操作</th>
                </tr>
              </thead>
              <tbody>
                {page.entries.map((file) => (
                  <tr className={`file-row ${selectedId === file.id ? "is-selected" : ""}`} key={file.id} tabIndex={0} aria-selected={selectedId === file.id} onClick={() => onRowClick(file)} onKeyDown={(event) => onRowKeyDown(event, file)}>
                    <td className="file-selection-cell" data-label="选择"><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selectedIdSet.has(file.id)} disabled={batchBusy || Boolean(directoryView)} onKeyDown={(event) => handleSelectionKeyDown(file.id, event)} onClick={(event) => handleSelectionClick(file.id, event)} onChange={() => {}} /></td>
                    <th scope="row" data-label="名称">
                      <div className="file-name-cell">
                        <FileTypeIcon kind={file.kind} />
                        <div className="file-name-stack">
                          <span className="file-name" title={file.name}>{file.name}</span>
                          {duplicateIds.has(file.id) && <span className="file-parent-summary" title={getParentSummary(file, directoryView)}>位于 {getParentSummary(file, directoryView)}</span>}
                          <EntryLocation entry={file} directoryView={directoryView} onCopy={onCopyLocation} onReveal={onReveal} />
                           <EntryMetadata entry={file} onTagClick={onTagFilter} />
                        </div>
                      </div>
                    </th>
                    <td className="file-type" data-label="类型" title={getDisplayType(file)}>{getDisplayType(file)}</td>
                    <td className="file-group-cell" data-label="分组">{getGroupName(file, groups)}</td>
                    <td className="file-size" data-label="大小">{file.kind === "folder" ? "—" : formatFileSize(file.size)}</td>
                    <td data-label="状态"><div className={`file-status ${file.invalid ? "status-invalid" : "status-registered"}`}>
                      {file.invalid ? <button type="button" className="reposition-button reposition-button-invalid" onClick={(event) => { event.stopPropagation(); onReposition(file); }}>{file.status} · 重新定位</button> : <span>{file.status}</span>}
                    </div></td>
                    <td className="file-modified" data-label="修改时间">{getModifiedLabel(file)}</td>
                    <td className="file-actions-cell" data-label="操作"><LibraryRowActions file={file} persistent={!directoryView} contextKey={contextKey} busy={busyFileId === file.id} onFavorite={onFavorite} onRemove={onRemove} onCopy={onCopy} onRename={onRename} onDelete={onDelete} onOpenDefault={onOpenDefault} onReveal={onReveal} onDetails={onDetails} onEditTags={onEditTags} onSetGroup={onSetGroup} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.pageCount > 1 && <nav className="pagination" aria-label="分页"><button type="button" className="pagination-button" aria-label="上一页" title="上一页" disabled={page.page === 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}><CaretLeft size={16} weight="regular" aria-hidden="true" /><span>上一页</span></button><span className="pagination-status" aria-live="polite">第 {page.page} / {page.pageCount} 页 · 显示 {visibleFiles.length} 项</span><button type="button" className="pagination-button" aria-label="下一页" title="下一页" disabled={page.page === page.pageCount} onClick={() => setCurrentPage((value) => Math.min(page.pageCount, value + 1))}><span>下一页</span><CaretRight size={16} weight="regular" aria-hidden="true" /></button></nav>}
        </div>
      ) : <EmptyState icon={<MagnifyingGlass size={28} weight="regular" />} title={getEmptyTitle({ activeNav, directoryView, searchQuery, filters })} description={getEmptyDescription({ activeNav, directoryView, searchQuery, filters })} actions={getEmptyActions({ activeNav, directoryView, searchQuery, filters, onClearSearch, onClearFilters: () => setFilters({ type: "", tags: [], groupIds: [] }), onOpenBreadcrumb, onImport, onManageGroups })} />}
    </section>
  );
}
