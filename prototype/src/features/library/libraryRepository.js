import {
  invokeCommand,
  makeDirectoryTarget,
  parseDirectoryEntries,
  parseIndexImportResult,
  parseIndexRefreshResult,
  parseIndexSnapshot,
  parseMutationResult,
} from "../../lib/ipcContracts.js";

export const libraryRepository = Object.freeze({
  loadIndex() {
    return invokeCommand("load_file_index", undefined, parseIndexSnapshot);
  },
  listDirectory(directoryId, relativePath = []) {
    return invokeCommand("list_directory", { target: makeDirectoryTarget(directoryId, relativePath) }, parseDirectoryEntries);
  },
  indexPaths(paths) {
    return invokeCommand("index_paths", { paths }, parseIndexImportResult);
  },
  refreshIndex() {
    return invokeCommand("refresh_index", undefined, parseIndexRefreshResult);
  },
  resetIndexRecovery() {
    return invokeCommand("reset_index_recovery", undefined, parseIndexSnapshot);
  },
  exportIndexDiagnostic(destination) {
    return invokeCommand("export_index_diagnostic", { destination });
  },
  repositionFile(fileId, newPath) {
    return invokeCommand("reposition_file", { fileId, newPath }, parseMutationResult);
  },
  setFavorite(fileId, favorite) {
    return invokeCommand("set_favorite", { fileId, favorite }, parseMutationResult);
  },
  removeIndexEntry(fileId) {
    return invokeCommand("remove_index_entry", { fileId }, parseMutationResult);
  },
  copyIndexedFile(fileId) {
    return invokeCommand("copy_indexed_file", { fileId }, (value, command) => parseNamedResult(value, command));
  },
  openIndexedFile(fileId) {
    return invokeCommand("open_indexed_file", { fileId }, (value, command) => parseNamedResult(value, command));
  },
  revealIndexedFile(fileId) {
    return invokeCommand("reveal_indexed_file", { fileId }, (value, command) => parseNamedResult(value, command));
  },
  renameIndexedFile(fileId, newName) {
    return invokeCommand("rename_indexed_file", { fileId, newName }, parseMutationResult);
  },
  deleteOriginalFile(fileId) {
    return invokeCommand("delete_original_file", { fileId }, parseMutationResult);
  },
});

function parseNamedResult(value, command) {
  if (!value || typeof value !== "object" || typeof value.name !== "string") throw new TypeError(`${command} 返回结果无效`);
  return value;
}
