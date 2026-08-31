import { getExtension, getFileKind, getFileType } from "../../lib/fileTypes.js";

export const LIBRARY_ACTION_TYPES = Object.freeze({
  remove: "remove",
  rename: "rename",
  delete: "delete",
});

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
    };
  });
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
