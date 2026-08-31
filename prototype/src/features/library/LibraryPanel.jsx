import { useEffect, useMemo, useState } from "react";
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
import { LibraryRowActions } from "./LibraryActions";
import {
  DEFAULT_SORT,
  PAGE_SIZE,
  SORT_OPTIONS,
  filterEntries,
  formatFileSize,
  getDisplayType,
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
  return (
    <span className={`file-type-icon file-type-icon-${kind}`} aria-hidden="true">
      <Icon size={25} weight="regular" />
    </span>
  );
}

export function LibraryPanel({
  files,
  activeNav,
  searchQuery,
  onSearchQueryChange,
  sort = DEFAULT_SORT,
  onSortChange,
  pageSize = PAGE_SIZE,
  selectedId,
  onSelectionChange,
  directoryView,
  directoryLoading,
  indexReady,
  refreshing,
  refreshError,
  onRefresh,
  busyFileId,
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
  const sourceEntries = directoryView?.entries || files;
  const directoryViewKey = directoryView?.trail?.map((folder) => folder.id).join("/") || "";
  const visibleFiles = useMemo(() => {
    const filtered = filterEntries(sourceEntries, {
      activeNav,
      query: searchQuery,
      directory: Boolean(directoryView),
    });
    const directorySort = sort.key === "addedAt" ? { key: "name", direction: "asc" } : sort;
    return sortEntries(filtered, directoryView ? directorySort : sort);
  }, [activeNav, directoryView, searchQuery, sort, sourceEntries]);
  const page = useMemo(() => paginateEntries(visibleFiles, currentPage, pageSize), [currentPage, pageSize, visibleFiles]);

  useEffect(() => {
    setCurrentPage(1);
  }, [activeNav, directoryViewKey, pageSize, searchQuery, sort]);

  useEffect(() => {
    if (selectedId && visibleFiles.some((file) => file.id === selectedId)) return;
    onSelectionChange(visibleFiles[0]?.id || "");
  }, [onSelectionChange, selectedId, visibleFiles]);

  const heading = directoryView ? (
    <nav id="recent-title" className="folder-breadcrumbs" aria-label="文件夹路径">
      <button type="button" className="breadcrumb-button" onClick={() => onOpenBreadcrumb(-1)}>
        <ArrowLeft size={17} weight="regular" />
        <span>资料库</span>
      </button>
      {directoryView.trail.map((folder, index) => (
        <span className="breadcrumb-segment" key={folder.id}>
          <CaretRight size={14} weight="regular" aria-hidden="true" />
          <button type="button" className="breadcrumb-button" onClick={() => onOpenBreadcrumb(index)}>
            {folder.name}
          </button>
        </span>
      ))}
    </nav>
  ) : (
    <div>
      <h2 id="recent-title">{activeNav === "library" ? "资料库" : getNavigationLabel(activeNav)}</h2>
    </div>
  );

  return (
    <section className="recent-section" aria-labelledby="recent-title" data-tauri-drag-region="false">
      <div className="section-heading-row">
        {heading}
        <div className="section-heading-actions">
          <span className="result-count">共 {visibleFiles.length} 项</span>
          {onRefresh && (
            <button
              type="button"
              className="icon-button"
              aria-label="刷新索引"
              title="刷新索引"
              aria-busy={refreshing}
              disabled={refreshing || !indexReady}
              onClick={onRefresh}
            >
              <ArrowClockwise size={17} weight="bold" className={refreshing ? "is-spinning" : ""} />
            </button>
          )}
        </div>
      </div>
      {refreshError && <div className="inline-error" role="alert">{refreshError}</div>}
      <div className="library-toolbar">
        <label className="search-field">
          <MagnifyingGlass size={17} weight="regular" aria-hidden="true" />
          <span className="sr-only">搜索资料</span>
          <input
            aria-label="搜索资料"
            value={searchQuery}
            placeholder="搜索名称、类型或状态"
            onChange={(event) => onSearchQueryChange(event.target.value)}
          />
          {searchQuery && (
            <button type="button" className="search-clear-button" aria-label="清空搜索" title="清空搜索" onClick={() => onSearchQueryChange("")}>
              <X size={15} weight="bold" />
            </button>
          )}
        </label>
        <div className="sort-controls">
          <label className="sort-control">
            <span>排序</span>
            <select
              aria-label="排序字段"
              value={sort.key}
              onChange={(event) => onSortChange({ ...sort, key: event.target.value })}
            >
              {SORT_OPTIONS.map((option) => (
                <option value={option.key} key={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="sort-direction-button"
            aria-label={sort.direction === "asc" ? "升序" : "降序"}
            title={sort.direction === "asc" ? "升序" : "降序"}
            onClick={() => onSortChange({ ...sort, direction: sort.direction === "asc" ? "desc" : "asc" })}
          >
            {sort.direction === "asc" ? <CaretUp size={17} weight="bold" /> : <CaretDown size={17} weight="bold" />}
          </button>
        </div>
      </div>

      {!indexReady ? (
        <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取本地索引" description="请稍候。" />
      ) : directoryLoading ? (
        <EmptyState icon={<Clock size={28} weight="regular" />} title="正在读取文件夹" description="请稍候。" />
      ) : visibleFiles.length ? (
        <div className="file-table">
          <div className="file-table-scroll" data-testid="recent-list">
            <div className="file-row file-row-header" aria-hidden="true">
              <span>名称</span>
              <span>类型</span>
              <span>大小</span>
              <span>状态</span>
              <span>修改时间</span>
              <span>操作</span>
            </div>
            {page.entries.map((file) => (
              <div
                className={`file-row ${selectedId === file.id ? "is-selected" : ""}`}
                key={file.id}
                role="button"
                tabIndex={0}
                onClick={() => onRowClick(file)}
                onKeyDown={(event) => onRowKeyDown(event, file)}
              >
                <div className="file-name-cell">
                  <FileTypeIcon kind={file.kind} />
                  <span className="file-name" title={file.name}>{file.name}</span>
                </div>
                <span className="file-type" title={getDisplayType(file)}>{getDisplayType(file)}</span>
                <span className="file-size">{file.kind === "folder" ? "—" : formatFileSize(file.size)}</span>
                <span className={`file-status ${file.invalid ? "status-invalid" : "status-registered"}`}>
                  {file.invalid ? (
                    <button type="button" className="reposition-button reposition-button-invalid" onClick={(event) => {
                      event.stopPropagation();
                      onReposition(file);
                    }}>
                      {file.status} · 重新定位
                    </button>
                  ) : (
                    <span>{file.status}</span>
                  )}
                </span>
                <span className="file-modified">{getModifiedLabel(file)}</span>
                <LibraryRowActions
                  file={file}
                  persistent={!directoryView}
                  busy={busyFileId === file.id}
                  onFavorite={onFavorite}
                  onRemove={onRemove}
                  onCopy={onCopy}
                  onRename={onRename}
                  onDelete={onDelete}
                  onOpenDefault={onOpenDefault}
                  onReveal={onReveal}
                />
              </div>
            ))}
          </div>
          {page.pageCount > 1 && (
            <nav className="pagination" aria-label="分页">
              <button type="button" className="pagination-button" aria-label="上一页" title="上一页" disabled={page.page === 1} onClick={() => setCurrentPage((value) => Math.max(1, value - 1))}>
                <CaretLeft size={16} weight="regular" />
                <span>上一页</span>
              </button>
              <span className="pagination-status">第 {page.page} / {page.pageCount} 页 · 共 {visibleFiles.length} 项</span>
              <button type="button" className="pagination-button" aria-label="下一页" title="下一页" disabled={page.page === page.pageCount} onClick={() => setCurrentPage((value) => Math.min(page.pageCount, value + 1))}>
                <span>下一页</span>
                <CaretRight size={16} weight="regular" />
              </button>
            </nav>
          )}
        </div>
      ) : (
        <EmptyState
          icon={<MagnifyingGlass size={28} weight="regular" />}
          title={getEmptyTitle({ activeNav, directoryView, searchQuery })}
          description={getEmptyDescription({ activeNav, directoryView, searchQuery })}
        />
      )}
    </section>
  );
}

function getModifiedLabel(file) {
  if (file.modified) return file.modified;
  if (!Number.isFinite(file.modifiedAt) || file.modifiedAt <= 0) return "未知";
  return MODIFIED_FORMATTER.format(new Date(file.modifiedAt * 1000));
}

function getNavigationLabel(activeNav) {
  return { recent: "最近添加", favorites: "收藏", invalid: "失效路径" }[activeNav] || "资料库";
}

function getEmptyTitle({ activeNav, directoryView, searchQuery }) {
  if (searchQuery) return "没有找到匹配的资料";
  if (directoryView) return "文件夹为空";
  if (activeNav === "favorites") return "还没有收藏的资料";
  if (activeNav === "invalid") return "没有失效路径";
  if (activeNav === "recent") return "还没有最近添加的资料";
  return "还没有登记资料";
}

function getEmptyDescription({ activeNav, directoryView, searchQuery }) {
  if (searchQuery) return "试试其他关键词，或从上方导入新的文件。";
  if (directoryView) return "选择其他文件夹继续浏览。";
  if (activeNav === "favorites") return "在资料行操作中添加收藏。";
  if (activeNav === "invalid") return "失效记录会在原路径不可用时显示。";
  return "从上方选择文件或文件夹开始建立索引。";
}

function EmptyState({ icon, title, description }) {
  return (
    <div className="empty-state">
      {icon}
      <strong>{title}</strong>
      <span>{description}</span>
    </div>
  );
}
