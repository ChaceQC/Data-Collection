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

export async function canPreview(entry) {
  if (!canUsePreviewRuntime() || !entry?.path) return browserPreviewState(entry);
  return invoke("can_preview", { path: entry.path, kind: entry.kind });
}

export async function loadPreview(entry, options = {}) {
  if (!canUsePreviewRuntime() || !entry?.path) {
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
    path: entry.path,
    kind: entry.kind,
    options,
  });
}

export function disposePreview(previewId) {
  if (!canUsePreviewRuntime() || !previewId) return Promise.resolve();
  return invoke("dispose_preview", { previewId });
}
