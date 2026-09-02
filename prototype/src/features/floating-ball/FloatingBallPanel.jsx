import {
  ArrowClockwise,
  ArrowSquareOut,
  Clock,
  FileText,
  Files,
  FolderSimple,
  Funnel,
  MagnifyingGlass,
  SpinnerGap,
  Star,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import { getFloatingLibraryCountPresentation } from "./floatingBallModel.js";

export function FloatingBallPanel({
  entries = [],
  entriesStatus = "ready",
  emptyState = "library",
  libraryCount,
  libraryCountStatus = "loading",
  status,
  feedback,
  favoriteBusyId,
  onOpenFile,
  onToggleFavorite,
  onRetry,
  onClearSearch,
  onClose,
  onPointerEnter,
  onPointerLeave,
}) {
  const count = getFloatingLibraryCountPresentation(libraryCount, libraryCountStatus);

  return (
    <section
      className="floating-ball-panel"
      aria-label="悬浮球文件库"
      data-testid="floating-panel"
      data-library-count-state={count.state}
      data-panel-state={entriesStatus}
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

      <div className="floating-ball-query-area" aria-label="文件库查询结构">
        <div className="floating-ball-search-placeholder" aria-hidden="true" data-testid="floating-ball-search-placeholder">
          <MagnifyingGlass size={15} weight="bold" />
          <span>搜索文件库</span>
        </div>
        <div className="floating-ball-filter-placeholder" aria-hidden="true" data-testid="floating-ball-filter-placeholder">
          <Funnel size={14} weight="bold" />
          <span>全部资料</span>
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

      {entriesStatus === "loading" ? (
        <FloatingBallListSkeleton />
      ) : entriesStatus === "error" ? (
        <div className="floating-ball-empty floating-ball-error-state" role="alert">
          <WarningCircle size={26} weight="fill" aria-hidden="true" />
          <strong>文件库读取失败</strong>
          <span>请重试后再查看资料</span>
          <button type="button" className="floating-ball-empty-action" onClick={onRetry}>
            <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
            <span>重新读取</span>
          </button>
        </div>
      ) : entries.length ? (
        <ul className="floating-ball-list" aria-label="文件库条目">
          {entries.map((entry) => (
            <li key={entry.id}>
              <div className="floating-ball-entry-row">
                <button
                  type="button"
                  className="floating-ball-entry-item"
                  title={entry.name}
                  aria-label={entry.name + "，" + (entry.invalid ? "路径失效" : entry.type || "已登记")}
                  onClick={() => onOpenFile(entry)}
                >
                  <span className={"floating-ball-file-icon floating-ball-file-icon-" + entry.kind} aria-hidden="true">
                    {entry.kind === "folder" ? <FolderSimple size={20} weight="regular" /> : <FileText size={20} weight="regular" />}
                  </span>
                  <span className="floating-ball-entry-copy">
                    <strong>{entry.name}</strong>
                    <small>{entry.invalid ? "路径失效" : entry.type || "已登记"}</small>
                  </span>
                  <ArrowSquareOut className="floating-ball-open-icon" size={16} weight="regular" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={"floating-ball-favorite-button" + (entry.favorite ? " is-favorite" : "")}
                  aria-label={(entry.favorite ? "取消收藏" : "收藏") + "：" + entry.name}
                  aria-pressed={Boolean(entry.favorite)}
                  title={entry.favorite ? "取消收藏" : "收藏"}
                  disabled={Boolean(favoriteBusyId)}
                  onClick={() => onToggleFavorite(entry)}
                >
                  <Star size={17} weight={entry.favorite ? "fill" : "regular"} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="floating-ball-empty">
          <Files size={26} weight="regular" aria-hidden="true" />
          <strong>{emptyState === "search" ? "没有匹配的资料" : "文件库暂无资料"}</strong>
          <span>{emptyState === "search" ? "请换个关键词或清除搜索" : "已登记的资料会显示在这里"}</span>
          {emptyState === "search" && (
            <button type="button" className="floating-ball-empty-action" onClick={onClearSearch}>
              <X size={15} weight="bold" aria-hidden="true" />
              <span>清除搜索</span>
            </button>
          )}
        </div>
      )}
    </section>
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
