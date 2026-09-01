import { useCallback, useEffect, useRef, useState } from "react";
import { getOperationError } from "../../lib/ipcContracts.js";
import { clearOperationHistory, loadOperationHistory, saveOperationRecord } from "./operationApi.js";
import {
  completeOperationRecord,
  createOperationRecord,
  normalizeOperationRecord,
  upsertOperationRecord,
} from "./operationModel.js";

export function useOperationController({ isTauriRuntime, showToast }) {
  const [records, setRecords] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(isTauriRuntime);
  const [historyWarning, setHistoryWarning] = useState("");
  const recordsRef = useRef([]);
  const persistQueueRef = useRef(Promise.resolve());
  const showToastRef = useRef(showToast);

  showToastRef.current = showToast;

  const replaceRecords = useCallback((nextRecords) => {
    recordsRef.current = nextRecords;
    setRecords(nextRecords);
  }, []);

  const persist = useCallback((record) => {
    if (!isTauriRuntime) return;
    persistQueueRef.current = persistQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await saveOperationRecord(record);
          replaceRecords(upsertOperationRecord(recordsRef.current, saved));
          setHistoryWarning("");
        } catch (error) {
          setHistoryWarning(getOperationError(error, "操作历史暂时无法保存"));
        }
      });
  }, [isTauriRuntime, replaceRecords]);

  useEffect(() => {
    let cancelled = false;
    loadOperationHistory()
      .then((result) => {
        if (cancelled) return;
        const loaded = Array.isArray(result.records) ? result.records.map((record) => (
          record.status === "in-progress"
            ? completeOperationRecord(record, {
              status: "timed-out",
              timedOut: true,
              message: "应用退出前操作未完成，请重试",
            })
            : normalizeOperationRecord(record)
        )) : [];
        const mergedRecords = loaded.reduce((current, record) => upsertOperationRecord(current, record), recordsRef.current);
        replaceRecords(mergedRecords);
        if (result.warning) {
          setHistoryWarning(result.warning);
          showToastRef.current(result.warning);
        }
      })
      .catch((error) => {
        if (!cancelled) setHistoryWarning(getOperationError(error, "操作历史暂时无法读取"));
      })
      .finally(() => {
        if (!cancelled) setHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [replaceRecords]);

  const startOperation = useCallback(({ id, operation, totalCount = 0, request = null }) => {
    const record = createOperationRecord({ id, operation, totalCount, request });
    replaceRecords(upsertOperationRecord(recordsRef.current, record));
    persist(record);
    return record;
  }, [persist, replaceRecords]);

  const finishOperation = useCallback((id, patch = {}) => {
    const current = recordsRef.current.find((record) => record.id === id);
    if (!current) return;
    const record = completeOperationRecord(current, patch);
    replaceRecords(upsertOperationRecord(recordsRef.current, record));
    persist(record);
  }, [persist, replaceRecords]);

  const failOperation = useCallback((id, message) => {
    finishOperation(id, {
      status: "failed",
      failedCount: 1,
      message: message || "操作未完成，请重试",
    });
  }, [finishOperation]);

  const clearHistory = useCallback(async () => {
    try {
      await persistQueueRef.current;
      await clearOperationHistory();
      replaceRecords([]);
      setHistoryWarning("");
      showToastRef.current("操作历史已清除");
    } catch (error) {
      setHistoryWarning(getOperationError(error, "操作历史清除失败，请重试"));
      showToastRef.current(getOperationError(error, "操作历史清除失败，请重试"));
    }
  }, [replaceRecords]);

  return {
    clearHistory,
    failOperation,
    finishOperation,
    historyLoading,
    historyWarning,
    records,
    startOperation,
  };
}
