import { SORT_OPTIONS } from "../library/libraryModel.js";
import { PREVIEW_LIMITS } from "../../lib/fileTypes.js";

export const PAGE_SIZE_OPTIONS = Object.freeze([10, 20, 50]);
export const SETTINGS_EDITABLE_FIELDS = Object.freeze([
  "defaultSort",
  "pageSize",
  "confirmBeforeRemove",
  "hideToTray",
  "showFloatingWindow",
]);

export const DEFAULT_PREVIEW_LIMITS = PREVIEW_LIMITS.map(({ key, ...limit }) => Object.freeze(limit));

export const DEFAULT_SETTINGS = Object.freeze({
  revision: 0,
  defaultSort: Object.freeze({ key: "addedAt", direction: "desc" }),
  pageSize: 20,
  confirmBeforeRemove: true,
  hideToTray: false,
  showFloatingWindow: true,
  previewLimits: DEFAULT_PREVIEW_LIMITS,
  warning: "",
});

export function normalizeSettings(value) {
  const source = value || {};
  const sourceSort = source.defaultSort || {};
  const defaultSort = {
    key: SORT_OPTIONS.some((option) => option.key === sourceSort.key) ? sourceSort.key : DEFAULT_SETTINGS.defaultSort.key,
    direction: sourceSort.direction === "asc" ? "asc" : "desc",
  };
  const pageSize = PAGE_SIZE_OPTIONS.includes(Number(source.pageSize))
    ? Number(source.pageSize)
    : DEFAULT_SETTINGS.pageSize;
  const previewLimits = normalizePreviewLimits(source.previewLimits);

  return {
    revision: Number.isSafeInteger(source.revision) && source.revision >= 0 ? source.revision : DEFAULT_SETTINGS.revision,
    defaultSort,
    pageSize,
    confirmBeforeRemove: source.confirmBeforeRemove !== false,
    hideToTray: source.hideToTray === true,
    showFloatingWindow: source.showFloatingWindow !== false,
    previewLimits,
    warning: typeof source.warning === "string" ? source.warning : "",
  };
}

export function getChangedSettingsFields(base, next) {
  const previous = normalizeSettings(base);
  const current = normalizeSettings(next);
  return SETTINGS_EDITABLE_FIELDS.filter((field) => {
    if (field === "defaultSort") return previous.defaultSort.key !== current.defaultSort.key || previous.defaultSort.direction !== current.defaultSort.direction;
    return previous[field] !== current[field];
  });
}

export function mergeSettingsFields(latest, draft, fields = SETTINGS_EDITABLE_FIELDS) {
  const current = normalizeSettings(latest);
  const next = normalizeSettings(draft);
  const merged = { ...current };
  for (const field of fields) {
    if (!SETTINGS_EDITABLE_FIELDS.includes(field)) continue;
    merged[field] = field === "defaultSort" ? { ...next.defaultSort } : next[field];
  }
  return normalizeSettings(merged);
}

export function formatByteLimit(value) {
  if (!Number.isFinite(value) || value < 0) return "未知";
  const units = ["B", "KiB", "MiB", "GiB"];
  let amount = value;
  let unitIndex = 0;
  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }
  const precision = amount >= 10 || Number.isInteger(amount) ? 0 : 1;
  return `${amount.toFixed(precision)} ${units[unitIndex]}`;
}

function normalizePreviewLimits(value) {
  if (!Array.isArray(value) || value.length !== DEFAULT_PREVIEW_LIMITS.length) {
    return DEFAULT_PREVIEW_LIMITS;
  }
  const valid = value.every((limit) => (
    typeof limit?.label === "string"
    && Number.isFinite(limit.maxBytes)
    && (limit.maxPixels === null || Number.isFinite(limit.maxPixels))
  ));
  return valid
    ? value.map((limit) => ({
      label: limit.label,
      maxBytes: limit.maxBytes,
      maxPixels: limit.maxPixels ?? null,
    }))
    : DEFAULT_PREVIEW_LIMITS;
}
