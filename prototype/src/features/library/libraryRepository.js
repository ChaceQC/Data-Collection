import {
  invokeCommand,
  makeDirectoryTarget,
  parseDirectoryEntries,
  parseBatchMutationResult,
  parseContentIndexRebuildResult,
  parseContentIndexStatus,
  parseContentSearchResponse,
  parseMetadataSearchResponse,
  parseGroupMutationResult,
  parseIndexImportResult,
  parseRecursiveImportResult,
  parseIndexRefreshResult,
  parseIndexSnapshot,
  parseMutationResult,
  parseTargetMutationResult,
} from "../../lib/ipcContracts.js";

export const libraryRepository = Object.freeze({
  loadIndex() {
    return invokeCommand("load_file_index", undefined, parseIndexSnapshot);
  },
  listDirectory(directoryId, relativePath = []) {
    return invokeCommand("list_directory", { target: makeDirectoryTarget(directoryId, relativePath) }, parseDirectoryEntries);
  },
  revealDirectoryChild(directoryId, relativePath = []) {
    return invokeCommand("reveal_directory_child", { target: makeDirectoryTarget(directoryId, relativePath) }, (value, command) => parseNamedResult(value, command));
  },
  indexPaths(paths) {
    return invokeCommand("index_paths", { paths }, parseIndexImportResult);
  },
  importFoldersRecursive(paths, operationId, policy) {
    return invokeCommand("import_folders_recursive", { paths, operationId, policy }, parseRecursiveImportResult);
  },
  refreshIndex() {
    return invokeCommand("refresh_index", undefined, parseIndexRefreshResult);
  },
  contentIndexStatus() {
    return invokeCommand("content_index_status", undefined, parseContentIndexStatus);
  },
  searchContent(query, useRegex, requestId) {
    return invokeCommand("search_content", { query, useRegex, requestId }, (value, command) => {
      const response = parseContentSearchResponse(value, command);
      if (response.requestId !== requestId) throw new TypeError("正文搜索响应标识不一致");
      return response;
    });
  },
  cancelContentSearch(requestId) {
    return invokeCommand("cancel_content_search", { requestId });
  },
  searchMetadata(query) {
    return invokeCommand("search_metadata", { query }, parseMetadataSearchResponse);
  },
  rebuildContentIndex(operationId) {
    return invokeCommand("rebuild_content_index", { operationId }, parseContentIndexRebuildResult);
  },
  clearContentIndex() {
    return invokeCommand("clear_content_index", undefined, parseContentIndexStatus);
  },
  cancelContentIndex(operationId) {
    return invokeCommand("cancel_content_index", { operationId });
  },
  resetIndexRecovery() {
    return invokeCommand("reset_index_recovery", undefined, parseIndexSnapshot);
  },
  exportIndexDiagnostic(destination) {
    return invokeCommand("export_index_diagnostic", { destination });
  },
  repositionFile(fileId, newPath) {
    return invokeCommand("reposition_file", { fileId, newPath }, (value, command) => parseTargetMutationResult(value, fileId, command));
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
    return invokeCommand("rename_indexed_file", { fileId, newName }, (value, command) => parseTargetMutationResult(value, fileId, command));
  },
  deleteOriginalFile(fileId) {
    return invokeCommand("delete_original_file", { fileId }, parseMutationResult);
  },
  setEntryTags(fileId, tags) {
    return invokeCommand("set_entry_tags", { fileId, tags }, parseMutationResult);
  },
  setEntryGroup(fileId, groupId) {
    return invokeCommand("set_entry_group", { fileId, groupId }, parseMutationResult);
  },
  createGroup(name) {
    return invokeCommand("create_group", { name }, parseGroupMutationResult);
  },
  renameGroup(groupId, name) {
    return invokeCommand("rename_group", { groupId, name }, parseGroupMutationResult);
  },
  deleteGroup(groupId) {
    return invokeCommand("delete_group", { groupId }, parseGroupMutationResult);
  },
  batchSetFavorite(fileIds, favorite, operationId) {
    return invokeCommand("batch_set_favorite", { operationId, fileIds, favorite }, parseBatchMutationResult);
  },
  batchRemoveIndexEntries(fileIds, operationId) {
    return invokeCommand("batch_remove_index_entries", { operationId, fileIds }, parseBatchMutationResult);
  },
  batchUpdateTags(fileIds, tags, add, operationId) {
    return invokeCommand("batch_update_tags", { operationId, fileIds, tags, add }, parseBatchMutationResult);
  },
  batchSetGroup(fileIds, groupId, operationId) {
    return invokeCommand("batch_set_group", { operationId, fileIds, groupId }, parseBatchMutationResult);
  },
  cancelBatchOperation(operationId) {
    return invokeCommand("cancel_batch_operation", { operationId });
  },
  undoLast() {
    return invokeCommand("undo_last", undefined, parseMutationResult);
  },
});

function parseNamedResult(value, command) {
  if (!value || typeof value !== "object" || typeof value.name !== "string") throw new TypeError(`${command} 返回结果无效`);
  return value;
}
