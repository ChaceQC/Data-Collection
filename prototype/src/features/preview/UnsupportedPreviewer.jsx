import {
  ArrowClockwise,
  ArrowLeft,
  ArrowSquareOut,
  FolderOpen,
  Info,
  MapPin,
  WarningCircle,
} from "@phosphor-icons/react";
import { getPreviewFailureActions, getPreviewStatusLabel } from "./previewTypes";

const ACTION_DEFINITIONS = Object.freeze({
  retry: { label: "重试预览", icon: ArrowClockwise, callback: "onRetry" },
  reposition: { label: "重新定位", icon: MapPin, callback: "onReposition" },
  "open-default": { label: "用默认程序打开", icon: ArrowSquareOut, callback: "onOpenDefault" },
  reveal: { label: "在资源管理器中定位", icon: FolderOpen, callback: "onReveal" },
  close: { label: "返回列表", icon: ArrowLeft, callback: "onClose" },
});

export function UnsupportedPreviewer({
  status,
  reason,
  demoOnly = false,
  isDirectoryEntry = false,
  onRetry,
  onReposition,
  onOpenDefault,
  onReveal,
  onClose,
}) {
  const callbacks = { onRetry, onReposition, onOpenDefault, onReveal, onClose };
  const StatusIcon = demoOnly ? Info : WarningCircle;
  const actions = getPreviewFailureActions(status, { demoOnly, isDirectoryEntry })
    .filter((action) => typeof callbacks[ACTION_DEFINITIONS[action]?.callback] === "function");

  return (
    <div className="preview-status-state" data-testid="preview-status" data-runtime={demoOnly ? "browser-demo" : "desktop"}>
      <StatusIcon className="preview-status-icon" size={42} weight="regular" aria-hidden="true" />
      <strong>{getPreviewStatusLabel(status, { demoOnly })}</strong>
      <span>{reason || "请选择其他资料，或重新导入当前文件。"}</span>
      {status === "converter-missing" && !demoOnly && (
        <small>DOC 预览需要本机安装 LibreOffice；应用不会自动安装或上传文档。</small>
      )}
      {actions.length > 0 && (
        <div className="preview-status-actions" role="group" aria-label="预览下一步操作">
          {actions.map((action) => {
            const definition = ACTION_DEFINITIONS[action];
            const Icon = definition.icon;
            return (
              <button
                type="button"
                key={action}
                className={`preview-status-action ${action === "close" ? "is-secondary" : ""}`}
                data-testid={`preview-action-${action}`}
                onClick={() => callbacks[definition.callback]?.()}
              >
                <Icon size={16} weight="regular" aria-hidden="true" />
                <span>{definition.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
