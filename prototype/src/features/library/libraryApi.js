import { isDesktopRuntime } from "../../lib/ipcContracts.js";
import { libraryRepository } from "./libraryRepository.js";

export function canUseLibraryRuntime() {
  return isDesktopRuntime();
}

export const {
  setFavorite,
  removeIndexEntry,
  copyIndexedFile,
  openIndexedFile,
  revealIndexedFile,
  renameIndexedFile,
  deleteOriginalFile,
} = libraryRepository;
