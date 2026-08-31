import {
  getExtension,
  getFileKind,
  getFileType,
} from "../../lib/fileTypes.js";

const COLLATOR = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

export const PAGE_SIZE = 20;

export const SORT_OPTIONS = Object.freeze([
  { key: "addedAt", label: "添加时间" },
  { key: "modifiedAt", label: "修改时间" },
  { key: "name", label: "名称" },
  { key: "size", label: "大小" },
]);

export const DEFAULT_SORT = Object.freeze({ key: "addedAt", direction: "desc" });
export const RECENT_ENTRY_LIMIT = 50;

export function normalizeSearchQuery(value) {
  return String(value || "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

export { getExtension, getFileKind, getFileType };

export function getDisplayType(entry) {
  return entry?.type || entry?.fileType || getFileType(entry?.name, entry?.kind);
}


export function matchesNavigation(entry, activeNav) {
  if (activeNav === "favorites") return Boolean(entry.favorite);
  if (activeNav === "invalid") return Boolean(entry.invalid);
  if (activeNav === "recent") return !entry.invalid;
  return true;
}

export function getNavigationCount(entries, activeNav) {
  if (activeNav === "recent") return getRecentEntries(entries).length;
  return entries.filter((entry) => matchesNavigation(entry, activeNav)).length;
}

export function filterEntries(entries, { activeNav = "library", query = "", directory = false } = {}) {
  const normalizedQuery = normalizeSearchQuery(query);
  const sourceEntries = !directory && activeNav === "recent" ? getRecentEntries(entries) : entries;
  return sourceEntries.filter((entry) => {
    const matchesNav = directory || activeNav === "library" || matchesNavigation(entry, activeNav);
    if (!matchesNav) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      entry.name,
      getDisplayType(entry),
      entry.status,
      entry.invalid ? "路径失效" : "已登记",
    ]
      .map(normalizeSearchQuery)
      .join(" ");
    return normalizedQuery.split(" ").every((token) => token && searchable.includes(token));
  });
}

export function getRecentEntries(entries) {
  return entries
    .filter((entry) => Number.isFinite(entry.addedAt) && entry.addedAt > 0 && !entry.invalid)
    .sort((left, right) => (
      Number(right.addedAt) - Number(left.addedAt)
      || COLLATOR.compare(String(left.id || ""), String(right.id || ""))
    ))
    .slice(0, RECENT_ENTRY_LIMIT);
}

export function sortEntries(entries, { key = DEFAULT_SORT.key, direction = DEFAULT_SORT.direction } = {}) {
  const multiplier = direction === "asc" ? 1 : -1;
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((left, right) => {
      const compared = compareSortValues(getSortValue(left.entry, key), getSortValue(right.entry, key));
      if (compared !== 0) return compared * multiplier;
      const idCompared = COLLATOR.compare(String(left.entry.id || ""), String(right.entry.id || ""));
      return idCompared !== 0 ? idCompared : left.index - right.index;
    })
    .map(({ entry }) => entry);
}

export function paginateEntries(entries, page, pageSize = PAGE_SIZE) {
  const pageCount = Math.max(1, Math.ceil(entries.length / pageSize));
  const safePage = Math.min(Math.max(1, page), pageCount);
  const start = (safePage - 1) * pageSize;
  return {
    entries: entries.slice(start, start + pageSize),
    page: safePage,
    pageCount,
  };
}

export function formatFileSize(size) {
  if (!Number.isFinite(size) || size < 0) return "—";
  if (size < 1024) return `${size} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = size;
  let unitIndex = -1;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  const precision = value >= 10 || Number.isInteger(value) ? 0 : 1;
  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}

function getSortValue(entry, key) {
  if (key === "name") return String(entry.name || "");
  if (key === "size") return Number.isFinite(entry.size) ? entry.size : 0;
  if (key === "modifiedAt") return Number.isFinite(entry.modifiedAt) ? entry.modifiedAt : 0;
  return Number.isFinite(entry.addedAt) ? entry.addedAt : 0;
}

function compareSortValues(left, right) {
  if (typeof left === "string" && typeof right === "string") return COLLATOR.compare(left, right);
  return left === right ? 0 : left < right ? -1 : 1;
}
