export type EntryKind = "folder" | "other" | "markdown" | "text" | "doc" | "docx" | "xlsx" | "pdf" | "image" | "video";
export type PreviewStatus = "idle" | "loading" | "ready" | "unsupported" | "missing" | "permission-denied" | "too-large" | "converter-missing" | "parse-error" | "cancelled";
export type IpcCommand =
  | "load_file_index" | "list_directory" | "index_paths" | "refresh_index" | "get_index_recovery"
  | "reset_index_recovery" | "export_index_diagnostic" | "reposition_file" | "set_favorite"
  | "remove_index_entry" | "copy_indexed_file" | "open_indexed_file" | "reveal_indexed_file"
  | "rename_indexed_file" | "delete_original_file" | "load_settings" | "update_settings"
  | "floating_window_status" | "retry_floating_ball" | "tray_status" | "get_floating_recent"
  | "record_floating_paths" | "open_main_from_floating" | "load_floating_placement"
  | "save_floating_placement" | "set_floating_window_visible" | "show_main_window" | "exit_app"
  | "can_preview" | "load_preview" | "dispose_preview" | "cancel_preview_task";

export interface IndexEntry {
  id: string;
  path?: string;
  name: string;
  kind: EntryKind;
  type: string;
  size?: number;
  modifiedAt?: number;
  addedAt?: number;
  status: string;
  invalid?: boolean;
  favorite?: boolean;
}

export interface DirectoryEntry extends IndexEntry {
  directoryId: string;
  relativePath: string[];
}

export interface IndexRecoveryStatus {
  required: boolean;
  issue: string;
  backupCreated: boolean;
  pendingOperations: number;
}

export interface IndexSnapshot {
  entries: IndexEntry[];
  revision: number;
  recovery: IndexRecoveryStatus | null;
}

export interface IndexMutationResult {
  revision: number;
  changedIds: string[];
  entry: IndexEntry | null;
}

export interface PreviewResult {
  previewId: string;
  kind: EntryKind;
  status: PreviewStatus;
  content: Record<string, unknown> | null;
  byteLength: number;
}
