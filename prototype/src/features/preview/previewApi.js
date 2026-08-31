import { invoke, isTauri } from "@tauri-apps/api/core";

function browserPreviewState(entry) {
  return {
    supported: false,
    kind: entry?.kind || "other",
    status: "unsupported",
    reason: "浏览器预览模式不会读取本地文件，请在桌面应用中打开资料。",
  };
}

export function canUsePreviewRuntime() {
  return isTauri();
}

export function getPreviewTarget(entry) {
  if (entry?.directoryId && Array.isArray(entry.relativePath)) {
    return {
      directoryId: entry.directoryId,
      relativePath: entry.relativePath,
    };
  }
  return { fileId: entry?.id || "" };
}

export function listDirectory(directoryId, relativePath = []) {
  return invoke("list_directory", {
    target: { directoryId, relativePath },
  });
}

export async function canPreview(entry) {
  if (!canUsePreviewRuntime() || !entry?.id) return browserPreviewState(entry);
  return invoke("can_preview", { target: getPreviewTarget(entry), kind: entry.kind });
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
  return invoke("load_preview", {
    target: getPreviewTarget(entry),
    kind: entry.kind,
    options,
  });
}

export function createPreviewTaskId() {
  if (globalThis.crypto?.randomUUID) return `preview-task-${globalThis.crypto.randomUUID()}`;
  return `preview-task-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function cancelPreviewTask(taskId) {
  if (!canUsePreviewRuntime() || !taskId) return Promise.resolve();
  return invoke("cancel_preview_task", { taskId });
}

export function disposePreview(previewId) {
  if (!canUsePreviewRuntime() || !previewId) return Promise.resolve();
  return invoke("dispose_preview", { previewId });
}
