export const DEFAULT_RECURSIVE_IMPORT_POLICY = Object.freeze({
  maxDepth: 32,
  maxEntries: 20_000,
  skipHidden: true,
  includeUnsupported: false,
});

export const RECURSIVE_IMPORT_DEPTH_OPTIONS = Object.freeze([8, 16, 32, 64]);
export const RECURSIVE_IMPORT_ENTRY_OPTIONS = Object.freeze([2_000, 10_000, 20_000]);

export function normalizeRecursiveImportPolicy(value = {}) {
  const source = value || {};
  return {
    maxDepth: clampInteger(source.maxDepth, 1, 64, DEFAULT_RECURSIVE_IMPORT_POLICY.maxDepth),
    maxEntries: clampInteger(source.maxEntries, 1, 20_000, DEFAULT_RECURSIVE_IMPORT_POLICY.maxEntries),
    skipHidden: source.skipHidden !== false,
    includeUnsupported: source.includeUnsupported === true,
  };
}

export function describeRecursiveImportPolicy(value) {
  const policy = normalizeRecursiveImportPolicy(value);
  const typeScope = policy.includeUnsupported ? "所有普通文件" : "已支持预览格式";
  const hiddenRule = policy.skipHidden ? "跳过隐藏和系统项" : "不额外跳过隐藏项";
  return `${typeScope}，${hiddenRule}，最多 ${policy.maxEntries} 项，最多 ${policy.maxDepth} 层`;
}

export function getRecursiveImportFolderName(path) {
  const normalized = String(path || "").replace(/[\\/]+$/, "");
  return normalized.split(/[\\/]/).filter(Boolean).at(-1) || "所选文件夹";
}

function clampInteger(value, minimum, maximum, fallback) {
  return Number.isSafeInteger(value) ? Math.min(maximum, Math.max(minimum, value)) : fallback;
}
