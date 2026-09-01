export type EntryKind = "folder" | "other" | "markdown" | "text" | "doc" | "docx" | "xlsx" | "pdf" | "image" | "video";
export type PreviewStatus = "idle" | "loading" | "ready" | "unsupported" | "missing" | "permission-denied" | "too-large" | "converter-missing" | "parse-error" | "cancelled";
export type IpcCommand =
  | "load_file_index" | "list_directory" | "reveal_directory_child" | "index_paths" | "refresh_index" | "get_index_recovery"
  | "reset_index_recovery" | "export_index_diagnostic" | "reposition_file" | "set_favorite"
  | "remove_index_entry" | "copy_indexed_file" | "open_indexed_file" | "reveal_indexed_file"
  | "rename_indexed_file" | "delete_original_file" | "set_entry_tags" | "set_entry_group"
  | "create_group" | "rename_group" | "delete_group" | "batch_set_favorite"
  | "batch_remove_index_entries" | "batch_update_tags" | "batch_set_group" | "cancel_batch_operation" | "undo_last"
  | "load_operation_history" | "save_operation_record" | "clear_operation_history"
  | "load_settings" | "update_settings"
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
  tags?: string[];
  groupId?: string | null;
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
  groups: Group[];
  revision: number;
  recovery: IndexRecoveryStatus | null;
  undo: UndoStatus | null;
}

export interface Group {
  id: string;
  name: string;
}

export interface UndoStatus {
  id: string;
  operation: string;
  count: number;
}

export interface IndexMutationResult {
  revision: number;
  changedIds: string[];
  entry: IndexEntry | null;
}

export interface GroupMutationResult {
  revision: number;
  changedIds: string[];
  group: Group | null;
}

export interface BatchItemResult {
  id: string;
  status: "success" | "failed" | "skipped";
  reason: string | null;
}

export interface BatchMutationResult {
  operationId: string;
  revision: number;
  changedIds: string[];
  operation: string;
  results: BatchItemResult[];
  cancelled: boolean;
  timedOut: boolean;
}

export type OperationStatus = "in-progress" | "success" | "partial-success" | "failed" | "cancelled" | "timed-out";

export interface OperationRequest {
  favorite: boolean | null;
  tags: string[];
  add: boolean | null;
  groupId: string | null;
}

export interface OperationItemRecord {
  id: string;
  status: "success" | "failed" | "skipped";
  reason: string | null;
}

export interface OperationRecord {
  id: string;
  operation: string;
  status: OperationStatus;
  startedAt: number;
  finishedAt: number | null;
  totalCount: number;
  addedCount: number;
  updatedCount: number;
  invalidCount: number;
  recoveredCount: number;
  successCount: number;
  skippedCount: number;
  failedCount: number;
  results: OperationItemRecord[];
  retryableIds: string[];
  skippedReasons: string[];
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  message: string | null;
  request: OperationRequest | null;
}

export interface OperationHistorySnapshot {
  records: OperationRecord[];
  warning: string | null;
}

export interface AppSettings {
  revision: number;
  defaultSort: { key: string; direction: "asc" | "desc" };
  pageSize: number;
  confirmBeforeRemove: boolean;
  hideToTray: boolean;
  showFloatingWindow: boolean;
  previewLimits: Array<{ label: string; maxBytes: number; maxPixels: number | null }>;
  warning: string | null;
}

export interface PreviewResult {
  previewId: string;
  kind: EntryKind;
  status: PreviewStatus;
  content: Record<string, unknown> | null;
  byteLength: number;
}
