/** 操作中心 undo 的 command service。 */
export function createLibraryHistoryActions(repository) {
  return Object.freeze({
    undoLast() {
      return repository.undoLast();
    },
  });
}

