import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowClockwise,
  CaretDown,
  CaretLeft,
  CaretRight,
  CaretUp,
  Clock,
  Copy,
  FileDoc,
  FileImage,
  FilePdf,
  FileText,
  FileVideo,
  FileXls,
  FolderOpen,
  FolderSimple,
  Funnel,
  MagnifyingGlass,
  X,
} from "@phosphor-icons/react";
import { BulkLibraryToolbar, LibraryRowActions } from "./LibraryActions";
import {
  DEFAULT_SORT,
  PAGE_SIZE,
  SORT_OPTIONS,
  filterEntries,
  formatFileSize,
  getDisplayType,
  getDuplicateNameIds,
  getEntryLocation,
  getParentSummary,
  paginateEntries,
  sortEntries,
} from "./libraryModel";

const MODIFIED_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

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
  onSelectionChange,
  onToggleSelection,
  onSelectPage,
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
}) {
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({ type: "", tags: [], groupIds: [] });
  const headerCheckboxRef = useRef(null);
  const sourceEntries = directoryView?.entries || files;
  const directoryViewKey = directoryView?.trail?.map((folder) => folder.id).join("/") || "";
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
    return sortEntries(filtered, directoryView ? directorySort : sort);
  }, [activeNav, directoryView, filters, groups, searchQuery, sort, sourceEntries]);
  const page = useMemo(() => paginateEntries(visibleFiles, currentPage, pageSize), [currentPage, pageSize, visibleFiles]);
  const duplicateIds = useMemo(() => getDuplicateNameIds(sourceEntries), [sourceEntries]);
  const selectedIdSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const selectablePageIds = directoryView ? [] : page.entries.map((file) => file.id);
  const allPageSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIdSet.has(id));
  const somePageSelected = selectablePageIds.some((id) => selectedIdSet.has(id));

  useEffect(() => {
    setCurrentPage(1);
  }, [activeNav, directoryViewKey, filters, pageSize, searchQuery, sort]);

  useEffect(() => {
    if (selectedId && visibleFiles.some((file) => file.id === selectedId)) return;
    onSelectionChange(visibleFiles[0]?.id || "");
  }, [onSelectionChange, selectedId, visibleFiles]);

  useEffect(() => {
    if (headerCheckboxRef.current) headerCheckboxRef.current.indeterminate = !allPageSelected && somePageSelected;
  }, [allPageSelected, somePageSelected]);

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
          <span className="result-count" aria-live="polite">共 {visibleFiles.length} 项</span>
          {onRefresh && <button type="button" className="icon-button" aria-label="刷新索引" title="刷新索引" aria-busy={refreshing} disabled={refreshing || !indexReady} onClick={onRefresh}><ArrowClockwise size={17} weight="bold" className={refreshing ? "is-spinning" : ""} aria-hidden="true" /></button>}
        </div>
      </div>
      {refreshError && <div className="inline-error" role="alert">{refreshError}</div>}
      <div className="library-toolbar">
        <label className="search-field">
          <MagnifyingGlass size={17} weight="regular" aria-hidden="true" />
          <span className="sr-only">搜索资料</span>
          <input aria-label="搜索资料" value={searchQuery} placeholder="搜索名称、类型、状态、位置或标签" onChange={(event) => onSearchQueryChange(event.target.value)} />
          {searchQuery && <button type="button" className="search-clear-button" aria-label="清空搜索" title="清空搜索" onClick={() => onSearchQueryChange("")}><X size={15} weight="bold" aria-hidden="true" /></button>}
        </label>
        <LibraryFilterMenu files={files} groups={groups} filters={filters} onChange={setFilters} onManageGroups={onManageGroups} />
        <div className="sort-controls">
          <label className="sort-control"><span>排序</span><select aria-label="排序字段" value={sort.key} onChange={(event) => onSortChange({ ...sort, key: event.target.value })}>{SORT_OPTIONS.map((option) => <option value={option.key} key={option.key}>{option.label}</option>)}</select></label>
          <button type="button" className="sort-direction-button" aria-label={sort.direction === "asc" ? "升序" : "降序"} title={sort.direction === "asc" ? "升序" : "降序"} onClick={() => onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}>{sort.direction === "asc" ? <CaretUp size={17} weight="bold" aria-hidden="true" /> : <CaretDown size={17} weight="bold" aria-hidden="true" />}</button>
        </div>
      </div>

      {!directoryView && selectedIds.length > 0 && <BulkLibraryToolbar selectedIds={selectedIds} groups={groups} busy={batchBusy} retryBatch={retryBatch} undoStatus={undoStatus} onBatchFavorite={onBatchFavorite} onBatchGroup={onBatchGroup} onBatchTags={onBatchTags} onBatchRemove={onBatchRemove} onUndo={onUndo} onRetry={onRetryBatch} onCancelBatch={onCancelBatch} onClear={onClearSelection} />}

      {!indexReady ? <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取本地索引" description="请稍候。" /> : directoryLoading ? <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取文件夹" description="请稍候。" /> : visibleFiles.length ? (
        <div className="file-table">
          <div className="file-table-scroll" data-testid="recent-list">
            <table className="file-table-grid">
              <caption className="sr-only">{directoryView ? "当前文件夹内容" : getNavigationLabel(activeNav)}，共 {visibleFiles.length} 项</caption>
              <thead>
                <tr className="file-row file-row-header">
                  <th scope="col" className="file-selection-cell">{!directoryView && <input ref={headerCheckboxRef} type="checkbox" aria-label="选择当前页资料" checked={allPageSelected} onChange={() => onSelectPage(selectablePageIds, !allPageSelected)} />}</th>
                  <th scope="col">名称</th><th scope="col">类型</th><th scope="col">分组</th><th scope="col">大小</th><th scope="col">状态</th><th scope="col">修改时间</th><th scope="col" className="file-actions-header">操作</th>
                </tr>
              </thead>
              <tbody>
                {page.entries.map((file) => (
                  <tr className={`file-row ${selectedId === file.id ? "is-selected" : ""}`} key={file.id} tabIndex={0} aria-selected={selectedId === file.id} onClick={() => onRowClick(file)} onKeyDown={(event) => onRowKeyDown(event, file)}>
                    <td className="file-selection-cell" data-label="选择"><input type="checkbox" aria-label={`选择 ${file.name}`} checked={selectedIdSet.has(file.id)} disabled={batchBusy || Boolean(directoryView)} onClick={(event) => event.stopPropagation()} onChange={() => onToggleSelection(file.id)} /></td>
                    <th scope="row" data-label="名称">
                      <div className="file-name-cell">
                        <FileTypeIcon kind={file.kind} />
                        <div className="file-name-stack">
                          <span className="file-name" title={file.name}>{file.name}</span>
                          {duplicateIds.has(file.id) && <span className="file-parent-summary" title={getParentSummary(file, directoryView)}>位于 {getParentSummary(file, directoryView)}</span>}
                          <EntryLocation entry={file} directoryView={directoryView} onCopy={onCopyLocation} onReveal={onReveal} />
                          <EntryMetadata entry={file} />
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
                    <td className="file-actions-cell" data-label="操作"><LibraryRowActions file={file} persistent={!directoryView} busy={busyFileId === file.id} onFavorite={onFavorite} onRemove={onRemove} onCopy={onCopy} onRename={onRename} onDelete={onDelete} onOpenDefault={onOpenDefault} onReveal={onReveal} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {page.pageCount > 1 && <nav className="pagination" aria-label="分页"><button type="button" className="pagination-button" aria-label="上一页" title="上一页" disabled={page.page === 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}><CaretLeft size={16} weight="regular" aria-hidden="true" /><span>上一页</span></button><span className="pagination-status" aria-live="polite">第 {page.page} / {page.pageCount} 页 · 共 {visibleFiles.length} 项</span><button type="button" className="pagination-button" aria-label="下一页" title="下一页" disabled={page.page === page.pageCount} onClick={() => setCurrentPage((value) => Math.min(page.pageCount, value + 1))}><span>下一页</span><CaretRight size={16} weight="regular" aria-hidden="true" /></button></nav>}
        </div>
      ) : <EmptyState icon={<MagnifyingGlass size={28} weight="regular" />} title={getEmptyTitle({ activeNav, directoryView, searchQuery, filters })} description={getEmptyDescription({ activeNav, directoryView, searchQuery, filters })} actions={getEmptyActions({ activeNav, directoryView, searchQuery, filters, onClearSearch, onClearFilters: () => setFilters({ type: "", tags: [], groupIds: [] }), onOpenBreadcrumb, onImport, onManageGroups })} />}
    </section>
  );
}

function LibraryFilterMenu({ files, groups, filters, onChange, onManageGroups }) {
  const menuRef = useRef(null);
  const types = [...new Set((files || []).map(getDisplayType).filter(Boolean))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const tags = [...new Set((files || []).flatMap((file) => Array.isArray(file.tags) ? file.tags : []))].sort((left, right) => left.localeCompare(right, "zh-CN"));
  const count = Number(Boolean(filters.type)) + filters.tags.length + filters.groupIds.length;

  useEffect(() => {
    function closeOnOutsidePointer(event) {
      if (!menuRef.current?.contains(event.target)) menuRef.current.open = false;
    }
    function closeOnEscape(event) {
      if (event.key === "Escape" && menuRef.current?.open) {
        event.preventDefault();
        menuRef.current.open = false;
      }
    }
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, []);

  function toggle(key, value) {
    const current = filters[key];
    onChange({ ...filters, [key]: current.includes(value) ? current.filter((item) => item !== value) : [...current, value] });
  }

  return (
    <details ref={menuRef} className="library-filter-menu">
      <summary className="filter-menu-trigger"><Funnel size={16} weight="regular" aria-hidden="true" /><span>筛选</span>{count > 0 && <strong>{count}</strong>}</summary>
      <div className="filter-menu-content" role="group" aria-label="组合筛选">
        <label className="filter-type-control"><span>类型</span><select value={filters.type} onChange={(event) => onChange({ ...filters, type: event.target.value })}><option value="">全部类型</option>{types.map((type) => <option value={type} key={type}>{type}</option>)}</select></label>
        <FilterCheckboxes legend="分组" values={groups.map((group) => ({ value: group.id, label: group.name }))} selected={filters.groupIds} onToggle={(value) => toggle("groupIds", value)} emptyLabel="还没有分组" />
        <FilterCheckboxes legend="标签" values={tags.map((tag) => ({ value: tag, label: tag }))} selected={filters.tags} onToggle={(value) => toggle("tags", value)} emptyLabel="还没有标签" />
        <div className="filter-menu-actions">
          <button type="button" className="text-button" disabled={!count} onClick={() => onChange({ type: "", tags: [], groupIds: [] })}>清除筛选</button>
          <button type="button" className="text-button" onClick={onManageGroups}>管理分组</button>
        </div>
      </div>
    </details>
  );
}

function FilterCheckboxes({ legend, values, selected, onToggle, emptyLabel }) {
  return (
    <fieldset className="filter-checkboxes">
      <legend>{legend}</legend>
      {values.length ? values.map(({ value, label }) => <label key={value}><input type="checkbox" checked={selected.includes(value)} onChange={() => onToggle(value)} /><span>{label}</span></label>) : <span className="filter-empty-label">{emptyLabel}</span>}
    </fieldset>
  );
}

function EntryLocation({ entry, directoryView, onCopy, onReveal }) {
  const location = getEntryLocation(entry, directoryView);
  const canReveal = !entry.invalid
    && typeof onReveal === "function"
    && (!directoryView || (entry.directoryId && Array.isArray(entry.relativePath)));
  return (
    <details className="file-location" onClick={(event) => event.stopPropagation()}>
      <summary title={location.fullPath}><FolderOpen size={14} weight="regular" aria-hidden="true" /><span>{location.displayPath}</span></summary>
      <div className="file-location-expanded">
        <code>{location.fullPath}</code>
        <button type="button" className="icon-button" aria-label="复制资料位置" title="复制位置" onClick={() => onCopy?.(entry, directoryView)}><Copy size={15} weight="regular" aria-hidden="true" /></button>
        {canReveal && <button type="button" className="location-reveal-button" onClick={() => onReveal(entry, directoryView)}><FolderOpen size={14} weight="regular" aria-hidden="true" /><span>定位</span></button>}
      </div>
    </details>
  );
}

function EntryMetadata({ entry }) {
  const tags = Array.isArray(entry.tags) ? entry.tags : [];
  if (!tags.length) return null;
  return (
    <div className="file-entry-metadata">
      {tags.slice(0, 4).map((tag) => <span className="file-tag-chip" key={tag}>{tag}</span>)}
      {tags.length > 4 && <span className="file-tag-overflow">+{tags.length - 4}</span>}
    </div>
  );
}

function getGroupName(entry, groups) {
  return groups.find((group) => group.id === entry.groupId)?.name || "未分组";
}

function getModifiedLabel(file) {
  if (file.modified) return file.modified;
  if (!Number.isFinite(file.modifiedAt) || file.modifiedAt <= 0) return "未知";
  return MODIFIED_FORMATTER.format(new Date(file.modifiedAt * 1000));
}

function getNavigationLabel(activeNav) {
  return { recent: "最近添加", favorites: "收藏", invalid: "失效路径" }[activeNav] || "资料库";
}

function getEmptyTitle({ activeNav, directoryView, searchQuery, filters }) {
  if (searchQuery) return "没有找到匹配的资料";
  if (filters.type || filters.tags.length || filters.groupIds.length) return "没有符合筛选条件的资料";
  if (directoryView) return "文件夹为空";
  if (activeNav === "favorites") return "还没有收藏的资料";
  if (activeNav === "invalid") return "没有失效路径";
  if (activeNav === "recent") return "还没有最近添加的资料";
  return "还没有登记资料";
}

function getEmptyDescription({ activeNav, directoryView, searchQuery, filters }) {
  if (searchQuery) return "可以清空搜索，或导入新的资料。";
  if (filters.type || filters.tags.length || filters.groupIds.length) return "清除筛选，或调整类型、标签和分组。";
  if (directoryView) return "返回上一级，或选择其他文件夹继续浏览。";
  if (activeNav === "favorites") return "在资料行操作中添加收藏。";
  if (activeNav === "invalid") return "失效记录会在原路径不可用时显示。";
  return "从上方选择文件或文件夹开始建立索引。";
}

function getEmptyActions({ activeNav, directoryView, searchQuery, filters, onClearSearch, onClearFilters, onOpenBreadcrumb, onImport, onManageGroups }) {
  if (searchQuery) return <button type="button" className="text-button" onClick={onClearSearch}>清空搜索</button>;
  if (filters.type || filters.tags.length || filters.groupIds.length) return <button type="button" className="text-button" onClick={onClearFilters}>清除筛选</button>;
  if (directoryView) return <button type="button" className="text-button" onClick={() => onOpenBreadcrumb(-1)}>返回资料库</button>;
  if (activeNav === "library" || activeNav === "favorites" || activeNav === "invalid") return <button type="button" className="text-button" onClick={onImport}>导入资料</button>;
  if (onManageGroups) return <button type="button" className="text-button" onClick={onManageGroups}>管理分组</button>;
  return null;
}

function EmptyState({ icon, title, description, actions }) {
  return <div className="empty-state">{icon}<strong>{title}</strong><span>{description}</span>{actions && <div className="empty-state-actions">{actions}</div>}</div>;
}
