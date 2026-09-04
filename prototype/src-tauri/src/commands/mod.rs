use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::storage::repository::IndexRepository;
use crate::{
    filesystem::{self, DirectoryEntry, IndexEntry},
    preview::{self, PreviewOptions, PreviewResult, PreviewState, PreviewSupport},
    storage::{self, AppState, Group, IndexSnapshot, StorageError},
};

pub(crate) mod floating_ball;
pub(crate) mod library;
pub(crate) mod operation_history;
pub(crate) mod settings;
pub(crate) mod window;

const BATCH_TIMEOUT: Duration = Duration::from_secs(10);
const RECURSIVE_IMPORT_TIMEOUT: Duration = Duration::from_secs(30);
const CONTENT_INDEX_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Debug, Default)]
pub struct BatchState {
    operations: Mutex<HashMap<String, Arc<BatchControl>>>,
}

#[derive(Debug)]
pub(crate) struct BatchControl {
    cancelled: AtomicBool,
    started_at: Instant,
    timeout: Duration,
    timeout_reason: &'static str,
}

impl BatchState {
    pub(crate) fn begin(&self, operation_id: &str) -> Result<Arc<BatchControl>, CommandError> {
        self.begin_with_timeout(operation_id, BATCH_TIMEOUT, "批量操作超时")
    }

    pub(crate) fn begin_recursive(
        &self,
        operation_id: &str,
    ) -> Result<Arc<BatchControl>, CommandError> {
        self.begin_with_timeout(operation_id, RECURSIVE_IMPORT_TIMEOUT, "递归导入扫描超时")
    }

    pub(crate) fn begin_content_index(
        &self,
        operation_id: &str,
    ) -> Result<Arc<BatchControl>, CommandError> {
        self.begin_with_timeout(operation_id, CONTENT_INDEX_TIMEOUT, "正文索引重建超时")
    }

    fn begin_with_timeout(
        &self,
        operation_id: &str,
        timeout: Duration,
        timeout_reason: &'static str,
    ) -> Result<Arc<BatchControl>, CommandError> {
        if !is_valid_operation_id(operation_id) {
            return Err(command_error(
                "invalid-operation-id",
                "批量操作标识无效",
                false,
                "unchanged",
            ));
        }
        let control = Arc::new(BatchControl {
            cancelled: AtomicBool::new(false),
            started_at: Instant::now(),
            timeout,
            timeout_reason,
        });
        let mut operations = self
            .operations
            .lock()
            .map_err(|_| command_error("batch-state", "批量操作状态不可用", true, "unknown"))?;
        if operations.contains_key(operation_id) {
            return Err(command_error(
                "batch-busy",
                "相同的批量操作正在进行",
                true,
                "unchanged",
            ));
        }
        operations.insert(operation_id.to_string(), control.clone());
        Ok(control)
    }

    pub(crate) fn cancel(&self, operation_id: &str) -> Result<(), CommandError> {
        let operations = self
            .operations
            .lock()
            .map_err(|_| command_error("batch-state", "批量操作状态不可用", true, "unknown"))?;
        if let Some(control) = operations.get(operation_id) {
            control.cancelled.store(true, Ordering::Release);
        }
        Ok(())
    }

    pub(crate) fn finish(&self, operation_id: &str) {
        if let Ok(mut operations) = self.operations.lock() {
            operations.remove(operation_id);
        }
    }
}

impl BatchControl {
    pub(crate) fn stop_reason(&self) -> Option<&'static str> {
        if self.cancelled.load(Ordering::Acquire) {
            return Some("用户已取消");
        }
        if self.started_at.elapsed() >= self.timeout {
            return Some(self.timeout_reason);
        }
        None
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn timed_out(&self) -> bool {
        self.started_at.elapsed() >= self.timeout && !self.cancelled()
    }
}

fn is_valid_operation_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.contains("..")
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn normalize_recursive_paths(paths: Vec<String>) -> Result<Vec<String>, CommandError> {
    if paths.is_empty() {
        return Err(command_error(
            "recursive-root-invalid",
            "请选择要扫描的文件夹",
            false,
            "unchanged",
        ));
    }
    if paths.len() > 8 {
        return Err(command_error(
            "recursive-root-too-many",
            "一次最多扫描 8 个文件夹",
            false,
            "unchanged",
        ));
    }
    let mut normalized = Vec::with_capacity(paths.len());
    for path in paths {
        let path = path.trim();
        if path.is_empty() || path.len() > filesystem::recursive_import::MAX_PATH_BYTES {
            return Err(command_error(
                "recursive-root-invalid",
                "选择的文件夹路径无效或过长",
                false,
                "unchanged",
            ));
        }
        normalized.push(path.to_string());
    }
    Ok(normalized)
}

