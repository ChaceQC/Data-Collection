/** 默认打开、定位、剪贴板、重命名和物理文件操作的 command service。 */
export function createLibraryFileActions(repository) {
  return Object.freeze({
    copy(fileId) {
      return repository.copyIndexedFile(fileId);
    },
    openDefault(fileId) {
      return repository.openIndexedFile(fileId);
    },
    reveal(fileId) {
      return repository.revealIndexedFile(fileId);
    },
    revealDirectoryChild(directoryId, relativePath) {
      return repository.revealDirectoryChild(directoryId, relativePath);
    },
    deleteOriginal(fileId) {
      return repository.deleteOriginalFile(fileId);
    },
    reposition(fileId, newPath) {
      return repository.repositionFile(fileId, newPath);
    },
  });
}

