/** 批量 mutation、取消和重试使用的 command service。 */
export function createLibraryBatchActions(repository) {
  return Object.freeze({
    setFavorite(fileIds, favorite, operationId) {
      return repository.batchSetFavorite(fileIds, favorite, operationId);
    },
    removeIndexEntries(fileIds, operationId) {
      return repository.batchRemoveIndexEntries(fileIds, operationId);
    },
    updateTags(fileIds, tags, add, operationId) {
      return repository.batchUpdateTags(fileIds, tags, add, operationId);
    },
    setGroup(fileIds, groupId, operationId) {
      return repository.batchSetGroup(fileIds, groupId, operationId);
    },
    cancel(operationId) {
      return repository.cancelBatchOperation(operationId);
    },
  });
}

