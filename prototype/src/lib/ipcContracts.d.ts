export type EntryKind = "folder" | "other" | "markdown" | "text" | "doc" | "docx" | "xlsx" | "pdf" | "image" | "video";
export type PreviewStatus = "idle" | "loading" | "ready" | "unsupported" | "missing" | "permission-denied" | "too-large" | "converter-missing" | "parse-error" | "cancelled" | "timed-out";
export type FloatingOpenAction = "locate" | "preview";
export type IpcCommand =
  | "load_file_index" | "list_directory" | "reveal_directory_child" | "index_paths" | "import_folders_recursive" | "refresh_index"
  | "content_index_status" | "search_content" | "search_metadata" | "rebuild_content_index" | "clear_content_index" | "cancel_content_index" | "get_index_recovery"
  | "reset_index_recovery" | "export_index_diagnostic" | "reposition_file" | "set_favorite"
  | "remove_index_entry" | "copy_indexed_file" | "open_indexed_file" | "reveal_indexed_file"
  | "rename_indexed_file" | "delete_original_file" | "set_entry_tags" | "set_entry_group"
  | "create_group" | "rename_group" | "delete_group" | "batch_set_favorite"
  | "batch_remove_index_entries" | "batch_update_tags" | "batch_set_group" | "cancel_batch_operation" | "undo_last"
  | "load_operation_history" | "save_operation_record" | "clear_operation_history"
  | "load_settings" | "update_settings"
  | "floating_window_status" | "retry_floating_ball" | "tray_status" | "get_floating_recent" | "get_floating_files"
  | "record_floating_paths" | "open_main_from_floating" | "load_floating_placement"
  | "save_floating_placement" | "set_floating_window_visible" | "show_main_window" | "exit_app"
  | "can_preview" | "load_preview" | "dispose_preview" | "cancel_preview_task" | "record_preview_outcome";

export interface IndexEntry {
  id: string;
  path?: string;
  name: string;
  kind: EntryKind;
  type: string;
  size?: number;
  modifiedAt?: number;
  addedAt?: number;
  lastOpenedAt?: number | null;
  previewStatus?: PreviewStatus;
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

export type FloatingFilesFilter = "all" | "favorite" | "folder" | "invalid";
export type FloatingFilesSortKey = "name" | "type" | "modifiedAt" | "lastOpenedAt";
export type FloatingFilesDirection = "asc" | "desc";

export interface FloatingFilesQuery {
  query: string;
  filter: FloatingFilesFilter;
  sortKey: FloatingFilesSortKey;
  direction: FloatingFilesDirection;
  offset: number;
  limit: number;
}

export interface FloatingFileItem {
  id: string;
  name: string;
  type: string;
  kind: "file" | "folder" | "other";
  status: string;
  invalid: boolean;
  favorite: boolean;
  size: number | null;
  modifiedAt: number | null;
  lastOpenedAt: number | null;
  groupId: string | null;
  groupName: string | null;
}

export interface FloatingFilesResult {
  revision: number;
  items: FloatingFileItem[];
  total: number;
  offset: number;
  limit: number;
  hasMore: boolean;
}

export interface FloatingOpenEvent {
  fileId: string;
  action: FloatingOpenAction;
}

export interface ExternalOpenResult {
  name: string;
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

export type ContentIndexState = "ready" | "indexing" | "recovery" | "unavailable";

export interface ContentIndexStatus {
  state: ContentIndexState;
  indexedCount: number;
  totalBytes: number;
  failedCount: number;
  sourceRevision: number;
  lastError: string | null;
}

export interface ContentTextRange {
  start: number;
  end: number;
}

export interface ContentSnippet {
  text: string;
  ranges: ContentTextRange[];
}

export interface ContentSearchResult {
  fileId: string;
  matchCount: number;
  matchesTruncated: boolean;
  snippets: ContentSnippet[];
}

export interface ContentSearchResponse {
  status: ContentIndexStatus;
  results: ContentSearchResult[];
}

export type MetadataSearchField = "name" | "type" | "status" | "location" | "tag" | "group";

export interface MetadataSearchTarget {
  directoryId: string;
  relativePath: string[];
}

export interface MetadataSearchQuery {
  query: string;
  useRegex: boolean;
  activeNav: "library" | "recent" | "recent-opened" | "favorites" | "invalid";
  filter: string;
  groupIds: string[];
  tags: string[];
  targetDirectory: MetadataSearchTarget | null;
}

export interface MetadataTextRange {
  start: number;
  end: number;
}

export interface MetadataSearchHit {
  fileId: string;
  field: MetadataSearchField;
  ranges: MetadataTextRange[];
}

export interface MetadataSearchResponse {
  revision: number;
  matchedIds: string[];
  hits: MetadataSearchHit[];
  total: number;
  truncated: boolean;
}

export interface ContentIndexRebuildResult {
  operationId: string;
  revision: number;
  indexedCount: number;
  updatedCount: number;
  removedCount: number;
  skippedCount: number;
  skippedReasons: string[];
  cancelled: boolean;
  timedOut: boolean;
  status: ContentIndexStatus;
}

export interface RecursiveImportResult {
  operationId: string;
  revision: number;
  scannedCount: number;
  candidateCount: number;
  indexedCount: number;
  refreshedCount: number;
  skippedCount: number;
  skippedReasons: string[];
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
  addedIds: string[];
}

export interface RecursiveImportPolicy {
  maxDepth: number;
  maxEntries: number;
  skipHidden: boolean;
  includeUnsupported: boolean;
}

export interface RecursiveImportProgress {
  operationId: string;
  phase: "scanning" | "merging" | "completed" | "failed";
  scannedCount: number;
  candidateCount: number;
  acceptedCount: number;
  skippedCount: number;
  currentName: string | null;
  truncated: boolean;
  cancelled: boolean;
  timedOut: boolean;
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
  indexRevision: number;
  content: Record<string, unknown> | null;
  byteLength: number;
  reason: string | null;
}

export interface PreviewSupport {
  supported: boolean;
  kind: EntryKind;
  status: PreviewStatus;
  indexRevision: number;
  reason: string | null;
}
