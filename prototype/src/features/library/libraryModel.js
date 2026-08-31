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

export function getEntryLocation(entry, directoryView) {
  if (typeof entry?.path === "string" && entry.path.trim()) {
    const fullPath = normalizeDisplayPath(entry.path);
    return {
      fullPath,
      parentPath: getParentPath(fullPath),
      displayPath: fullPath,
      relative: false,
    };
  }
  const root = directoryView?.trail?.[0];
  const rootPath = typeof root?.path === "string" && root.path.trim()
    ? normalizeDisplayPath(root.path)
    : "登记文件夹";
  const relativePath = Array.isArray(entry?.relativePath) ? entry.relativePath.filter(Boolean) : [];
  const fullPath = joinDisplayPath(rootPath, relativePath);
  const parentPath = relativePath.length > 0
    ? joinDisplayPath(rootPath, relativePath.slice(0, -1))
    : rootPath;
  return {
    fullPath,
    parentPath,
    displayPath: relativePath.length ? relativePath.join("\\") : rootPath,
    relative: true,
  };
}

export function getParentSummary(entry, directoryView) {
  const location = getEntryLocation(entry, directoryView);
  return location.parentPath || "资料库";
}

export function getDuplicateNameIds(entries) {
  const byName = new Map();
  for (const entry of entries || []) {
    const key = normalizeSearchQuery(entry?.name);
    if (!key) continue;
    const ids = byName.get(key) || [];
    ids.push(entry.id);
    byName.set(key, ids);
  }
  return new Set([...byName.values()].filter((ids) => ids.length > 1).flat());
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

export function filterEntries(
  entries,
  {
    activeNav = "library",
    query = "",
    directory = false,
    types = [],
    tags = [],
    groupIds = [],
    groups = [],
    directoryView,
  } = {},
) {
  const normalizedQuery = normalizeSearchQuery(query);
  const normalizedTags = tags.map(normalizeSearchQuery).filter(Boolean);
  const selectedTypes = types.map(normalizeSearchQuery).filter(Boolean);
  const selectedGroups = new Set(groupIds.filter(Boolean));
  const groupNameById = new Map((groups || []).map((group) => [group.id, group.name]));
  const sourceEntries = !directory && activeNav === "recent" ? getRecentEntries(entries) : entries;
  return sourceEntries.filter((entry) => {
    const matchesNav = directory || activeNav === "library" || matchesNavigation(entry, activeNav);
    if (!matchesNav) return false;
    if (selectedTypes.length && !selectedTypes.includes(normalizeSearchQuery(getDisplayType(entry)))) return false;
    if (selectedGroups.size && !selectedGroups.has(entry.groupId)) return false;
    const entryTags = Array.isArray(entry.tags) ? entry.tags.map(normalizeSearchQuery) : [];
    if (normalizedTags.length && !normalizedTags.every((tag) => entryTags.includes(tag))) return false;
    if (!normalizedQuery) return true;
    const searchable = [
      entry.name,
      getDisplayType(entry),
      entry.status,
      entry.invalid ? "路径失效" : "已登记",
      entry.path,
      getEntryLocation(entry, directoryView).fullPath,
      getEntryLocation(entry, directoryView).parentPath,
      ...(Array.isArray(entry.relativePath) ? entry.relativePath : []),
      ...entryTags,
      entry.groupId ? groupNameById.get(entry.groupId) : "",
    ]
      .map(normalizeSearchQuery)
      .join(" ");
    return normalizedQuery.split(" ").every((token) => token && searchable.includes(token));
  });
}

export function getRecentEntries(entries) {
  return [...entries]
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

function normalizeDisplayPath(value) {
  const normalized = String(value).replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\?\\")) return normalized;
  const withoutPrefix = normalized.slice(4);
  return withoutPrefix.startsWith("UNC\\")
    ? `\\\\${withoutPrefix.slice(4)}`
    : withoutPrefix;
}

function joinDisplayPath(rootPath, parts) {
  if (!parts.length) return rootPath;
  const suffix = parts.join("\\");
  if (rootPath.endsWith("\\")) return `${rootPath}${suffix}`;
  return `${rootPath}\\${suffix}`;
}

function getParentPath(path) {
  const normalized = normalizeDisplayPath(path);
  const separator = normalized.lastIndexOf("\\");
  if (separator < 0) return "";
  if (separator <= 2 && normalized.startsWith("\\\\")) return normalized;
  if (separator === 2 && /^[A-Za-z]:\\/.test(normalized)) return normalized.slice(0, 3);
  return normalized.slice(0, separator) || "\\";
}
