import * as XLSX from "xlsx";

const MAX_SHEETS = 100;
const MAX_ROWS = 500;
const MAX_COLUMNS = 50;

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
  const endRow = Math.min(range.e.r, startRow + MAX_ROWS - 1);
  const endColumn = Math.min(range.e.c, startColumn + MAX_COLUMNS - 1);
  const rows = [];
  for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
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
    truncated: range.e.r - startRow + 1 > MAX_ROWS || range.e.c - startColumn + 1 > MAX_COLUMNS,
  };
}

function parseWorkbook(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, {
    type: "array",
    cellDates: true,
    cellNF: true,
    cellHTML: false,
    bookVBA: false,
    bookFiles: false,
    WTF: false,
  });
  const sourceSheetNames = workbook.SheetNames || [];
  const sheetNames = sourceSheetNames.slice(0, MAX_SHEETS);
  return {
    sheets: sheetNames.map((name) => ({ name, ...buildSheetView(workbook.Sheets[name] || {}) })),
    truncatedSheets: sourceSheetNames.length > MAX_SHEETS,
  };
}

self.onmessage = (event) => {
  try {
    self.postMessage({ type: "ready", workbook: parseWorkbook(event.data) });
  } catch {
    self.postMessage({ type: "error" });
  }
};
