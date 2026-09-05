/**
 * 导入领域的 command service。
 * 这里不保存 React 状态，只封装导入相关的 IPC 调用，便于 controller 和
 * 拖放/选择器入口共享同一套 command 参数。
 */
export function createLibraryImportActions(repository) {
  return Object.freeze({
    indexPaths(paths) {
      return repository.indexPaths(paths);
    },
    importFoldersRecursive(paths, operationId, policy) {
      return repository.importFoldersRecursive(paths, operationId, policy);
    },
    loadIndex() {
      return repository.loadIndex();
    },
    cancel(operationId) {
      return repository.cancelBatchOperation(operationId);
    },
  });
}

