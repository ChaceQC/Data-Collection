import {
  getPreviewTarget,
  invokeCommand,
  isDesktopRuntime,
  makeDirectoryTarget,
  parseDirectoryEntries,
  parsePreviewResult,
  parsePreviewSupport,
} from "../../lib/ipcContracts.js";

export { getPreviewTarget };

function browserPreviewState(entry) {
  return {
    supported: false,
    kind: entry?.kind || "other",
    status: "unsupported",
    reason: "浏览器预览模式不会读取本地文件，请在桌面应用中打开资料。",
  };
}

export function canUsePreviewRuntime() {
  return isDesktopRuntime();
}

export function listDirectory(directoryId, relativePath = []) {
  return invokeCommand("list_directory", { target: makeDirectoryTarget(directoryId, relativePath) }, parseDirectoryEntries);
}

export async function canPreview(entry) {
  if (!canUsePreviewRuntime() || !entry?.id) return browserPreviewState(entry);
  return invokeCommand("can_preview", { target: getPreviewTarget(entry), kind: entry.kind }, parsePreviewSupport);
}

export async function loadPreview(entry, options = {}) {
  if (!canUsePreviewRuntime() || !entry?.id) {
    return {
      previewId: "",
      kind: entry?.kind || "other",
      status: "unsupported",
      content: null,
      byteLength: 0,
      reason: browserPreviewState(entry).reason,
    };
  }
  return invokeCommand("load_preview", {
    target: getPreviewTarget(entry),
    kind: entry.kind,
    options,
  }, parsePreviewResult);
}

export function createPreviewTaskId() {
  if (globalThis.crypto?.randomUUID) return `preview-task-${globalThis.crypto.randomUUID()}`;
  return `preview-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cancelPreviewTask(taskId) {
  if (!canUsePreviewRuntime() || !taskId) return Promise.resolve();
  return invokeCommand("cancel_preview_task", { taskId });
}

export function disposePreview(previewId) {
  if (!canUsePreviewRuntime() || !previewId) return Promise.resolve();
  return invokeCommand("dispose_preview", { previewId });
}
