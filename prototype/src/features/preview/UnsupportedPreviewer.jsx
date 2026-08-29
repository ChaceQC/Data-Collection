import { WarningCircle } from "@phosphor-icons/react";
import { getPreviewStatusLabel } from "./previewTypes";

export function UnsupportedPreviewer({ status, reason }) {
  return (
    <div className="preview-status-state" data-testid="preview-status">
      <WarningCircle size={42} weight="regular" aria-hidden="true" />
      <strong>{getPreviewStatusLabel(status)}</strong>
      <span>{reason || "请选择其他资料，或重新导入当前文件。"}</span>
    </div>
  );
}
