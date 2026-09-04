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
export const RECENT_OPENED_ENTRY_LIMIT = 50;
export const SEARCH_MODES = Object.freeze({ metadata: "metadata", content: "content" });
export const MAX_SEARCH_QUERY_CHARS = 256;
export const MAX_METADATA_FIELD_CHARS = 4096;

export function getIndexEventDecision(currentRevision = 0, eventRevision) {
  const current = normalizeRevision(currentRevision);
  const next = Number(eventRevision);
  if (!Number.isSafeInteger(next) || next <= current) {
    return { accepted: false, revision: current };
  }
  return { accepted: true, revision: next };
}

export function getIndexSnapshotDecision(
  currentRevision = 0,
  snapshotRevision,
  requiredRevision = 0,
) {
  const current = normalizeRevision(currentRevision);
  const required = Math.max(current, normalizeRevision(requiredRevision));
  const incoming = Number(snapshotRevision);
  if (!Number.isSafeInteger(incoming)) return "invalid";
  if (incoming < current) return "stale";
  if (incoming < required) return "behind";
  return "accept";
}

export function normalizeSearchQuery(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("zh-CN");
}

function normalizeRevision(value) {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

export function normalizeRawSearchQuery(value) {
  return String(value ?? "").normalize("NFKC").trim();
}

export function validateSearchQuery(value, useRegex = false, { validateRegex = true } = {}) {
  const query = normalizeRawSearchQuery(value);
  if ([...query].length > MAX_SEARCH_QUERY_CHARS) {
    return { valid: false, query, message: `搜索内容不能超过 ${MAX_SEARCH_QUERY_CHARS} 个字符` };
  }
  if (/[\u0000-\u001f\u007f-\u009f]/.test(query)) {
    return { valid: false, query, message: "搜索内容不能包含控制字符" };
  }
  if (validateRegex && useRegex && query) {
    try {
      new RegExp(query, "iu");
    } catch {
      return { valid: false, query, message: "正则表达式无效，请检查语法" };
    }
  }
  return { valid: true, query, message: "" };
}

export function buildMetadataSearchQuery({
  activeNav = "library",
  searchQuery = "",
  useRegex = false,
  filters = {},
  directoryView = null,
} = {}) {
  const folder = directoryView?.trail?.at(-1);
  const directoryId = folder?.directoryId || folder?.id;
  return {
    query: useRegex ? normalizeRawSearchQuery(searchQuery) : normalizeSearchQuery(searchQuery),
    useRegex: Boolean(useRegex),
    activeNav: String(activeNav || "library"),
    filter: String(filters.type || ""),
    groupIds: [...new Set((filters.groupIds || []).filter(Boolean).map(String))],
    tags: [...new Set((filters.tags || []).filter(Boolean).map(String))],
    targetDirectory: directoryId
      ? {
        directoryId: String(directoryId),
        relativePath: Array.isArray(folder.relativePath) ? folder.relativePath.map(String) : [],
      }
      : null,
  };
}

export function getMetadataSearchResponseDecision({
  requestSequence,
  currentSequence,
  requestRevision,
  responseRevision,
  currentRevision,
  requestContextKey,
  currentContextKey,
} = {}) {
  if (requestSequence !== currentSequence) return "stale-request";
  if (requestContextKey !== currentContextKey) return "stale-context";
  if (responseRevision !== requestRevision || responseRevision !== currentRevision) return "stale-revision";
  return "accept";
}

export { getExtension, getFileKind, getFileType };

export function getDisplayType(entry) {
  return entry?.type || entry?.fileType || getFileType(entry?.name, entry?.kind);
}

export function getLibraryContextKey({
  activeNav = "library",
  searchQuery = "",
  searchMode = SEARCH_MODES.metadata,
  useRegex = false,
  filters = {},
  directoryView = null,
} = {}) {
  const normalizedTags = [...new Set((filters.tags || []).map(normalizeSearchQuery).filter(Boolean))].sort((left, right) => COLLATOR.compare(left, right));
  const normalizedGroups = [...new Set((filters.groupIds || []).filter(Boolean).map(String))].sort(COLLATOR.compare);
  const trail = (directoryView?.trail || []).map((folder) => ({
    id: String(folder?.directoryId || folder?.id || ""),
    relativePath: Array.isArray(folder?.relativePath) ? folder.relativePath.map(String) : [],
  }));
  return JSON.stringify({
    activeNav: String(activeNav || "library"),
    searchQuery: useRegex || searchMode === SEARCH_MODES.content
      ? normalizeRawSearchQuery(searchQuery)
      : normalizeSearchQuery(searchQuery),
    searchMode: String(searchMode || SEARCH_MODES.metadata),
    useRegex: Boolean(useRegex),
    type: normalizeSearchQuery(filters.type),
    tags: normalizedTags,
    groupIds: normalizedGroups,
    trail,
  });
}

export function clearSelectionOnContextChange(previousContextKey, nextContextKey, selectedIds = []) {
  const normalizedIds = [...new Set((selectedIds || []).filter(Boolean))];
  return previousContextKey && previousContextKey !== nextContextKey ? [] : normalizedIds;
}

export function retainExistingSelection(selectedIds = [], entries = []) {
  const availableIds = new Set((entries || []).map((entry) => entry?.id).filter(Boolean));
  return [...new Set((selectedIds || []).filter((id) => availableIds.has(id)))];
}

export function getSelectedIdsInEntries(selectedIds = [], entries = []) {
  const selected = new Set(selectedIds || []);
  return (entries || []).map((entry) => entry?.id).filter((id) => id && selected.has(id));
}

export function getEntryPage(entries = [], entryId, pageSize = PAGE_SIZE) {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || !entryId) return null;
  const index = (entries || []).findIndex((entry) => entry?.id === entryId);
  return index < 0 ? null : Math.floor(index / pageSize) + 1;
}

