import { useState } from "react";
import {
  ArrowClockwise,
  CaretDown,
  CaretUp,
  CheckCircle,
  Clock,
  TrashSimple,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  getOperationLabel,
  getOperationResultName,
  getOperationStatusLabel,
  getOperationSummary,
} from "./operationModel.js";

const TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

export function OperationCenter({ records = [], files = [], loading = false, warning = "", onClear, onRetry }) {
  const [open, setOpen] = useState(false);
  const [expandedId, setExpandedId] = useState("");
  const activeCount = records.filter((record) => record.status === "in-progress").length;

  function toggleRecord(id) {
    setExpandedId((current) => current === id ? "" : id);
  }

  return (
    <div className="operation-center" data-tauri-drag-region="false">
      <button
        type="button"
        className="operation-center-trigger"
        aria-expanded={open}
        aria-controls="operation-center-panel"
        data-tauri-drag-region="false"
        onClick={() => setOpen((current) => !current)}
      >
        <Clock size={17} weight="regular" aria-hidden="true" />
        <span>操作中心</span>
        {activeCount > 0 && <strong aria-label={`${activeCount} 项进行中`}>{activeCount}</strong>}
        {open ? <CaretUp size={15} weight="bold" aria-hidden="true" /> : <CaretDown size={15} weight="bold" aria-hidden="true" />}
      </button>

      {open && (
        <section id="operation-center-panel" className="operation-center-panel" aria-label="操作中心记录">
          <header className="operation-center-header">
            <div>
              <strong>操作记录</strong>
              <span>{loading ? "正在读取历史" : `${records.length} 条记录`}</span>
            </div>
            <button type="button" className="icon-button" aria-label="清除操作历史" title="清除操作历史" disabled={!records.length || loading} onClick={() => void onClear?.()}>
              <TrashSimple size={16} weight="regular" aria-hidden="true" />
            </button>
          </header>
          {warning && <p className="operation-center-warning" role="alert">{warning}</p>}
          {!records.length ? (
            <div className="operation-center-empty"><Clock size={22} weight="regular" aria-hidden="true" /><span>{loading ? "正在读取操作历史" : "暂时没有操作记录"}</span></div>
          ) : (
            <ul className="operation-record-list">
              {records.map((record) => {
                const expanded = expandedId === record.id;
                const detailsId = `operation-details-${record.id}`;
                return (
                  <li className={`operation-record operation-record-${record.status}`} key={record.id}>
                    <button type="button" className="operation-record-summary" aria-expanded={expanded} aria-controls={detailsId} onClick={() => toggleRecord(record.id)}>
                      <OperationStatusIcon status={record.status} />
                      <span className="operation-record-copy">
                        <strong>{getOperationLabel(record.operation)}</strong>
                        <span>{getOperationStatusLabel(record.status)} · {getOperationSummary(record)}</span>
                      </span>
                      <time dateTime={record.startedAt ? new Date(record.startedAt).toISOString() : undefined}>{formatTime(record.startedAt)}</time>
                      {expanded ? <CaretUp size={15} weight="bold" aria-hidden="true" /> : <CaretDown size={15} weight="bold" aria-hidden="true" />}
                    </button>
                    {expanded && (
                      <div id={detailsId} className="operation-record-details">
                        {record.message && <p className="operation-record-message">{record.message}</p>}
                        {record.operation === "import" && record.skippedReasons.length > 0 && <p>跳过原因：{record.skippedReasons.join("、")}</p>}
                        {record.results.length > 0 && (
                          <ul className="operation-item-list">
                            {record.results.map((item) => (
                              <li key={`${record.id}-${item.id}`}>
                                <span className={`operation-item-status operation-item-${item.status}`}>{getItemStatusLabel(item.status)}</span>
                                <span title={getOperationResultName(item, files)}>{getOperationResultName(item, files)}</span>
                                {item.reason && <small>{item.reason}</small>}
                              </li>
                            ))}
                          </ul>
                        )}
                        {record.retryableIds.length > 0 && onRetry && (
                          <button type="button" className="operation-retry-button" disabled={record.status === "in-progress"} onClick={() => void onRetry(record)}>
                            <ArrowClockwise size={15} weight="bold" aria-hidden="true" />
                            <span>重试失败项（{record.retryableIds.length}）</span>
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <button type="button" className="operation-center-close" aria-label="关闭操作中心" onClick={() => setOpen(false)}><X size={14} weight="bold" aria-hidden="true" /><span>关闭</span></button>
        </section>
      )}
    </div>
  );
}

function OperationStatusIcon({ status }) {
  if (status === "success") return <CheckCircle className="operation-status-icon" size={18} weight="fill" aria-hidden="true" />;
  if (status === "in-progress" || status === "timed-out") return <Clock className="operation-status-icon" size={18} weight="regular" aria-hidden="true" />;
  if (status === "cancelled") return <X className="operation-status-icon" size={18} weight="bold" aria-hidden="true" />;
  return <WarningCircle className="operation-status-icon" size={18} weight="fill" aria-hidden="true" />;
}

function getItemStatusLabel(status) {
  return status === "success" ? "成功" : status === "failed" ? "失败" : "跳过";
}

function formatTime(value) {
  if (!Number.isFinite(value) || value <= 0) return "刚刚";
  return TIME_FORMATTER.format(new Date(value));
}
