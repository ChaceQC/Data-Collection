/** 单条资料、标签和分组 mutation 的 command service。 */
export function createLibraryMutationActions(repository) {
  return Object.freeze({
    setFavorite(fileId, favorite) {
      return repository.setFavorite(fileId, favorite);
    },
    removeIndexEntry(fileId) {
      return repository.removeIndexEntry(fileId);
    },
    renameIndexedFile(fileId, newName) {
      return repository.renameIndexedFile(fileId, newName);
    },
    setEntryTags(fileId, tags) {
      return repository.setEntryTags(fileId, tags);
    },
    setEntryGroup(fileId, groupId) {
      return repository.setEntryGroup(fileId, groupId);
    },
    createGroup(name) {
      return repository.createGroup(name);
    },
    renameGroup(groupId, name) {
      return repository.renameGroup(groupId, name);
    },
    deleteGroup(groupId) {
      return repository.deleteGroup(groupId);
    },
  });
}

