import { invoke, isTauri } from "@tauri-apps/api/core";

export function canUseLibraryRuntime() {
  return isTauri();
}

export function setFavorite(fileId, favorite) {
  return invoke("set_favorite", { fileId, favorite });
}

export function removeIndexEntry(fileId) {
  return invoke("remove_index_entry", { fileId });
}

export function copyIndexedFile(fileId) {
  return invoke("copy_indexed_file", { fileId });
}

export function openIndexedFile(fileId) {
  return invoke("open_indexed_file", { fileId });
}

export function revealIndexedFile(fileId) {
  return invoke("reveal_indexed_file", { fileId });
}

export function renameIndexedFile(fileId, newName) {
  return invoke("rename_indexed_file", { fileId, newName });
}

export function deleteOriginalFile(fileId) {
  return invoke("delete_original_file", { fileId });
}