fn recursive_import_path_error(error: filesystem::PathValidationError) -> CommandError {
    match error {
        filesystem::PathValidationError::Missing => command_error(
            "recursive-root-missing",
            "选择的文件夹已不存在，请重新选择",
            false,
            "unchanged",
        ),
        filesystem::PathValidationError::PermissionDenied => command_error(
            "recursive-root-permission-denied",
            "没有访问所选文件夹的权限",
            false,
            "unchanged",
        ),
        filesystem::PathValidationError::Invalid => command_error(
            "recursive-root-invalid",
            "只能扫描可访问的普通文件夹，不能扫描符号链接或重解析点",
            false,
            "unchanged",
        ),
    }
}

fn emit_recursive_import_progress<R: Runtime>(
    app: &AppHandle<R>,
    event: RecursiveImportProgressEvent,
) {
    let _ = app.emit_to("main", "recursive-import-progress", event);
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexImportResult {
    pub revision: u64,
    pub indexed_count: usize,
    pub refreshed_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
    pub added_ids: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveImportProgressEvent {
    pub operation_id: String,
    pub phase: String,
    pub scanned_count: usize,
    pub candidate_count: usize,
    pub accepted_count: usize,
    pub skipped_count: usize,
    pub current_name: Option<String>,
    pub truncated: bool,
    pub cancelled: bool,
    pub timed_out: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveImportResult {
    pub operation_id: String,
    pub revision: u64,
    pub scanned_count: usize,
    pub candidate_count: usize,
    pub indexed_count: usize,
    pub refreshed_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
    pub cancelled: bool,
    pub timed_out: bool,
    pub added_ids: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexMutationResult {
    pub revision: u64,
    pub changed_ids: Vec<String>,
    pub entry: Option<IndexEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupMutationResult {
    pub revision: u64,
    pub changed_ids: Vec<String>,
    pub group: Option<Group>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchItemResult {
    pub id: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BatchMutationResult {
    pub operation_id: String,
    pub revision: u64,
    pub changed_ids: Vec<String>,
    pub operation: String,
    pub results: Vec<BatchItemResult>,
    pub cancelled: bool,
    pub timed_out: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandError {
    pub code: String,
    pub message: String,
    pub retryable: bool,
    pub state: String,
}

pub(crate) fn command_error(
    code: &str,
    message: impl Into<String>,
    retryable: bool,
    state: &str,
) -> CommandError {
    CommandError {
        code: code.to_string(),
        message: message.into(),
        retryable,
        state: state.to_string(),
    }
}

pub(crate) fn structured_storage_error(error: StorageError) -> CommandError {
    let (code, retryable, state) = match &error {
        StorageError::InvalidId => ("invalid-id", false, "unchanged"),
        StorageError::EntryNotFound => ("entry-not-found", false, "unchanged"),
        StorageError::DuplicateEntry => ("duplicate-entry", false, "unchanged"),
        StorageError::DuplicateGroup => ("duplicate-group", false, "unchanged"),
        StorageError::GroupNotFound => ("group-not-found", false, "unchanged"),
        StorageError::InvalidGroupName => ("invalid-group-name", false, "unchanged"),
        StorageError::InvalidTag => ("invalid-tag", false, "unchanged"),
        StorageError::UndoUnavailable => ("undo-unavailable", false, "unchanged"),
        StorageError::UndoConflict => ("undo-conflict", false, "unchanged"),
        StorageError::Write => ("storage-write", true, "unchanged"),
        StorageError::Recovery => ("recovery-required", true, "unknown"),
        StorageError::DataDirectory | StorageError::Read | StorageError::State => {
            ("storage-unavailable", true, "unknown")
        }
        StorageError::Corrupt | StorageError::UnsupportedVersion => {
            ("index-recovery-required", true, "unknown")
        }
    };
    command_error(code, error.to_string(), retryable, state)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRefreshResult {
    pub revision: u64,
    pub changed_ids: Vec<String>,
    pub changed_count: usize,
    pub invalid_count: usize,
    pub recovered_count: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIndexRebuildResult {
    pub operation_id: String,
    pub revision: u64,
    pub indexed_count: usize,
    pub updated_count: usize,
    pub removed_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub cancelled: bool,
    pub timed_out: bool,
    pub status: storage::content_index::ContentIndexStatus,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentSearchResponse {
    pub status: storage::content_index::ContentIndexStatus,
    pub results: Vec<storage::content_search::ContentSearchResult>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryTarget {
    pub directory_id: String,
    #[serde(default)]
    pub relative_path: Vec<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewTarget {
    pub file_id: Option<String>,
    pub directory_id: Option<String>,
    #[serde(default)]
    pub relative_path: Vec<String>,
}

#[tauri::command]
pub fn load_file_index(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexSnapshot, String> {
    let repository = IndexRepository::new(state.inner());
    let outcome = repository.load_and_refresh().map_err(storage_message)?;
    if outcome.changed || outcome.recovered_count > 0 {
        emit_index_changed(
            &app,
            outcome.snapshot.revision,
            outcome.changed_ids,
            if outcome.recovered_count > 0 {
                "recovery"
            } else {
                "refresh"
            },
        );
    }
    Ok(outcome.snapshot)
}

#[tauri::command]
pub async fn list_directory(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, String> {
    let (_root, path) = resolve_directory_target(&state, &target)?;
    let directory_id = target.directory_id;
    let relative_path = target.relative_path;
    tauri::async_runtime::spawn_blocking(move || {
        let children = filesystem::list_directory(&path.to_string_lossy())?;
        Ok::<_, filesystem::FileSystemError>(
            children
                .into_iter()
                .map(|entry| {
                    let mut child_path = relative_path.clone();
                    child_path.push(entry.name.clone());
                    DirectoryEntry::from_index_entry(entry, directory_id.clone(), child_path)
                })
                .collect(),
        )
    })
    .await
    .map_err(|_| "目录读取任务未完成，请重试".to_string())?
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn reveal_directory_child(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<library::ExternalOpenResult, String> {
    let (_root, path) = resolve_registered_directory_child(&state, &target)?;
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "登记的文件夹子项已失效，请刷新索引".to_string())?;
    if filesystem::is_unsafe_metadata(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("目标不是可访问的登记文件夹子项".to_string());
    }
    let is_directory = metadata.is_dir();
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "文件夹子项名称不可用".to_string())?
        .to_string();
    tauri::async_runtime::spawn_blocking(move || {
        crate::filesystem::external::reveal_in_explorer(&path, is_directory)
            .map_err(|_| "无法在资源管理器中定位，请检查路径".to_string())
    })
    .await
    .map_err(|_| "定位文件夹子项任务未完成，请重试".to_string())??;
    Ok(library::ExternalOpenResult { name })
}

#[tauri::command]
pub async fn index_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexImportResult, String> {
    if paths.is_empty() {
        return Err("请选择文件或文件夹".to_string());
    }

    filesystem::validate_scan_paths(&paths).map_err(|error| error.to_string())?;
    let scan = tauri::async_runtime::spawn_blocking(move || filesystem::scan_paths(&paths))
        .await
        .map_err(|_| "索引任务未完成，请重试".to_string())?
        .map_err(|error| error.to_string())?;
    let skipped_count = scan.skipped_count;
    let skipped_reasons = scan.skipped_reasons.clone();
    let truncated = scan.truncated;
    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .merge_entries(scan.entries, storage::IndexMergeMode::RegularImport)
        .map_err(storage_message)?;
    let merge_stats = outcome.value;

    if !merge_stats.affected_ids.is_empty() {
        emit_index_changed(
            &app,
            outcome.revision,
            merge_stats.affected_ids.clone(),
            "import",
        );
    }

    Ok(IndexImportResult {
        revision: outcome.revision,
        indexed_count: merge_stats.added_count,
        refreshed_count: merge_stats.refreshed_count,
        skipped_count,
        skipped_reasons,
        truncated: truncated || merge_stats.truncated,
        added_ids: merge_stats.added_ids,
    })
}

#[tauri::command]
pub async fn import_folders_recursive(
    paths: Vec<String>,
    operation_id: String,
    policy: Option<filesystem::recursive_import::RecursiveImportPolicy>,
    state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<RecursiveImportResult, CommandError> {
    let paths = normalize_recursive_paths(paths)?;
    let policy = policy.unwrap_or_default().normalized();
    let control = batch_state.begin_recursive(&operation_id)?;
    let control_for_task = control.clone();
    let app_for_task = app.clone();
    let operation_id_for_task = operation_id.clone();
    let policy_for_task = policy.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        emit_recursive_import_progress(
            &app_for_task,
            RecursiveImportProgressEvent {
                operation_id: operation_id_for_task.clone(),
                phase: "scanning".to_string(),
                scanned_count: 0,
                candidate_count: 0,
                accepted_count: 0,
                skipped_count: 0,
                current_name: None,
                truncated: false,
                cancelled: false,
                timed_out: false,
            },
        );
        filesystem::recursive_import::scan_paths_recursive(
            &paths,
            policy_for_task,
            || control_for_task.stop_reason().is_some(),
            |progress| {
                emit_recursive_import_progress(
                    &app_for_task,
                    RecursiveImportProgressEvent {
                        operation_id: operation_id_for_task.clone(),
                        phase: "scanning".to_string(),
                        scanned_count: progress.scanned_count,
                        candidate_count: progress.candidate_count,
                        accepted_count: progress.accepted_count,
                        skipped_count: progress.skipped_count,
                        current_name: progress.current_name,
                        truncated: progress.truncated,
                        cancelled: false,
                        timed_out: false,
                    },
                );
            },
        )
    })
    .await;
    let cancelled = control.cancelled();
    let timed_out = control.timed_out();
    batch_state.finish(&operation_id);
    let scan = match joined {
        Ok(Ok(scan)) => scan,
        Ok(Err(error)) => {
            return Err(recursive_import_path_error(error));
        }
        Err(_) => {
            return Err(command_error(
                "task-failed",
                "递归导入任务未完成，请重试",
                true,
                "unknown",
            ));
        }
    };

    let mut skipped_reasons = scan.skipped_reasons.clone();
    if cancelled {
        append_recursive_skip_reason(&mut skipped_reasons, "用户已取消");
    }
    if timed_out {
        append_recursive_skip_reason(&mut skipped_reasons, "递归导入扫描超时");
    }
    emit_recursive_import_progress(
        &app,
        RecursiveImportProgressEvent {
            operation_id: operation_id.clone(),
            phase: "merging".to_string(),
            scanned_count: scan.scanned_count,
            candidate_count: scan.candidate_count,
            accepted_count: scan.entries.len(),
            skipped_count: scan.skipped_count,
            current_name: None,
            truncated: scan.truncated,
            cancelled,
            timed_out,
        },
    );

    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .merge_entries(scan.entries, storage::IndexMergeMode::RegularImport)
        .map_err(structured_storage_error)?;
    let merge_stats = outcome.value;
    let truncated = scan.truncated || merge_stats.truncated;
    if !merge_stats.affected_ids.is_empty() {
        emit_index_changed(
            &app,
            outcome.revision,
            merge_stats.affected_ids.clone(),
            "recursive-import",
        );
    }
    emit_recursive_import_progress(
        &app,
        RecursiveImportProgressEvent {
            operation_id: operation_id.clone(),
            phase: "completed".to_string(),
            scanned_count: scan.scanned_count,
            candidate_count: scan.candidate_count,
            accepted_count: merge_stats.added_count + merge_stats.refreshed_count,
            skipped_count: scan.skipped_count,
            current_name: None,
            truncated,
            cancelled,
            timed_out,
        },
    );

    Ok(RecursiveImportResult {
        operation_id,
        revision: outcome.revision,
        scanned_count: scan.scanned_count,
        candidate_count: scan.candidate_count,
        indexed_count: merge_stats.added_count,
        refreshed_count: merge_stats.refreshed_count,
        skipped_count: scan.skipped_count,
        skipped_reasons,
        truncated,
        cancelled,
        timed_out,
        added_ids: merge_stats.added_ids,
    })
}

fn append_recursive_skip_reason(reasons: &mut Vec<String>, reason: &str) {
    if reasons.len() < 32 && !reasons.iter().any(|current| current == reason) {
        reasons.push(reason.to_string());
    }
}

#[tauri::command]
pub async fn reposition_file(
    file_id: String,
    new_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, String> {
    let replacement =
        tauri::async_runtime::spawn_blocking(move || filesystem::index_selected_path(&new_path))
            .await
            .map_err(|_| "重新定位任务未完成，请重试".to_string())?
            .map_err(|error| error.to_string())?;

    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .update_entries_with(|entries| {
            let position = entries
                .iter()
                .position(|entry| entry.id == file_id)
                .ok_or(StorageError::EntryNotFound)?;
            if !entries[position].invalid {
                return Err(StorageError::InvalidId);
            }
            let expects_folder = entries[position].kind == "folder";
            if expects_folder != (replacement.kind == "folder") {
                return Err(StorageError::InvalidId);
            }
            if entries.iter().enumerate().any(|(index, entry)| {
                index != position && filesystem::same_path(&entry.path, &replacement.path)
            }) {
                return Err(StorageError::DuplicateEntry);
            }

            let id = entries[position].id.clone();
            let favorite = entries[position].favorite;
            let added_at = entries[position].added_at;
            let preview_status = entries[position].preview_status.clone();
            let last_recorded_at = entries[position].last_recorded_at;
            let last_opened_at = entries[position].last_opened_at;
            let tags = entries[position].tags.clone();
            let group_id = entries[position].group_id.clone();
            let mut replacement = replacement;
            replacement.id = id;
            replacement.favorite = favorite;
            replacement.added_at = added_at;
            replacement.preview_status = preview_status;
            replacement.last_recorded_at = last_recorded_at;
            replacement.last_opened_at = last_opened_at;
            replacement.tags = tags;
            replacement.group_id = group_id;
            entries[position] = replacement;
            storage::sort_entries(entries);
            Ok((true, Some(entries[position].clone())))
        })
        .map_err(|error| match error {
            StorageError::InvalidId if file_id.trim().is_empty() => "资料 ID 不能为空".to_string(),
            StorageError::InvalidId => "重新定位的文件类型不匹配，请选择相同类型的路径".to_string(),
            other => storage_message(other),
        })?;
    emit_index_changed(&app, outcome.revision, vec![file_id.clone()], "reposition");
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids: vec![file_id],
        entry: outcome.value,
    })
}

#[tauri::command]
pub async fn can_preview(
    target: PreviewTarget,
    kind: String,
    state: State<'_, AppState>,
) -> Result<PreviewSupport, String> {
    let (path, _) = resolve_preview_target(&state, &target)?;
    tauri::async_runtime::spawn_blocking(move || {
        preview::can_preview(&path.to_string_lossy(), &kind)
    })
    .await
    .map_err(|_| "预览检查任务未完成，请重试".to_string())
}

#[tauri::command]
pub async fn load_preview(
    target: PreviewTarget,
    kind: String,
    options: Option<PreviewOptions>,
    index_state: State<'_, AppState>,
    state: State<'_, PreviewState>,
    app: AppHandle,
) -> Result<PreviewResult, String> {
    let (path, _) = resolve_preview_target(&index_state, &target)?;
    let preview_state = state.inner().clone();
    let options = options.unwrap_or_default();
    let (task_id, cancellation) = preview_state.begin_task(options.task_id.clone());
    let task_id_for_task = task_id.clone();
    let cancellation_for_task = cancellation.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let result = preview::load_preview_with_cancellation(
            &path.to_string_lossy(),
            &kind,
            options,
            &preview_state,
            &cancellation_for_task,
        );
        preview_state.finish_task(&task_id_for_task, &cancellation_for_task);
        result
    })
    .await;
    match join_result {
        Ok(result) => {
            if result.status == "ready" {
                if let Some(file_id) = target.file_id.as_deref() {
                    let _ = record_entry_opened(index_state.inner(), &app, file_id);
                }
            }
            Ok(result)
        }
        Err(_) => {
            state.cancel_task(&task_id);
            state.finish_task(&task_id, &cancellation);
            Err("预览任务未完成，请重试".to_string())
        }
    }
}

#[tauri::command]
pub fn dispose_preview(preview_id: String, state: State<'_, PreviewState>) -> Result<(), String> {
    preview::dispose_preview(state.inner(), &preview_id);
    Ok(())
}

#[tauri::command]
pub fn cancel_preview_task(task_id: String, state: State<'_, PreviewState>) -> Result<(), String> {
    state.cancel_task(&task_id);
    Ok(())
}

#[tauri::command]
pub fn get_index_recovery(
    state: State<'_, AppState>,
) -> Result<Option<storage::IndexRecoveryStatus>, String> {
    let repository = IndexRepository::new(state.inner());
    repository
        .snapshot()
        .map(|snapshot| snapshot.recovery)
        .map_err(storage_message)
}

#[tauri::command]
pub fn reset_index_recovery(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexSnapshot, String> {
    let repository = IndexRepository::new(state.inner());
    let snapshot = repository.reset_index_recovery().map_err(storage_message)?;
    emit_index_changed(&app, snapshot.revision, Vec::new(), "recovery");
    Ok(snapshot)
}

#[tauri::command]
pub fn export_index_diagnostic(
    destination: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repository = IndexRepository::new(state.inner());
    repository
        .export_recovery_diagnostic(&PathBuf::from(destination))
        .map_err(storage_message)
}

#[tauri::command]
pub async fn refresh_index(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexRefreshResult, String> {
    let repository = IndexRepository::new(state.inner());
    let entries = repository.snapshot().map_err(storage_message)?.entries;
    let checked = tauri::async_runtime::spawn_blocking(move || {
        entries
            .iter()
            .map(filesystem::refresh_entry_snapshot)
            .collect::<Vec<_>>()
    })
    .await
    .map_err(|_| "索引刷新任务未完成，请重试".to_string())?;
    apply_refresh_result(&repository, &app, checked)
}

#[tauri::command]
pub fn content_index_status(
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    state.inner().status().map_err(content_index_error)
}

#[tauri::command]
pub fn search_content(
    query: String,
    use_regex: bool,
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<ContentSearchResponse, CommandError> {
    let search = state
        .inner()
        .search_snapshot(&query, use_regex)
        .map_err(content_index_error)?;
    Ok(ContentSearchResponse {
        status: search.status,
        results: search.results,
    })
}

#[tauri::command]
pub async fn search_metadata(
    query: storage::metadata_search::MetadataSearchQuery,
    state: State<'_, AppState>,
) -> Result<storage::metadata_search::MetadataSearchResponse, CommandError> {
    let snapshot = state.snapshot().map_err(storage_command_error)?;
    let entries = if let Some(target) = query.target_directory.as_ref() {
        let directory_target = DirectoryTarget {
            directory_id: target.directory_id.clone(),
            relative_path: target.relative_path.clone(),
        };
        let (_, path) = resolve_directory_target(&state, &directory_target).map_err(|message| {
            command_error(
                "metadata-search-target-invalid",
                message,
                false,
                "unchanged",
            )
        })?;
        tauri::async_runtime::spawn_blocking(move || {
            filesystem::list_directory(&path.to_string_lossy())
        })
        .await
        .map_err(|_| {
            command_error(
                "metadata-search-unavailable",
                "当前文件夹读取任务未完成，请重试",
                true,
                "unknown",
            )
        })?
        .map_err(|_| {
            command_error(
                "metadata-search-target-invalid",
                "当前文件夹内容无法读取，请刷新后重试",
                true,
                "unchanged",
            )
        })?
    } else {
        snapshot.entries
    };
    storage::metadata_search::search(&entries, &snapshot.groups, snapshot.revision, &query)
        .map_err(metadata_search_error)
}

#[tauri::command]
pub async fn rebuild_content_index(
    operation_id: String,
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<ContentIndexRebuildResult, CommandError> {
    let control = batch_state.begin_content_index(&operation_id)?;
    let snapshot = match state.snapshot() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            batch_state.finish(&operation_id);
            return Err(storage_command_error(error));
        }
    };
    let entries = snapshot.entries;
    let revision = snapshot.revision;
    if let Err(error) = content_state.inner().mark_indexing() {
        batch_state.finish(&operation_id);
        return Err(content_index_error(error));
    }
    emit_content_index_status(&app, content_state.inner());
    let content_for_task = content_state.inner().clone();
    let control_for_task = control.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        content_for_task.rebuild(&entries, revision, &|| {
            control_for_task.stop_reason().is_some()
        })
    })
    .await;
    let cancelled = control.cancelled();
    let timed_out = control.timed_out();
    batch_state.finish(&operation_id);
    let result = match joined {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => {
            if !matches!(
                &error,
                storage::content_index::ContentIndexError::RecoveryRequired
            ) {
                content_state.inner().mark_unavailable(&error.to_string());
            }
            emit_content_index_status(&app, content_state.inner());
            return Err(content_index_error(error));
        }
        Err(_) => {
            content_state
                .inner()
                .mark_unavailable("正文索引任务未完成，请重试");
            emit_content_index_status(&app, content_state.inner());
            return Err(command_error(
                "task-failed",
                "正文索引任务未完成，请重试",
                true,
                "unknown",
            ));
        }
    };
    let status = content_state.status().map_err(content_index_error)?;
    emit_content_index_status(&app, content_state.inner());
    Ok(ContentIndexRebuildResult {
        operation_id,
        revision,
        indexed_count: result.indexed_count,
        updated_count: result.updated_count,
        removed_count: result.removed_count,
        skipped_count: result.skipped_count,
        skipped_reasons: result.skipped_reasons,
        cancelled: cancelled || result.cancelled,
        timed_out,
        status,
    })
}

#[tauri::command]
pub fn clear_content_index(
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    app: AppHandle,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    let revision = state.snapshot().map_err(storage_command_error)?.revision;
    let status = content_state
        .inner()
        .clear(revision)
        .map_err(content_index_error)?;
    emit_content_index_status(&app, content_state.inner());
    Ok(status)
}

#[tauri::command]
pub fn cancel_content_index(
    operation_id: String,
    state: State<'_, BatchState>,
) -> Result<(), CommandError> {
    if !is_valid_operation_id(&operation_id) {
        return Err(command_error(
            "invalid-operation-id",
            "正文索引操作标识无效",
            false,
            "unchanged",
        ));
    }
    state.cancel(&operation_id)
}

pub(crate) fn refresh_index_sync<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<IndexRefreshResult, String> {
    let repository = IndexRepository::new(state);
    let reconciled = repository
        .reconcile_pending_operations()
        .map_err(storage_message)?;
    let entries = repository.snapshot().map_err(storage_message)?.entries;
    let checked = entries
        .iter()
        .map(filesystem::refresh_entry_snapshot)
        .collect::<Vec<_>>();
    let mut result = apply_refresh_result_without_reconcile(&repository, checked)?;
    if result.changed_count > 0 {
        emit_index_changed(app, result.revision, result.changed_ids.clone(), "refresh");
    }
    if reconciled {
        result.recovered_count = 1;
        if result.changed_ids.is_empty() {
            emit_index_changed(app, result.revision, Vec::new(), "recovery");
        }
    }
    Ok(result)
}

fn apply_refresh_result<R: Runtime>(
    repository: &IndexRepository<'_>,
    app: &AppHandle<R>,
    checked: Vec<IndexEntry>,
) -> Result<IndexRefreshResult, String> {
    let reconciled = repository
        .reconcile_pending_operations()
        .map_err(storage_message)?;
    let mut result = apply_refresh_result_without_reconcile(repository, checked)?;
    if result.changed_count > 0 {
        emit_index_changed(app, result.revision, result.changed_ids.clone(), "refresh");
    }
    if reconciled {
        result.recovered_count = 1;
        if result.changed_ids.is_empty() {
            emit_index_changed(app, result.revision, Vec::new(), "recovery");
        }
    }
    Ok(result)
}

fn apply_refresh_result_without_reconcile(
    repository: &IndexRepository<'_>,
    checked: Vec<IndexEntry>,
) -> Result<IndexRefreshResult, String> {
    let outcome = repository.apply_refresh(checked).map_err(storage_message)?;
    let invalid_count = outcome.entries.iter().filter(|entry| entry.invalid).count();
    let changed_ids = outcome.value;
    Ok(IndexRefreshResult {
        revision: outcome.revision,
        changed_count: changed_ids.len(),
        changed_ids,
        invalid_count,
        recovered_count: 0,
    })
}

pub(super) fn storage_message(error: StorageError) -> String {
    error.to_string()
}

fn storage_command_error(error: StorageError) -> CommandError {
    structured_storage_error(error)
}

fn content_index_error(error: storage::content_index::ContentIndexError) -> CommandError {
    let message = error.to_string();
    let (code, retryable, state) = match &error {
        storage::content_index::ContentIndexError::InvalidQuery => {
            ("invalid-content-query", false, "unchanged")
        }
        storage::content_index::ContentIndexError::RecoveryRequired
        | storage::content_index::ContentIndexError::Corrupt
        | storage::content_index::ContentIndexError::UnsupportedVersion => {
            ("content-index-recovery-required", true, "unknown")
        }
        storage::content_index::ContentIndexError::Unavailable
        | storage::content_index::ContentIndexError::Read
        | storage::content_index::ContentIndexError::Write => {
            ("content-index-unavailable", true, "unknown")
        }
        storage::content_index::ContentIndexError::Stale => {
            ("content-index-stale", true, "unknown")
        }
    };
    command_error(code, message, retryable, state)
}

fn metadata_search_error(error: storage::metadata_search::MetadataSearchError) -> CommandError {
    command_error(
        "invalid-metadata-query",
        error.to_string(),
        false,
        "unchanged",
    )
}

fn resolve_directory_target(
    state: &AppState,
    target: &DirectoryTarget,
) -> Result<(IndexEntry, PathBuf), String> {
    let (root, path) = resolve_registered_directory_child(state, target)?;
    let metadata =
        std::fs::symlink_metadata(&path).map_err(|_| "文件夹路径已失效，请刷新索引".to_string())?;
    if !metadata.is_dir() {
        return Err("目标不是可访问的登记文件夹".to_string());
    }
    Ok((root, path))
}

fn resolve_registered_directory_child(
    state: &AppState,
    target: &DirectoryTarget,
) -> Result<(IndexEntry, PathBuf), String> {
    if target.directory_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let root = state
        .snapshot()
        .map_err(storage_message)?
        .entries
        .into_iter()
        .find(|entry| entry.id == target.directory_id)
        .ok_or_else(|| storage_message(StorageError::EntryNotFound))?;
    if root.kind != "folder" || root.invalid {
        return Err("登记的文件夹路径已失效，请重新定位或重新导入".to_string());
    }
    let path = filesystem::resolve_directory_child(&root.path, &target.relative_path)
        .map_err(directory_path_message)?;
    let metadata = std::fs::symlink_metadata(&path)
        .map_err(|_| "登记的文件夹子项已失效，请刷新索引".to_string())?;
    if filesystem::is_unsafe_metadata(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err("目标不是可访问的登记文件夹子项".to_string());
    }
    Ok((root, path))
}

fn resolve_preview_target(
    state: &AppState,
    target: &PreviewTarget,
) -> Result<(PathBuf, String), String> {
    match (
        target.file_id.as_deref().filter(|id| !id.trim().is_empty()),
        target
            .directory_id
            .as_deref()
            .filter(|id| !id.trim().is_empty()),
    ) {
        (Some(_), Some(_)) | (None, None) => Err("预览目标无效，请重新选择资料".to_string()),
        (Some(file_id), None) => {
            let entry = state
                .snapshot()
                .map_err(storage_message)?
                .entries
                .into_iter()
                .find(|entry| entry.id == file_id)
                .ok_or_else(|| storage_message(StorageError::EntryNotFound))?;
            if entry.kind == "folder" {
                return Err("文件夹不能作为文件预览目标".to_string());
            }
            Ok((PathBuf::from(entry.path), entry.kind))
        }
        (None, Some(directory_id)) => {
            let (_, path) = resolve_registered_directory_child(
                state,
                &DirectoryTarget {
                    directory_id: directory_id.to_string(),
                    relative_path: target.relative_path.clone(),
                },
            )?;
            let Some(info) = filesystem::type_info_for_path(&path) else {
                return Err("此格式暂不支持预览".to_string());
            };
            if info.kind == "folder" {
                return Err("文件夹不能作为文件预览目标".to_string());
            }
            Ok((path, info.kind.to_string()))
        }
    }
}

fn directory_path_message(error: filesystem::PathValidationError) -> String {
    match error {
        filesystem::PathValidationError::Missing => {
            "登记的文件夹或子项已失效，请刷新索引".to_string()
        }
        filesystem::PathValidationError::PermissionDenied => "没有访问登记文件夹的权限".to_string(),
        filesystem::PathValidationError::Invalid => "目录子项不在登记文件夹边界内".to_string(),
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct IndexChangedEvent {
    pub revision: u64,
    pub ids: Vec<String>,
    pub change_type: String,
}

pub(crate) fn emit_index_changed<R: Runtime>(
    app: &AppHandle<R>,
    revision: u64,
    ids: Vec<String>,
    change_type: &str,
) {
    let event = IndexChangedEvent {
        revision,
        ids,
        change_type: change_type.to_string(),
    };
    let _ = app.emit_to("floating-ball", "index-changed", event.clone());
    let _ = app.emit_to("main", "index-changed", event);
    if let Ok(snapshot) = app.state::<AppState>().snapshot() {
        schedule_content_index_sync(app, snapshot.revision, snapshot.entries);
    }
    crate::windows::tray::refresh_menu(app);
}

pub(crate) fn schedule_content_index_sync<R: Runtime>(
    app: &AppHandle<R>,
    revision: u64,
    entries: Vec<IndexEntry>,
) {
    let content_state = app
        .state::<storage::content_index::ContentIndexState>()
        .inner()
        .clone();
    if !content_state.enqueue_sync(revision, entries) {
        return;
    }
    let app_for_task = app.clone();
    tauri::async_runtime::spawn_blocking(move || loop {
        let Some((source_revision, entries)) = content_state.take_pending_sync() else {
            if !content_state.finish_sync_worker() {
                break;
            }
            continue;
        };
        let result = content_state.sync_entries_with_stop(&entries, source_revision, &|| {
            content_state.has_pending_sync_after(source_revision)
        });
        match result {
            Ok(result)
                if !result.cancelled && !content_state.has_pending_sync_after(source_revision) =>
            {
                emit_content_index_status(&app_for_task, &content_state);
            }
            Ok(_) => {}
            Err(
                storage::content_index::ContentIndexError::RecoveryRequired
                | storage::content_index::ContentIndexError::Stale,
            ) => {}
            Err(error) => {
                content_state.mark_unavailable(&error.to_string());
                emit_content_index_status(&app_for_task, &content_state);
            }
        }
        if !content_state.finish_sync_worker() {
            break;
        }
    });
}

pub(crate) fn emit_content_index_status<R: Runtime>(
    app: &AppHandle<R>,
    state: &storage::content_index::ContentIndexState,
) {
    if let Ok(status) = state.status() {
        let _ = app.emit_to("main", "content-index-changed", status);
    }
}

pub(crate) fn record_entry_opened<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
    file_id: &str,
) -> Result<bool, StorageError> {
    let repository = IndexRepository::new(state);
    let outcome = repository.update_entries_with(|entries| {
        let changed =
            storage::set_last_opened(entries, file_id, storage::current_timestamp_millis())?;
        Ok((changed, ()))
    })?;
    if outcome.changed {
        emit_index_changed(app, outcome.revision, vec![file_id.to_string()], "opened");
    }
    Ok(outcome.changed)
}
