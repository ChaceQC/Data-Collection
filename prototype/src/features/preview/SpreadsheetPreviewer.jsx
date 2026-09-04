import { useEffect, useMemo, useRef, useState } from "react";
import { normalizePreviewResourceUrl } from "./previewTypes";
import { UnsupportedPreviewer } from "./UnsupportedPreviewer";

function columnLabel(index) {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
}

export function SpreadsheetPreviewer({ content, onFailure, onReady, ...failureActions }) {
  const [state, setState] = useState({ status: "loading", workbook: null, reason: "" });
  const [selectedSheet, setSelectedSheet] = useState(0);
  const workerRef = useRef(null);
  const selectedSheetRef = useRef(0);
  const requestIdRef = useRef(0);
  const sheetTimeoutRef = useRef(null);

  selectedSheetRef.current = selectedSheet;

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    let worker;
    let workerTimeout;

    let failed = false;
    function setFailure(reason, status = "parse-error") {
      if (cancelled || failed) return;
      failed = true;
      setState({ status, workbook: null, reason });
      onFailure?.(status, reason);
    }

    function resetTimeout() {
      window.clearTimeout(workerTimeout);
      workerTimeout = window.setTimeout(() => {
        worker?.terminate();
        setFailure("工作簿解析超时，已终止解析任务。", "timed-out");
      }, 30000);
    }

    try {
      worker = new Worker(new URL("./xlsxWorker.js", import.meta.url), { type: "module" });
      workerRef.current = worker;
    } catch {
      setFailure("当前 WebView2 无法启动工作簿解析器。");
      return () => controller.abort();
    }
    setState({ status: "loading", workbook: null, reason: "" });
    setSelectedSheet(0);
    requestIdRef.current = 0;
    resetTimeout();
    async function loadWorkbook() {
      try {
        const response = await fetch(normalizePreviewResourceUrl(content.resourceUrl), { signal: controller.signal });
        if (!response.ok) throw new Error("resource unavailable");
        const arrayBuffer = await response.arrayBuffer();
        if (cancelled || controller.signal.aborted) return;
        worker.postMessage({ type: "load", buffer: arrayBuffer, requestId: 0 }, [arrayBuffer]);
      } catch (error) {
        if (cancelled || error?.name === "AbortError") return;
        window.clearTimeout(workerTimeout);
        worker.terminate();
        setFailure(error?.message === "resource unavailable"
          ? "工作簿资源读取失败，请重试。"
          : "工作簿无法解析，请检查文件是否损坏、加密或超出限制。");
      }
    }
    worker.onmessage = (event) => {
      if (cancelled) return;
      if (event.data.type === "metadata") {
        resetTimeout();
        if (!event.data.sheetNames.length) window.clearTimeout(workerTimeout);
        setState({
          status: event.data.sheetNames.length ? "loading" : "ready",
          workbook: {
            sheets: event.data.sheetNames.map((name) => ({ name, rows: [], columns: 0, startColumn: 0, truncated: false })),
            truncatedSheets: Boolean(event.data.truncatedSheets),
          },
          reason: "",
        });
        if (!event.data.sheetNames.length) onReady?.();
      } else if (event.data.type === "sheet"
        && event.data.requestId === requestIdRef.current
        && event.data.index === selectedSheetRef.current) {
        window.clearTimeout(workerTimeout);
        window.clearTimeout(sheetTimeoutRef.current);
        setState((current) => ({
          status: "ready",
          workbook: current.workbook
            ? {
              ...current.workbook,
              sheets: current.workbook.sheets.map((sheet, index) => (
                index === event.data.index ? event.data.sheet : sheet
              )),
            }
            : current.workbook,
          reason: "",
        }));
        onReady?.();
      } else if (event.data.type === "error") {
        window.clearTimeout(workerTimeout);
        worker.terminate();
        setFailure("工作簿无法解析，请检查文件是否损坏、加密或超出限制。");
      }
    };
    worker.onerror = () => {
      if (!cancelled) {
        window.clearTimeout(workerTimeout);
        worker.terminate();
        setFailure("工作簿解析器未能完成，请重试。");
      }
    };
    void loadWorkbook();
    return () => {
      cancelled = true;
      window.clearTimeout(workerTimeout);
      window.clearTimeout(sheetTimeoutRef.current);
      controller.abort();
      worker.terminate();
      if (workerRef.current === worker) workerRef.current = null;
    };
  }, [content.resourceUrl]);

  useEffect(() => {
    if (!workerRef.current || !state.workbook?.sheets?.length) return;
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const worker = workerRef.current;
    setState((current) => ({ ...current, status: "loading" }));
    window.clearTimeout(sheetTimeoutRef.current);
    sheetTimeoutRef.current = window.setTimeout(() => {
      if (requestIdRef.current !== requestId) return;
      worker.terminate();
      const reason = "工作表解析超时，已终止解析任务。";
      setState({ status: "timed-out", workbook: null, reason });
      onFailure?.("timed-out", reason);
    }, 30000);
    worker.postMessage({ type: "load-sheet", index: selectedSheet, requestId });
    return () => window.clearTimeout(sheetTimeoutRef.current);
  }, [selectedSheet, state.workbook?.sheets?.length]);

  const currentSheet = useMemo(
    () => state.workbook?.sheets[selectedSheet] || null,
    [selectedSheet, state.workbook],
  );

  if (state.status === "loading") return <div className="preview-loading-state">正在解析 Excel 工作簿...</div>;
  if (state.status !== "ready" || !state.workbook) return <UnsupportedPreviewer status={state.status} reason={state.reason} {...failureActions} />;

  return (
    <div className="preview-spreadsheet-content">
      <div className="preview-sheet-toolbar">
        <label htmlFor="preview-sheet-select">工作表</label>
        <select
          id="preview-sheet-select"
          value={selectedSheet}
          onChange={(event) => setSelectedSheet(Number(event.target.value))}
        >
          {state.workbook.sheets.map((sheet, index) => (
            <option value={index} key={sheet.name}>{sheet.name}</option>
          ))}
        </select>
        <span>公式只显示缓存值，不执行宏、公式代码或外部链接。</span>
      </div>
      {state.workbook.truncatedSheets && <div className="preview-notice">工作表超过 100 个，仅显示前 100 个。</div>}
      {currentSheet?.truncated && <div className="preview-notice">当前工作表超过首屏限制，仅显示前 500 行、50 列。</div>}
      {!currentSheet || !currentSheet.rows.length ? (
        <div className="preview-empty-table">当前工作表没有可显示的单元格。</div>
      ) : (
        <div className="preview-table-scroll">
          <table className="preview-spreadsheet-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                {Array.from({ length: currentSheet.columns }, (_, index) => (
                  <th scope="col" key={index}>{columnLabel(currentSheet.startColumn + index)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {currentSheet.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  <th scope="row">{rowIndex + 1}</th>
                  {row.map((value, columnIndex) => <td key={columnIndex}>{value}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
