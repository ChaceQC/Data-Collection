export const FLOATING_LIBRARY_FILTERS = Object.freeze(["all", "favorite", "folder", "invalid"]);
export const FLOATING_LIBRARY_SORT_KEYS = Object.freeze(["name", "type", "modifiedAt", "lastOpenedAt"]);
export const FLOATING_LIBRARY_DIRECTIONS = Object.freeze(["asc", "desc"]);
export const FLOATING_LIBRARY_PAGE_SIZE = 20;
export const FLOATING_LIBRARY_DEFAULT_QUERY = Object.freeze({
  query: "",
  filter: "all",
  sortKey: "name",
  direction: "asc",
  offset: 0,
  limit: 50,
});
export const FLOATING_LIBRARY_MAX_QUERY_CHARS = 256;
export const FLOATING_LIBRARY_MAX_LIMIT = 100;
export const FLOATING_LIBRARY_MAX_OFFSET = 20_000;

export function normalizeFloatingSearchInput(value) {
  if (typeof value !== "string") return "";
  return [...value]
    .filter((character) => !/[\u0000-\u001f\u007f-\u009f]/.test(character))
    .slice(0, FLOATING_LIBRARY_MAX_QUERY_CHARS)
    .join("");
}

export function formatFloatingFileSize(value) {
  if (!Number.isSafeInteger(value) || value < 0) return "大小未知";
  if (value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  const display = value / (1024 ** unitIndex);
  const rounded = display >= 10 || unitIndex === 0 ? Math.round(display) : Number(display.toFixed(1));
  return `${rounded} ${units[unitIndex]}`;
}

export function formatFloatingTimestamp(value, emptyLabel = "未记录") {
  if (!Number.isSafeInteger(value) || value <= 0) return emptyLabel;
  const milliseconds = value < 100_000_000_000 ? value * 1000 : value;
  const date = new Date(milliseconds);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date).replace(/\//g, "-");
}

export function getFloatingPageSummary(offset, limit, total) {
  const safeOffset = Number.isSafeInteger(offset) && offset >= 0 ? offset : 0;
  const safeLimit = Number.isSafeInteger(limit) && limit > 0 ? limit : FLOATING_LIBRARY_PAGE_SIZE;
  const safeTotal = Number.isSafeInteger(total) && total >= 0 ? total : 0;
  return {
    start: safeTotal ? safeOffset + 1 : 0,
    end: Math.min(safeOffset + safeLimit, safeTotal),
    page: Math.floor(safeOffset / safeLimit) + 1,
    pageCount: Math.max(1, Math.ceil(safeTotal / safeLimit)),
  };
}

export function normalizeFloatingFilesQuery(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("文件库查询参数无效");
  }
  const allowedKeys = new Set(Object.keys(FLOATING_LIBRARY_DEFAULT_QUERY));
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) throw new TypeError("文件库查询参数无效");

  const query = value.query === undefined ? "" : value.query;
  if (typeof query !== "string") throw new TypeError("文件库搜索内容无效");
  if ([...query].length > FLOATING_LIBRARY_MAX_QUERY_CHARS || /[\u0000-\u001f\u007f-\u009f]/.test(query)) {
    throw new TypeError("文件库搜索内容无效");
  }
  const filter = value.filter === undefined ? "all" : value.filter;
  const sortKey = value.sortKey === undefined ? "name" : value.sortKey;
  const direction = value.direction === undefined ? "asc" : value.direction;
  if (!FLOATING_LIBRARY_FILTERS.includes(filter)) throw new TypeError("文件库筛选条件无效");
  if (!FLOATING_LIBRARY_SORT_KEYS.includes(sortKey)) throw new TypeError("文件库排序字段无效");
  if (!FLOATING_LIBRARY_DIRECTIONS.includes(direction)) throw new TypeError("文件库排序方向无效");

  const offset = value.offset === undefined ? 0 : value.offset;
  const limit = value.limit === undefined ? FLOATING_LIBRARY_DEFAULT_QUERY.limit : value.limit;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > FLOATING_LIBRARY_MAX_OFFSET) {
    throw new TypeError("文件库分页偏移无效");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > FLOATING_LIBRARY_MAX_LIMIT) {
    throw new TypeError("文件库分页数量无效");
  }

  return {
    query: query.normalize("NFKC").trim().replace(/\s+/g, " "),
    filter,
    sortKey,
    direction,
    offset,
    limit,
  };
}

