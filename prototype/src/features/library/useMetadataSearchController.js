import { useEffect, useMemo, useRef, useState } from "react";
import { getOperationError } from "../../lib/ipcContracts.js";
import {
  buildMetadataSearchQuery,
  getLibraryContextKey,
  getMetadataSearchResponseDecision,
  SEARCH_MODES,
  validateSearchQuery,
} from "./libraryModel.js";
import { libraryRepository } from "./libraryRepository.js";

export const METADATA_SEARCH_DEBOUNCE_MS = 140;

export function useMetadataSearchController({
  isTauriRuntime,
  indexRevision = 0,
  activeNav,
  searchQuery,
  searchMode,
  useRegex,
  filters,
  directoryView,
}) {
  const [result, setResult] = useState(null);
  const [resultContextKey, setResultContextKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequenceRef = useRef(0);
  const revisionRef = useRef(indexRevision);
  const contextKeyRef = useRef("");
  const contextKey = useMemo(
    () => getLibraryContextKey({ activeNav, searchQuery, searchMode, useRegex, filters, directoryView }),
    [activeNav, directoryView, filters, searchMode, searchQuery, useRegex],
  );

  revisionRef.current = indexRevision;
  contextKeyRef.current = contextKey;

  useEffect(() => {
    const sequence = ++sequenceRef.current;
    let disposed = false;
    const validation = validateSearchQuery(searchQuery, useRegex, { validateRegex: false });
    const query = validation.query;
    const requestRevision = Number.isSafeInteger(indexRevision) && indexRevision >= 0 ? indexRevision : 0;
    const emptyResult = {
      revision: requestRevision,
      matchedIds: [],
      hits: [],
      total: 0,
      truncated: false,
    };

    setResult(null);
    setResultContextKey("");
    setLoading(false);
    setError("");
    if (searchMode !== SEARCH_MODES.metadata || !query || !isTauriRuntime) {
      if (searchMode === SEARCH_MODES.metadata && query && !validation.valid) {
        setResult(emptyResult);
        setResultContextKey(contextKey);
        setError(validation.message);
      }
      return () => {
        disposed = true;
      };
    }
    setResult(emptyResult);
    setResultContextKey(contextKey);
    if (!validation.valid) {
      setError(validation.message);
      return () => {
        disposed = true;
      };
    }

    setLoading(true);
    const timeoutId = window.setTimeout(() => {
      const request = buildMetadataSearchQuery({
        activeNav,
        searchQuery: query,
        useRegex,
        filters,
        directoryView,
      });
      libraryRepository.searchMetadata(request)
        .then((response) => {
          if (disposed) return;
          const decision = getMetadataSearchResponseDecision({
            requestSequence: sequence,
            currentSequence: sequenceRef.current,
            requestRevision,
            responseRevision: response.revision,
            currentRevision: revisionRef.current,
            requestContextKey: contextKey,
            currentContextKey: contextKeyRef.current,
          });
          if (decision !== "accept") return;
          setResult(response);
          setResultContextKey(contextKey);
          setLoading(false);
        })
        .catch((requestError) => {
          if (disposed || sequence !== sequenceRef.current || contextKey !== contextKeyRef.current) return;
          setResult(emptyResult);
          setResultContextKey(contextKey);
          setLoading(false);
          setError(getOperationError(requestError, "元数据搜索失败，请重试"));
        });
    }, METADATA_SEARCH_DEBOUNCE_MS);

    return () => {
      disposed = true;
      window.clearTimeout(timeoutId);
    };
  }, [activeNav, contextKey, directoryView, filters, indexRevision, isTauriRuntime, searchMode, searchQuery, useRegex]);

  return { error, loading, result, resultContextKey };
}
