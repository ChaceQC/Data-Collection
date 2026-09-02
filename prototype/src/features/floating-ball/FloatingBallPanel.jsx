import {
  ArrowClockwise,
  ArrowDown,
  ArrowSquareOut,
  ArrowUp,
  CaretLeft,
  CaretRight,
  Clock,
  Eye,
  FileText,
  Files,
  FolderOpen,
  FolderSimple,
  Funnel,
  MagnifyingGlass,
  SpinnerGap,
  Star,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { getFloatingLibraryCountPresentation } from "./floatingBallModel.js";
import {
  FLOATING_LIBRARY_MAX_QUERY_CHARS,
  formatFloatingFileSize,
  formatFloatingTimestamp,
  getFloatingPageSummary,
} from "./floatingLibraryModel.js";

const FILTER_OPTIONS = Object.freeze([
  { value: "all", label: "全部" },
  { value: "favorite", label: "收藏" },
  { value: "folder", label: "文件夹" },
  { value: "invalid", label: "失效" },
]);

const SORT_OPTIONS = Object.freeze([
  { value: "name", label: "名称" },
  { value: "type", label: "类型" },
  { value: "modifiedAt", label: "修改时间" },
  { value: "lastOpenedAt", label: "最近打开" },
]);

export function FloatingBallPanel({
  files = [],
  filesStatus = "ready",
  filesRefreshing = false,
  query,
  searchInput = "",
  total = 0,
  page,
  emptyState = "library",
  libraryCount,
  libraryCountStatus = "loading",
  status,
  feedback,
  favoriteBusyId,
  actionBusyId,
  onOpenFile,
  onPreviewFile,
  onReveal,
  onOpenLibrary,
  onToggleFavorite,
  onSearchChange,
  onFilterChange,
  onSortKeyChange,
  onDirectionToggle,
  onPreviousPage,
  onNextPage,
  onRetry,
  onClearSearch,
  onClearFilters,
  onClose,
  onPointerEnter,
  onPointerLeave,
}) {
  const count = getFloatingLibraryCountPresentation(libraryCount, libraryCountStatus);
  const activeFilter = query?.filter || "all";
  const activeSortKey = query?.sortKey || "name";
  const direction = query?.direction || "asc";
  const pageSummary = page || getFloatingPageSummary(query?.offset, query?.limit, total);
  const hasActiveSearch = Boolean(searchInput);
  const hasActiveFilter = activeFilter !== "all";

  return (
    <section
      className="floating-ball-panel"
      aria-label="悬浮球文件库"
      data-testid="floating-panel"
      data-library-count-state={count.state}
      data-panel-state={filesStatus}
      data-filter={activeFilter}
      data-sort-key={activeSortKey}
      data-sort-direction={direction}
      data-page={pageSummary.page}
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header className="floating-ball-panel-header">
        <div className="floating-ball-panel-heading">
          <span className="floating-ball-eyebrow">本地资料工作台</span>
          <h2>文件库</h2>
        </div>
        <div className="floating-ball-header-actions">
          <span
            className={"floating-ball-count floating-ball-count-" + count.state}
            aria-label={count.label}
            title={count.label}
            data-testid="floating-ball-count"
          >
            {count.state === "loading" ? <SpinnerGap className="is-spinning" size={13} weight="bold" aria-hidden="true" /> : count.display}
          </span>
          <button
            type="button"
            className="floating-ball-panel-close"
            aria-label="收起文件库"
            title="收起"
            onClick={onClose}
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="floating-ball-query-area" aria-label="文件库查询">
        <div className="floating-ball-search-field">
          <MagnifyingGlass size={15} weight="bold" aria-hidden="true" />
          <input
            type="search"
            value={searchInput}
            maxLength={FLOATING_LIBRARY_MAX_QUERY_CHARS}
            aria-label="搜索文件库"
            placeholder="搜索名称、类型、标签或分组"
            onChange={(event) => onSearchChange(event.target.value)}
          />
          {hasActiveSearch && (
            <button
              type="button"
              className="floating-ball-search-clear"
              aria-label="清除搜索"
              title="清除搜索"
              onClick={onClearSearch}
            >
              <X size={13} weight="bold" aria-hidden="true" />
            </button>
          )}
        </div>

        <div className="floating-ball-filter-row">
          <span className="floating-ball-filter-label"><Funnel size={14} weight="bold" aria-hidden="true" />筛选</span>
          <div className="floating-ball-filter-buttons" role="group" aria-label="文件库筛选">
            {FILTER_OPTIONS.map((option) => (
              <button
                type="button"
                key={option.value}
                className={"floating-ball-filter-button" + (activeFilter === option.value ? " is-active" : "")}
                aria-pressed={activeFilter === option.value}
                onClick={() => onFilterChange(option.value)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <div className="floating-ball-sort-row">
          <label className="floating-ball-sort-field">
            <span>排序</span>
            <select aria-label="文件库排序方式" value={activeSortKey} onChange={(event) => onSortKeyChange(event.target.value)}>
              {SORT_OPTIONS.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="floating-ball-sort-direction"
            aria-label={direction === "asc" ? "升序，点击切换为降序" : "降序，点击切换为升序"}
            title={direction === "asc" ? "升序，点击切换为降序" : "降序，点击切换为升序"}
            onClick={onDirectionToggle}
          >
            {direction === "asc" ? <ArrowUp size={16} weight="bold" aria-hidden="true" /> : <ArrowDown size={16} weight="bold" aria-hidden="true" />}
          </button>
          <span className="floating-ball-sort-state">{direction === "asc" ? "升序" : "降序"}</span>
        </div>
      </div>

      {feedback && (
        <div className={"floating-ball-feedback floating-ball-feedback-" + status} role="status" aria-live="polite">
          {status === "partial-error" || status === "error" ? (
            <WarningCircle size={16} weight="fill" aria-hidden="true" />
          ) : (
            <Clock size={16} weight="fill" aria-hidden="true" />
          )}
          <span>{feedback}</span>
        </div>
      )}

      {filesStatus === "loading" ? (
        <FloatingBallListSkeleton />
      ) : filesStatus === "error" ? (
        <div className="floating-ball-empty floating-ball-error-state" role="alert">
          <WarningCircle size={26} weight="fill" aria-hidden="true" />
          <strong>文件库读取失败</strong>
          <span>请重试后再查看资料</span>
          <button type="button" className="floating-ball-empty-action" onClick={onRetry}>
            <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
            <span>重新读取</span>
          </button>
        </div>
      ) : files.length ? (
        <ul className="floating-ball-list" aria-label="文件库条目">
          {files.map((file) => <FloatingBallFileRow key={file.id} file={file} favoriteBusyId={favoriteBusyId} actionBusyId={actionBusyId} onOpenFile={onOpenFile} onPreviewFile={onPreviewFile} onReveal={onReveal} onToggleFavorite={onToggleFavorite} />)}
        </ul>
      ) : (
        <FloatingBallEmptyState
          emptyState={emptyState}
          hasActiveFilter={hasActiveFilter}
          hasActiveSearch={hasActiveSearch}
          onOpenLibrary={onOpenLibrary}
          onClearSearch={onClearSearch}
          onClearFilters={onClearFilters}
        />
      )}

      {filesStatus !== "error" && (
        <footer className="floating-ball-pagination" aria-label="文件库分页">
          <div className="floating-ball-page-summary">
            <span>{pageSummary.start ? `${pageSummary.start}-${pageSummary.end} / ${total}` : "0 项"}</span>
            {filesRefreshing && <SpinnerGap className="is-spinning" size={13} weight="bold" aria-label="正在刷新" />}
          </div>
          <span className="floating-ball-page-number">第 {pageSummary.page} / {pageSummary.pageCount} 页</span>
          <div className="floating-ball-page-controls">
            <button
              type="button"
              className="floating-ball-page-button"
              aria-label="上一页"
              title="上一页"
              disabled={pageSummary.page <= 1 || filesRefreshing}
              onClick={onPreviousPage}
            >
              <CaretLeft size={16} weight="bold" aria-hidden="true" />
            </button>
            <button
              type="button"
              className="floating-ball-page-button"
              aria-label="下一页"
              title="下一页"
              disabled={pageSummary.page >= pageSummary.pageCount || filesRefreshing}
              onClick={onNextPage}
            >
              <CaretRight size={16} weight="bold" aria-hidden="true" />
            </button>
          </div>
        </footer>
      )}
    </section>
  );
}

function FloatingBallFileRow({ file, favoriteBusyId, actionBusyId, onOpenFile, onPreviewFile, onReveal, onToggleFavorite }) {
  const typeLabel = file.kind === "folder" ? "文件夹" : file.type || "已登记";
  const statusLabel = file.invalid ? "路径失效" : file.status || "已登记";
  const sizeLabel = file.kind === "folder" ? "文件夹" : formatFloatingFileSize(file.size);
  const groupLabel = file.groupName || "未分组";
  const modifiedLabel = formatFloatingTimestamp(file.modifiedAt, "未记录");
  const isFavoriteBusy = favoriteBusyId === file.id;
  const isActionBusy = actionBusyId === file.id;

  return (
    <li className={"floating-ball-entry" + (file.invalid ? " is-invalid" : "")}>
      <div className="floating-ball-entry-row">
        <button
          type="button"
          className="floating-ball-entry-item"
          title={file.name}
          aria-label={`${file.name}，${typeLabel}，${statusLabel}，在主窗口中定位`}
          onClick={() => onOpenFile(file)}
        >
          <span className={"floating-ball-file-icon floating-ball-file-icon-" + file.kind} aria-hidden="true">
            {file.kind === "folder" ? <FolderSimple size={20} weight="regular" /> : <FileText size={20} weight="regular" />}
          </span>
          <span className="floating-ball-entry-copy">
            <strong>{file.name}</strong>
            <small className="floating-ball-entry-meta" title={`${typeLabel} · ${sizeLabel} · ${groupLabel}`}>
              {typeLabel} · {sizeLabel} · {groupLabel}
            </small>
            <small className={"floating-ball-entry-status" + (file.invalid ? " is-invalid" : "")}>
              <span>{statusLabel}</span>
              <span>修改 {modifiedLabel}</span>
            </small>
          </span>
          <ArrowSquareOut className="floating-ball-open-icon" size={16} weight="regular" aria-hidden="true" />
        </button>
        <div className="floating-ball-entry-actions" role="group" aria-label={`${file.name} 快捷操作`}>
          {!file.invalid && file.kind !== "folder" && (
            <button
              type="button"
              className="floating-ball-entry-action"
              aria-label={`直接预览：${file.name}`}
              title="直接预览"
              aria-busy={isActionBusy}
              disabled={Boolean(actionBusyId)}
              onClick={(event) => { event.stopPropagation(); onPreviewFile?.(file); }}
            >
              <Eye size={16} weight="regular" aria-hidden="true" />
            </button>
          )}
          <button
            type="button"
            className="floating-ball-entry-action"
            aria-label={`在资源管理器中显示：${file.name}`}
            title="在资源管理器中显示"
            aria-busy={isActionBusy}
            disabled={Boolean(actionBusyId)}
            onClick={(event) => { event.stopPropagation(); onReveal?.(file); }}
          >
            <FolderOpen size={16} weight="regular" aria-hidden="true" />
          </button>
          <button
            type="button"
            className={"floating-ball-favorite-button" + (file.favorite ? " is-favorite" : "")}
            aria-label={(file.favorite ? "取消收藏" : "收藏") + "：" + file.name}
            aria-pressed={Boolean(file.favorite)}
            aria-busy={isFavoriteBusy}
            title={file.favorite ? "取消收藏" : "收藏"}
            disabled={Boolean(favoriteBusyId) || Boolean(actionBusyId)}
            onClick={(event) => { event.stopPropagation(); onToggleFavorite?.(file); }}
          >
            {isFavoriteBusy ? <SpinnerGap className="is-spinning" size={16} weight="bold" aria-hidden="true" /> : <Star size={17} weight={file.favorite ? "fill" : "regular"} aria-hidden="true" />}
          </button>
        </div>
      </div>
    </li>
  );
}

function FloatingBallEmptyState({ emptyState, hasActiveFilter, hasActiveSearch, onOpenLibrary, onClearSearch, onClearFilters }) {
  const filtered = emptyState !== "library";
  return (
    <div className="floating-ball-empty">
      <Files size={26} weight="regular" aria-hidden="true" />
      <strong>{filtered ? "没有匹配的资料" : "文件库暂无资料"}</strong>
      <span>{filtered ? "请换个关键词或清除当前条件" : "已登记的资料会显示在这里"}</span>
      {hasActiveSearch ? (
        <button type="button" className="floating-ball-empty-action" onClick={onClearSearch}>
          <X size={15} weight="bold" aria-hidden="true" />
          <span>清除搜索</span>
        </button>
      ) : hasActiveFilter ? (
        <button type="button" className="floating-ball-empty-action" onClick={onClearFilters}>
          <X size={15} weight="bold" aria-hidden="true" />
          <span>重置筛选</span>
        </button>
      ) : (
        <button type="button" className="floating-ball-empty-action" onClick={onOpenLibrary}>
          <FolderOpen size={15} weight="bold" aria-hidden="true" />
          <span>打开主窗口资料库</span>
        </button>
      )}
    </div>
  );
}

function FloatingBallListSkeleton() {
  return (
    <div className="floating-ball-list floating-ball-list-skeleton" aria-busy="true" aria-label="正在读取文件库" data-testid="floating-ball-loading">
      {[0, 1, 2, 3].map((item) => (
        <div className="floating-ball-skeleton-row" key={item} aria-hidden="true">
          <span className="floating-ball-skeleton-icon" />
          <span className="floating-ball-skeleton-copy">
            <span />
            <span />
          </span>
          <span className="floating-ball-skeleton-action" />
        </div>
      ))}
    </div>
  );
}
