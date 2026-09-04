import { getExtension, getFileKind, getFileType } from "../../lib/fileTypes.js";

export const LIBRARY_ACTION_TYPES = Object.freeze({
  remove: "remove",
  rename: "rename",
  delete: "delete",
});

export const MAX_TAGS_PER_ENTRY = 32;
export const MAX_DIRECT_INPUT_PATHS = 256;
export const MAX_DIRECT_INPUT_PATH_BYTES = 32 * 1024;
export const MAX_DIRECT_INPUT_TOTAL_BYTES = 4 * 1024 * 1024;

export function validateDirectPathInput(paths) {
  if (!Array.isArray(paths) || paths.length === 0) {
    return { valid: false, message: "请选择文件或文件夹", paths: [] };
  }
  if (paths.length > MAX_DIRECT_INPUT_PATHS) {
    return { valid: false, message: `一次最多处理 ${MAX_DIRECT_INPUT_PATHS} 条路径`, paths: [] };
  }

  const encoder = new TextEncoder();
  let totalBytes = 0;
  for (const path of paths) {
    if (typeof path !== "string" || path.length === 0) {
      return { valid: false, message: "路径输入包含空路径", paths: [] };
    }
    const byteLength = encoder.encode(path).length;
    if (byteLength > MAX_DIRECT_INPUT_PATH_BYTES) {
      return { valid: false, message: "单条路径长度超过上限", paths: [] };
    }
    totalBytes += byteLength;
    if (totalBytes > MAX_DIRECT_INPUT_TOTAL_BYTES) {
      return { valid: false, message: "路径输入总大小超过上限", paths: [] };
    }
  }
  return { valid: true, message: "", paths: [...paths] };
}

export function createBrowserEntries(fileList, now = Date.now()) {
  const timestamp = Math.floor(now / 1000);
  return Array.from(fileList || {}).slice(0, 8).map((file, index) => {
    const name = file.name || "未命名资料";
    const kind = getFileKind(name);
    return {
      id: `imported-${now}-${index}`,
      name,
      type: getFileType(name, kind),
      kind,
      status: "已登记",
      modified: "刚刚",
      modifiedAt: timestamp,
      addedAt: timestamp,
      size: Number.isFinite(file.size) ? file.size : 0,
      favorite: false,
      tags: [],
      groupId: null,
    };
  });
}

export function getSelectedEntries(entries, selectedIds) {
  const selected = new Set(selectedIds || []);
  return (entries || []).filter((entry) => selected.has(entry.id));
}

export function summarizeBatchResult(result) {
  const results = Array.isArray(result?.results) ? result.results : [];
  const summary = results.reduce((counts, item) => {
    if (item?.status === "success") counts.success += 1;
    else if (item?.status === "failed") counts.failed += 1;
    else counts.skipped += 1;
    return counts;
  }, { success: 0, failed: 0, skipped: 0 });
  return summary;
}

export function normalizeTagInput(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

export function normalizeTagList(tags) {
  const normalized = [];
  const seen = new Set();
  for (const tag of Array.isArray(tags) ? tags : []) {
    const value = normalizeTagInput(tag);
    const key = value.toLocaleLowerCase("zh-CN");
    if (!value || seen.has(key)) continue;
    seen.add(key);
    normalized.push(value);
  }
  return normalized;
}

export function addTagToList(tags, value) {
  const current = normalizeTagList(tags);
  const validation = validateTagInput(value);
  if (!validation.valid) return { valid: false, tags: current, message: validation.message };
  if (current.some((tag) => tag.toLocaleLowerCase("zh-CN") === validation.value.toLocaleLowerCase("zh-CN"))) {
    return { valid: false, tags: current, message: "该标签已经存在" };
  }
  if (current.length >= MAX_TAGS_PER_ENTRY) {
    return { valid: false, tags: current, message: `每条资料最多 ${MAX_TAGS_PER_ENTRY} 个标签` };
  }
  return { valid: true, tags: [...current, validation.value], message: "" };
}

export function removeTagFromList(tags, tag) {
  const target = normalizeTagInput(tag).toLocaleLowerCase("zh-CN");
  return normalizeTagList(tags).filter((current) => current.toLocaleLowerCase("zh-CN") !== target);
}

export function isMainIndexEntry(entry) {
  return Boolean(entry?.id) && !entry?.directoryId && !Array.isArray(entry?.relativePath);
}

export function validateTagInput(value) {
  const tag = normalizeTagInput(value);
  if (!tag) return { valid: false, message: "标签不能为空" };
  if (tag.length > 32) return { valid: false, message: "标签不能超过 32 个字符" };
  if (/[\u0000-\u001f\u007f-\u009f]/.test(tag)) return { valid: false, message: "标签不能包含控制字符" };
  return { valid: true, value: tag, message: "" };
}

export function getNextSelection(entries, currentId) {
  if (currentId && entries.some((entry) => entry.id === currentId)) return currentId;
  return entries[0]?.id || "";
}

export function validateRename(file, value, entries = []) {
  const name = String(value ?? "");
  const errors = [];
  if (!name.trim()) errors.push({ code: "empty", message: "文件名不能为空" });
  if (name === "." || name === "..") errors.push({ code: "reserved", message: "不能使用 . 或 .. 作为文件名" });
  if (name.length > 255) errors.push({ code: "too-long", message: "文件名不能超过 255 个字符" });
  if (/[\u0000-\u001f\u007f-\u009f<>:"\/\\|?*]/.test(name)) errors.push({ code: "invalid-character", message: "文件名包含 Windows 不允许的字符" });
  if (name.endsWith(".") || name.endsWith(" ")) errors.push({ code: "trailing-character", message: "文件名不能以空格或点结尾" });
  if (isReservedDeviceName(name)) errors.push({ code: "reserved", message: "文件名不能使用 Windows 保留设备名" });
  if (file && getExtension(file.name) !== getExtension(name)) errors.push({ code: "extension", message: "文件扩展名必须保持不变" });
  if (file && name === file.name) errors.push({ code: "unchanged", message: "新文件名与原文件相同" });

  const normalizedName = name.toLocaleLowerCase("zh-CN");
  if (file && normalizedName && entries.some((entry) => (
    entry.id !== file.id
    && normalizedName === String(entry.name || "").toLocaleLowerCase("zh-CN")
    && sameParent(entry.path, file.path)
  ))) {
    errors.push({ code: "conflict", message: "当前文件夹中已经存在同名文件" });
  }
  return { valid: errors.length === 0, errors, message: errors[0]?.message || "" };
}

function sameParent(leftPath, rightPath) {
  if (!leftPath || !rightPath) return true;
  const left = String(leftPath).replaceAll("/", "\\");
  const right = String(rightPath).replaceAll("/", "\\");
  return left.slice(0, left.lastIndexOf("\\")).toLocaleLowerCase("zh-CN")
    === right.slice(0, right.lastIndexOf("\\")).toLocaleLowerCase("zh-CN");
}

function isReservedDeviceName(value) {
  const base = String(value).split(".")[0].toLocaleUpperCase("en-US");
  return ["CON", "PRN", "AUX", "NUL", ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)].includes(base);
}
