import * as XLSX from "xlsx";

const MAX_SHEETS = 100;
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;
const MAX_TOTAL_CELLS = 25_000;

function formatCell(cell) {
  if (!cell) return "";
  if (cell.f && cell.v === undefined) return `=${cell.f}`;
  if (cell.w !== undefined && cell.w !== null) return String(cell.w);
  if (cell.v instanceof Date) return cell.v.toLocaleString("zh-CN");
  if (cell.v === undefined || cell.v === null) return "";
  if (cell.t === "e") return "错误值";
  return String(cell.v);
}

function buildSheetView(sheet) {
  if (!sheet["!ref"]) return { rows: [], columns: 0, startColumn: 0, truncated: false };
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const startRow = Math.max(0, range.s.r);
  const startColumn = Math.max(0, range.s.c);
  const sourceRows = Math.max(0, range.e.r - startRow + 1);
  const sourceColumns = Math.max(0, range.e.c - startColumn + 1);
  const cellLimitedRows = Math.max(1, Math.floor(MAX_TOTAL_CELLS / Math.max(1, Math.min(sourceColumns, MAX_COLUMNS))));
  const endRow = Math.min(range.e.r, startRow + MAX_ROWS - 1);
  const limitedEndRow = Math.min(endRow, startRow + cellLimitedRows - 1);
  const endColumn = Math.min(range.e.c, startColumn + MAX_COLUMNS - 1);
  const rows = [];
  for (let rowIndex = startRow; rowIndex <= limitedEndRow; rowIndex += 1) {
    const row = [];
    for (let columnIndex = startColumn; columnIndex <= endColumn; columnIndex += 1) {
      const address = XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex });
      row.push(formatCell(sheet[address]));
    }
    rows.push(row);
  }
  return {
    rows,
    startColumn,
    columns: Math.max(0, endColumn - startColumn + 1),
    truncated: sourceRows > MAX_ROWS || sourceColumns > MAX_COLUMNS || sourceRows * sourceColumns > MAX_TOTAL_CELLS,
  };
}

function readOptions(extra = {}) {
  return {
    type: "array",
    cellDates: true,
    cellNF: true,
    cellHTML: false,
    bookVBA: false,
    bookFiles: false,
    WTF: false,
    ...extra,
  };
}

let sourceBuffer = null;
let sheetNames = [];

function loadSheet(index) {
  const workbook = XLSX.read(sourceBuffer, readOptions({ sheetRows: MAX_ROWS + 1 }));
  const name = sheetNames[index];
  return { name, ...buildSheetView(workbook.Sheets[name] || {}) };
}

self.onmessage = (event) => {
  try {
    if (event.data?.type === "load") {
      sourceBuffer = event.data.buffer;
      const metadata = XLSX.read(sourceBuffer, readOptions({ bookSheets: true, bookProps: false }));
      sheetNames = (metadata.SheetNames || []).slice(0, MAX_SHEETS);
      self.postMessage({
        type: "metadata",
        sheetNames,
        truncatedSheets: (metadata.SheetNames || []).length > MAX_SHEETS,
      });
      if (sheetNames.length) {
        self.postMessage({ type: "sheet", index: 0, requestId: event.data.requestId || 0, sheet: loadSheet(0) });
      }
      return;
    }
    if (event.data?.type === "load-sheet" && sourceBuffer && Number.isInteger(event.data.index)) {
      const index = event.data.index;
      if (index < 0 || index >= sheetNames.length) throw new Error("sheet index out of range");
      self.postMessage({ type: "sheet", index, requestId: event.data.requestId || 0, sheet: loadSheet(index) });
    }
  } catch {
    self.postMessage({ type: "error" });
  }
};