export function queryFloatingFiles(items, options = {}, groups = []) {
  const query = normalizeFloatingFilesQuery(options);
  const groupNameById = new Map((Array.isArray(groups) ? groups : [])
    .filter((group) => typeof group?.id === "string" && typeof group?.name === "string")
    .map((group) => [group.id, group.name]));
  const seenIds = new Set();
  const candidates = [];
  for (const item of Array.isArray(items) ? items : []) {
    if (!item?.id) continue;
    const groupName = typeof item.groupName === "string"
      ? item.groupName
      : groupNameById.get(item.groupId) || "";
    if (!matchesFilter(item, query.filter) || !matchesQuery(item, groupName, query.query)) continue;
    if (seenIds.has(item.id)) continue;
    seenIds.add(item.id);
    candidates.push({ item, groupName });
  }

  candidates.sort((left, right) => compareCandidates(left, right, query.sortKey, query.direction));
  const total = candidates.length;
  return {
    items: candidates.slice(query.offset, query.offset + query.limit).map(({ item }) => item),
    total,
    offset: query.offset,
    limit: query.limit,
    hasMore: query.offset + query.limit < total,
  };
}

function matchesFilter(item, filter) {
  if (filter === "favorite") return Boolean(item.favorite);
  if (filter === "folder") return item.kind === "folder";
  if (filter === "invalid") return Boolean(item.invalid);
  return true;
}

function matchesQuery(item, groupName, query) {
  const searchable = [item.name, item.type, ...(Array.isArray(item.tags) ? item.tags : []), groupName]
    .filter((value) => typeof value === "string" && value)
    .join(" ")
    .normalize("NFKC")
    .toLocaleLowerCase("zh-CN");
  return query
    .toLocaleLowerCase("zh-CN")
    .split(/\s+/)
    .filter(Boolean)
    .every((token) => searchable.includes(token));
}

function compareCandidates(left, right, sortKey, direction) {
  const primary = sortKey === "name"
    ? compareStrings(left.item.name, right.item.name, direction)
    : sortKey === "type"
      ? compareStrings(left.item.type, right.item.type, direction)
      : compareNullableNumbers(left.item[sortKey], right.item[sortKey], direction);
  return primary || compareStrings(left.item.id, right.item.id, "asc");
}

function compareStrings(left, right, direction) {
  const leftValue = String(left || "").normalize("NFKC").toLocaleLowerCase("zh-CN");
  const rightValue = String(right || "").normalize("NFKC").toLocaleLowerCase("zh-CN");
  const compared = leftValue === rightValue
    ? String(left || "") === String(right || "") ? 0 : String(left || "") < String(right || "") ? -1 : 1
    : leftValue < rightValue ? -1 : 1;
  return direction === "desc" ? -compared : compared;
}

function compareNullableNumbers(left, right, direction) {
  const leftNumber = Number.isSafeInteger(left) && left >= 0 ? left : null;
  const rightNumber = Number.isSafeInteger(right) && right >= 0 ? right : null;
  if (leftNumber === null || rightNumber === null) {
    if (leftNumber === rightNumber) return 0;
    return leftNumber === null ? 1 : -1;
  }
  if (leftNumber === rightNumber) return 0;
  const compared = leftNumber < rightNumber ? -1 : 1;
  return direction === "desc" ? -compared : compared;
}