export function getSelectionRangeIds(entries = [], anchorId, targetId) {
  const ids = [...new Set((entries || []).map((entry) => entry?.id).filter(Boolean))];
  const targetIndex = ids.indexOf(targetId);
  if (targetIndex < 0) return [];
  const anchorIndex = ids.indexOf(anchorId);
  if (anchorIndex < 0) return [ids[targetIndex]];
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ids.slice(start, end + 1);
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
  if (activeNav === "recent-opened") return !entry.invalid && Number.isFinite(entry.lastOpenedAt) && entry.lastOpenedAt > 0;
  return true;
}

export function getNavigationCount(entries, activeNav) {
  if (activeNav === "recent") return getRecentEntries(entries).length;
  if (activeNav === "recent-opened") return getRecentOpenedEntries(entries).length;
  return entries.filter((entry) => matchesNavigation(entry, activeNav)).length;
}

export function countEntriesInGroup(entries, groupId) {
  if (!groupId) return 0;
  return (entries || []).filter((entry) => entry?.groupId === groupId).length;
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
    searchMode = SEARCH_MODES.metadata,
    useRegex = false,
    contentMatchIds = new Set(),
    metadataMatchIds = null,
  } = {},
) {
  const normalizedQuery = searchMode === SEARCH_MODES.content || useRegex
    ? normalizeRawSearchQuery(query)
    : normalizeSearchQuery(query);
  const normalizedTags = tags.map(normalizeSearchQuery).filter(Boolean);
  const selectedTypes = types.map(normalizeSearchQuery).filter(Boolean);
  const selectedGroups = new Set(groupIds.filter(Boolean));
  const groupNameById = new Map((groups || []).map((group) => [group.id, group.name]));
  const sourceEntries = !directory && activeNav === "recent"
    ? getRecentEntries(entries)
    : !directory && activeNav === "recent-opened"
      ? getRecentOpenedEntries(entries)
      : entries;
  return sourceEntries.filter((entry) => {
    const matchesNav = directory || activeNav === "library" || matchesNavigation(entry, activeNav);
    if (!matchesNav) return false;
    if (selectedTypes.length && !selectedTypes.includes(normalizeSearchQuery(getDisplayType(entry)))) return false;
    if (selectedGroups.size && !selectedGroups.has(entry.groupId)) return false;
    const entryTags = Array.isArray(entry.tags) ? entry.tags.map(normalizeSearchQuery) : [];
    if (normalizedTags.length && !normalizedTags.every((tag) => entryTags.includes(tag))) return false;
    if (!normalizedQuery) return true;
    if (searchMode === SEARCH_MODES.content) {
      return contentMatchIds instanceof Set
        ? contentMatchIds.has(entry.id)
        : contentMatchIds.includes(entry.id);
    }
    if (metadataMatchIds != null) {
      return metadataMatchIds instanceof Set
        ? metadataMatchIds.has(entry.id)
        : metadataMatchIds.includes(entry.id);
    }
    const fields = getSearchableEntryFields(entry, { directoryView, entryTags, groupNameById });
    if (useRegex) {
      let expression;
      try {
        expression = new RegExp(normalizedQuery, "iu");
      } catch {
        return false;
      }
      return fields.some((field) => expression.test(field.value));
    }
    const searchable = fields.map((field) => normalizeSearchQuery(field.value)).join(" ");
    return normalizedQuery.split(" ").every((token) => token && searchable.includes(token));
  });
}

