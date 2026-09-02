import {
  invokeCommand,
  isDesktopRuntime,
  parseOperationHistory,
  parseOperationRecord,
} from "../../lib/ipcContracts.js";

export function loadOperationHistory() {
  if (!isDesktopRuntime()) return Promise.resolve({ records: [], warning: null });
  return invokeCommand("load_operation_history", undefined, parseOperationHistory);
}

export function saveOperationRecord(record) {
  if (!isDesktopRuntime()) return Promise.resolve(record);
  return invokeCommand("save_operation_record", { record }, parseOperationRecord);
}

export function clearOperationHistory() {
  if (!isDesktopRuntime()) return Promise.resolve();
  return invokeCommand("clear_operation_history", undefined);
}
