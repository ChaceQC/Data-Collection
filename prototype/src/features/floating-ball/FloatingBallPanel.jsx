import {
  ArrowSquareOut,
  Clock,
  FileText,
  FolderSimple,
  Star,
  WarningCircle,
  X,
} from "@phosphor-icons/react";

export function FloatingBallPanel({
  recent,
  status,
  feedback,
  favoriteBusyId,
  onOpenFile,
  onToggleFavorite,
  onClose,
  onPointerEnter,
  onPointerLeave,
}) {
  return (
    <section
      className="floating-ball-panel"
      aria-label="悬浮球最近记录"
      data-testid="floating-panel"
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <header className="floating-ball-panel-header">
        <div>
          <span className="floating-ball-eyebrow">本地资料工作台</span>
          <h2>最近记录</h2>
        </div>
        <div className="floating-ball-header-actions">
          <span className="floating-ball-count">{recent.length} / 5</span>
          <button
            type="button"
            className="floating-ball-panel-close"
            aria-label="收起最近记录"
            title="收起"
            onClick={onClose}
          >
            <X size={14} weight="bold" aria-hidden="true" />
          </button>
        </div>
      </header>

      {feedback && (
        <div className={`floating-ball-feedback floating-ball-feedback-${status}`} role="status">
          {status === "partial-error" || status === "error" ? (
            <WarningCircle size={16} weight="fill" />
          ) : (
            <Clock size={16} weight="fill" />
          )}
          <span>{feedback}</span>
        </div>
      )}

      {recent.length ? (
        <ul className="floating-ball-list">
          {recent.map((entry) => (
            <li key={entry.id}>
              <div className="floating-ball-recent-row">
                <button
                  type="button"
                  className="floating-ball-recent-item"
                  title={entry.name}
                  aria-label={`${entry.name}，${entry.invalid ? "路径失效" : entry.type || "已记录"}`}
                  onClick={() => onOpenFile(entry)}
                >
                  <span className={`floating-ball-file-icon floating-ball-file-icon-${entry.kind}`} aria-hidden="true">
                    {entry.kind === "folder" ? <FolderSimple size={20} weight="regular" /> : <FileText size={20} weight="regular" />}
                  </span>
                  <span className="floating-ball-recent-copy">
                    <strong>{entry.name}</strong>
                    <small>{entry.invalid ? "路径失效" : entry.type || "已登记"}</small>
                  </span>
                  <ArrowSquareOut className="floating-ball-open-icon" size={16} weight="regular" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className={`floating-ball-favorite-button ${entry.favorite ? "is-favorite" : ""}`}
                  aria-label={`${entry.favorite ? "取消收藏" : "收藏"}：${entry.name}`}
                  aria-pressed={Boolean(entry.favorite)}
                  title={entry.favorite ? "取消收藏" : "收藏"}
                  disabled={Boolean(favoriteBusyId)}
                  onClick={() => onToggleFavorite(entry)}
                >
                  <Star size={17} weight={entry.favorite ? "fill" : "regular"} />
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="floating-ball-empty">
          <FolderSimple size={24} weight="regular" />
          <strong>还没有悬浮球记录</strong>
          <span>拖入文件后会显示在这里</span>
        </div>
      )}
    </section>
  );
}