export function getSearchableEntryFields(entry, { directoryView, entryTags, groupNameById } = {}) {
  const location = getEntryLocation(entry, directoryView);
  const tags = entryTags || (Array.isArray(entry.tags) ? entry.tags : []);
  const groupName = entry.groupId ? groupNameById?.get(entry.groupId) : "";
  return [
    { key: "name", label: "名称", value: entry.name },
    { key: "type", label: "类型", value: getDisplayType(entry) },
    { key: "status", label: "状态", value: entry.status },
    { key: "location", label: "位置", value: entry.path },
    { key: "location", label: "位置", value: location.fullPath },
    { key: "location", label: "位置", value: location.parentPath },
    ...(Array.isArray(entry.relativePath) ? entry.relativePath.map((value) => ({ key: "location", label: "位置", value })) : []),
    ...tags.map((value) => ({ key: "tag", label: "标签", value })),
    { key: "group", label: "分组", value: groupName },
  ].filter((field) => typeof field.value === "string" && field.value.length > 0);
}

export function getMetadataSearchHit(entry, query, { useRegex = false, directoryView, groups = [] } = {}) {
  const validation = validateSearchQuery(query, useRegex);
  if (!validation.valid || !validation.query) return null;
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const fields = getSearchableEntryFields(entry, { directoryView, groupNameById });
  if (useRegex) {
    let expression;
    try {
      expression = new RegExp(validation.query, "iu");
    } catch {
      return null;
    }
    return fields.find((field) => expression.test(field.value)) || null;
  }
  const tokens = normalizeSearchQuery(validation.query).split(" ").filter(Boolean);
  return fields.find((field) => {
    const value = normalizeSearchQuery(field.value);
    return tokens.every((token) => value.includes(token));
  }) || null;
}

export function getMetadataSearchHitFromResult(entry, result, { directoryView, groups = [] } = {}) {
  if (!result || typeof result.field !== "string") return null;
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const field = getSearchableEntryFields(entry, { directoryView, groupNameById })
    .find((candidate) => candidate.key === result.field);
  if (!field) return null;
  return {
    ...field,
    ranges: Array.isArray(result.ranges) ? result.ranges : [],
  };
}

export function getSearchTextRanges(value, query, useRegex = false) {
  const validation = validateSearchQuery(query, useRegex);
  if (!validation.valid || !validation.query || typeof value !== "string") return [];
  const expressions = useRegex
    ? [validation.query]
    : normalizeSearchQuery(validation.query).split(" ").filter(Boolean).map(escapeRegExp);
  const ranges = [];
  for (const expression of expressions) {
    let matcher;
    try {
      matcher = new RegExp(expression, "giu");
    } catch {
      return [];
    }
    for (const match of value.matchAll(matcher)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      if (start < end) ranges.push({ start, end });
    }
  }
  ranges.sort((left, right) => left.start - right.start || left.end - right.end);
  return ranges.reduce((merged, range) => {
    const previous = merged.at(-1);
    if (previous && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else merged.push(range);
    return merged;
  }, []);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

export function getRecentOpenedEntries(entries) {
  return [...entries]
    .filter((entry) => Number.isFinite(entry.lastOpenedAt) && entry.lastOpenedAt > 0 && !entry.invalid)
    .sort((left, right) => (
      Number(right.lastOpenedAt) - Number(left.lastOpenedAt)
      || COLLATOR.compare(String(left.id || ""), String(right.id || ""))
    ))
    .slice(0, RECENT_OPENED_ENTRY_LIMIT);
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
