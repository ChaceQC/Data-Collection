import { useEffect, useRef, useState } from "react";
import { getFloatingFiles } from "./floatingBallApi.js";
import { setFavorite } from "../library/libraryApi.js";
import {
  FLOATING_LIBRARY_DEFAULT_QUERY,
  FLOATING_LIBRARY_PAGE_SIZE,
  getFloatingPageSummary,
  normalizeFloatingFilesQuery,
  normalizeFloatingSearchInput,
  queryFloatingFiles,
} from "./floatingLibraryModel.js";
import { DEMO_FLOATING_FILES } from "./floatingBallDemoData.js";

const SEARCH_DEBOUNCE_MS = 180;
const DEFAULT_FILE_QUERY = Object.freeze({
  ...FLOATING_LIBRARY_DEFAULT_QUERY,
  limit: FLOATING_LIBRARY_PAGE_SIZE,
});
const INITIAL_DEMO_RESULT = queryFloatingFiles(DEMO_FLOATING_FILES, DEFAULT_FILE_QUERY);

export function useFloatingBallFiles({ isTauriRuntime, showFeedback }) {
  const demoFilesRef = useRef([...DEMO_FLOATING_FILES]);
  const demoRevisionRef = useRef(1);
  const [files, setFiles] = useState(isTauriRuntime ? [] : INITIAL_DEMO_RESULT.items);
  const [filesStatus, setFilesStatus] = useState(isTauriRuntime ? "loading" : "ready");
  const [filesRefreshing, setFilesRefreshing] = useState(false);
  const [query, setQuery] = useState(DEFAULT_FILE_QUERY);
  const [searchInput, setSearchInput] = useState("");
  const [total, setTotal] = useState(isTauriRuntime ? 0 : INITIAL_DEMO_RESULT.total);
  const [hasMore, setHasMore] = useState(INITIAL_DEMO_RESULT.hasMore);
  const [revision, setRevision] = useState(isTauriRuntime ? 0 : demoRevisionRef.current);
  const [libraryCount, setLibraryCount] = useState(isTauriRuntime ? null : DEMO_FLOATING_FILES.length);
  const [libraryCountStatus, setLibraryCountStatus] = useState(isTauriRuntime ? "loading" : "ready");
  const [favoriteBusyId, setFavoriteBusyId] = useState("");
  const showFeedbackRef = useRef(showFeedback);
  const favoriteBusyRef = useRef("");
  const filesRequestRef = useRef(0);
  const countRequestRef = useRef(0);
  const searchDebounceRef = useRef(null);
  const lastFetchedQueryRef = useRef(DEFAULT_FILE_QUERY);
  const queryRef = useRef(DEFAULT_FILE_QUERY);
  showFeedbackRef.current = showFeedback;
  queryRef.current = query;

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    void refreshFiles({ initial: true });
    void refreshLibraryCount();
    return () => {
      filesRequestRef.current += 1;
      countRequestRef.current += 1;
      clearTimeout(searchDebounceRef.current);
    };
  }, [isTauriRuntime]);

  useEffect(() => {
    if (lastFetchedQueryRef.current?.query === query.query) return undefined;
    clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = window.setTimeout(() => {
      const requestQuery = queryRef.current;
      lastFetchedQueryRef.current = requestQuery;
      void refreshFiles({ queryOverride: requestQuery });
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(searchDebounceRef.current);
  }, [query.query]);

  async function refreshFiles({ initial = false, queryOverride, background = false } = {}) {
    const requestId = ++filesRequestRef.current;
    const requestQuery = normalizeFloatingFilesQuery(queryOverride || queryRef.current);
    lastFetchedQueryRef.current = requestQuery;
    if (!background) setFilesStatus("loading");
    setFilesRefreshing(true);
    try {
      const result = await fetchFiles(requestQuery);
      if (requestId !== filesRequestRef.current) return false;
      if (requestQuery.offset > 0 && requestQuery.offset >= result.total) {
        const correctedOffset = result.total > 0
          ? Math.floor((result.total - 1) / requestQuery.limit) * requestQuery.limit
          : 0;
        const correctedQuery = { ...requestQuery, offset: correctedOffset };
        queryRef.current = correctedQuery;
        setQuery(correctedQuery);
        lastFetchedQueryRef.current = correctedQuery;
        return refreshFiles({ queryOverride: correctedQuery, background });
      }
      setFiles(result.items);
      setTotal(result.total);
      setHasMore(result.hasMore);
      setRevision(result.revision);
      setFilesStatus("ready");
      setFilesRefreshing(false);
      return true;
    } catch (error) {
      if (requestId !== filesRequestRef.current) return false;
      setFilesRefreshing(false);
      if (!background) setFilesStatus("error");
      showFeedbackRef.current(getErrorMessage(error, initial ? "文件库读取失败，请重试" : "文件库暂时无法刷新"), "error");
      return false;
    }
  }

  async function fetchFiles(requestQuery) {
    if (isTauriRuntime) return getFloatingFiles(requestQuery);
    const result = queryFloatingFiles(demoFilesRef.current, requestQuery);
    return { ...result, revision: demoRevisionRef.current };
  }

  async function refreshLibraryCount() {
    const requestId = ++countRequestRef.current;
    setLibraryCountStatus("loading");
    try {
      const result = isTauriRuntime
        ? await getFloatingFiles({ ...DEFAULT_FILE_QUERY, offset: 0, limit: 1 })
        : queryFloatingFiles(demoFilesRef.current, { ...DEFAULT_FILE_QUERY, offset: 0, limit: 1 });
      if (requestId !== countRequestRef.current) return false;
      setLibraryCount(result.total);
      setLibraryCountStatus("ready");
      return true;
    } catch (error) {
      if (requestId !== countRequestRef.current) return false;
      setLibraryCountStatus("error");
      showFeedbackRef.current(getErrorMessage(error, "文件库数量读取失败，请重试"), "error");
      return false;
    }
  }

  function applyQueryChange(patch, { immediate = true } = {}) {
    clearTimeout(searchDebounceRef.current);
    const nextQuery = normalizeFloatingFilesQuery({
      ...queryRef.current,
      ...patch,
      limit: FLOATING_LIBRARY_PAGE_SIZE,
    });
    queryRef.current = nextQuery;
    setQuery(nextQuery);
    if (immediate) {
      lastFetchedQueryRef.current = nextQuery;
      void refreshFiles({ queryOverride: nextQuery });
    }
  }

  function handleSearchInput(value) {
    const nextValue = normalizeFloatingSearchInput(value);
    setSearchInput(nextValue);
    if (nextValue !== queryRef.current.query) applyQueryChange({ query: nextValue, offset: 0 }, { immediate: false });
  }

  function clearSearch() {
    setSearchInput("");
    applyQueryChange({ query: "", offset: 0 });
  }

  function clearFilters() {
    applyQueryChange({ filter: "all", offset: 0 });
  }

  function handleFilterChange(filter) {
    applyQueryChange({ filter, offset: 0 });
  }

  function handleSortKeyChange(sortKey) {
    applyQueryChange({ sortKey, offset: 0 });
  }

  function handleDirectionToggle() {
    applyQueryChange({ direction: queryRef.current.direction === "asc" ? "desc" : "asc", offset: 0 });
  }

  function handlePreviousPage() {
    if (queryRef.current.offset <= 0) return;
    applyQueryChange({ offset: Math.max(0, queryRef.current.offset - queryRef.current.limit) });
  }

  function handleNextPage() {
    if (!hasMore) return;
    applyQueryChange({ offset: queryRef.current.offset + queryRef.current.limit });
  }

  async function handleFavorite(entry) {
    if (!entry?.id || favoriteBusyRef.current) return;
    const favorite = !entry.favorite;
    favoriteBusyRef.current = entry.id;
    setFavoriteBusyId(entry.id);
    try {
      let nextFavorite = favorite;
      if (isTauriRuntime) {
        const result = await setFavorite(entry.id, favorite);
        nextFavorite = result.entry?.favorite ?? favorite;
      } else {
        demoFilesRef.current = demoFilesRef.current.map((item) => (
          item.id === entry.id ? { ...item, favorite } : item
        ));
        demoRevisionRef.current += 1;
      }
      setFiles((current) => current.map((item) => (
        item.id === entry.id ? { ...item, favorite: nextFavorite } : item
      )));
      const refreshed = await refreshFiles({ background: true });
      if (refreshed) showFeedbackRef.current(nextFavorite ? "已加入收藏" : "已取消收藏", "recorded");
    } catch (error) {
      showFeedbackRef.current(getErrorMessage(error, "收藏状态更新失败，请重试"), "error");
    } finally {
      favoriteBusyRef.current = "";
      setFavoriteBusyId("");
    }
  }

  function addDemoFiles(droppedFiles) {
    const timestamp = Date.now();
    const additions = droppedFiles.map((file, index) => ({
      id: `floating-demo-drop-${timestamp}-${index}`,
      name: file.name || "未命名资料",
      type: "演示记录",
      kind: "file",
      status: "已登记",
      invalid: false,
      favorite: false,
      size: Number.isSafeInteger(file.size) ? file.size : null,
      modifiedAt: timestamp + index,
      lastOpenedAt: null,
      groupId: null,
      groupName: null,
    }));
    demoFilesRef.current = [...additions, ...demoFilesRef.current];
    demoRevisionRef.current += 1;
    setLibraryCount(demoFilesRef.current.length);
    setLibraryCountStatus("ready");
    return additions.length;
  }

  const page = getFloatingPageSummary(query.offset, query.limit, total);
  const emptyState = query.query ? "search" : query.filter === "all" ? "library" : "filter";

  return {
    files,
    filesStatus,
    filesRefreshing,
    query,
    searchInput,
    total,
    hasMore,
    page,
    revision,
    emptyState,
    favoriteBusyId,
    handleFavorite,
    handleSearchInput,
    handleFilterChange,
    handleSortKeyChange,
    handleDirectionToggle,
    handlePreviousPage,
    handleNextPage,
    clearSearch,
    clearFilters,
    addDemoFiles,
    libraryCount,
    libraryCountStatus,
    refreshFiles,
    refreshLibraryCount,
  };
}

function getErrorMessage(error, fallback) {
  const message = typeof error === "string" ? error : error?.message;
  return typeof message === "string" && message.length <= 180 ? message : fallback;
}
