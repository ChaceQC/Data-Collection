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
    preview::{
        self as preview_service, PreviewOptions, PreviewResult, PreviewState, PreviewSupport,
    },
    storage::{self, AppState, Group, IndexSnapshot, StorageError},
};

pub(crate) mod batch;
pub(crate) mod content;
pub(crate) mod events;
pub(crate) mod floating_ball;
pub(crate) mod index;
pub(crate) mod library;
pub(crate) mod operation_history;
#[path = "preview.rs"]
pub(crate) mod preview_commands;
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
    filesystem::validate_scan_paths(&normalized).map_err(|error| {
        command_error(
            "recursive-root-invalid",
            error.to_string(),
            false,
            "unchanged",
        )
    })?;
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

#[derive(Clone, Debug, Serialize)]
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

/// 将旧的字符串错误边界收敛为前端可验证的结构化错误。
/// 只保留短的单行用户提示，避免把路径、堆栈或外部命令参数带入 IPC。
pub(crate) fn legacy_command_error(error: String) -> CommandError {
    let message = if error.len() <= 180 && !error.contains(['\r', '\n']) {
        error
    } else {
        "操作失败，请重试".to_string()
    };
    command_error("command-failed", message, true, "unknown")
}

pub(crate) fn structured_storage_error(error: StorageError) -> CommandError {
    let (code, retryable, state) = match &error {
        StorageError::InvalidId => ("invalid-id", false, "unchanged"),
        StorageError::FileBusy => ("file-busy", true, "unchanged"),
        StorageError::SourceChanged => ("source-changed", true, "unchanged"),
        StorageError::RepositionNotNeeded => ("reposition-not-needed", false, "unchanged"),
        StorageError::RepositionKindMismatch => ("reposition-kind-mismatch", false, "unchanged"),
        StorageError::EntryNotFound => ("entry-not-found", false, "unchanged"),
        StorageError::DuplicateEntry => ("duplicate-entry", false, "unchanged"),
        StorageError::DuplicateGroup => ("duplicate-group", false, "unchanged"),
        StorageError::GroupNotFound => ("group-not-found", false, "unchanged"),
        StorageError::InvalidGroupName => ("invalid-group-name", false, "unchanged"),
        StorageError::InvalidTag => ("invalid-tag", false, "unchanged"),
        StorageError::UndoUnavailable => ("undo-unavailable", false, "unchanged"),
        StorageError::UndoConflict => ("undo-conflict", false, "unchanged"),
        StorageError::InvalidPreviewStatus => ("invalid-preview-status", false, "unchanged"),
        StorageError::PreviewRevisionConflict => ("preview-stale", false, "unchanged"),
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
    pub request_id: String,
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

pub(crate) fn load_file_index_impl(
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

pub(crate) async fn list_directory_impl(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, CommandError> {
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
    .map_err(|_| {
        command_error(
            "directory-read",
            "目录读取任务未完成，请重试".to_string(),
            true,
            "unchanged",
        )
    })?
    .map_err(|error| command_error("directory-read", error.to_string(), true, "unchanged"))
}

pub(crate) async fn reveal_directory_child_impl(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<library::ExternalOpenResult, String> {
    let (_root, path) =
        resolve_registered_directory_child(&state, &target).map_err(|error| error.message)?;
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
        crate::filesystem::external::reveal_in_explorer(&path, is_directory, &metadata).map_err(
            |error| match error {
                crate::filesystem::external::ExternalOpenError::TargetChanged => {
                    "文件夹子项在操作前发生变化，请刷新索引后重试".to_string()
                }
                _ => "无法在资源管理器中定位，请检查路径".to_string(),
            },
        )
    })
    .await
    .map_err(|_| "定位文件夹子项任务未完成，请重试".to_string())??;
    Ok(library::ExternalOpenResult { name })
}

pub(crate) async fn index_paths_command_impl(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexImportResult, String> {
    index_paths_impl(paths, state.inner(), &app).await
}

pub(crate) async fn index_paths_from_single_instance<R: Runtime>(
    paths: Vec<String>,
    app: AppHandle<R>,
) -> Result<IndexImportResult, String> {
    let state = app.state::<AppState>();
    index_paths_impl(paths, state.inner(), &app).await
}

async fn index_paths_impl<R: Runtime>(
    paths: Vec<String>,
    state: &AppState,
    app: &AppHandle<R>,
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
    let repository = IndexRepository::new(state);
    let outcome = repository
        .merge_entries(scan.entries, storage::IndexMergeMode::RegularImport)
        .map_err(storage_message)?;
    let merge_stats = outcome.value;

    if !merge_stats.affected_ids.is_empty() {
        emit_index_changed(
            app,
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

pub(crate) async fn import_folders_recursive_impl(
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

pub(crate) async fn reposition_file_impl(
    file_id: String,
    new_path: String,
    _state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let worker_app = app.clone();
    let id = file_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        storage::file_actions::reposition(&worker_app.state::<AppState>(), &id, &new_path)
            .map_err(library::file_action_error)
    })
    .await
    .map_err(|_| {
        command_error(
            "task-failed",
            "重新定位任务未完成，请刷新索引",
            true,
            "unknown",
        )
    })??;
    emit_index_changed(&app, outcome.revision, vec![file_id.clone()], "reposition");
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids: vec![file_id],
        entry: outcome.value,
    })
}

pub(crate) async fn can_preview_impl(
    target: PreviewTarget,
    kind: String,
    state: State<'_, AppState>,
    _app: AppHandle,
) -> Result<PreviewSupport, String> {
    let (path, _, index_revision) = resolve_preview_target(&state, &target)?;
    let mut support = tauri::async_runtime::spawn_blocking(move || {
        preview_service::can_preview(&path.to_string_lossy(), &kind)
    })
    .await
    .map_err(|_| "预览检查任务未完成，请重试".to_string())?;
    support.index_revision = index_revision;
    Ok(support)
}

pub(crate) async fn load_preview_impl(
    target: PreviewTarget,
    kind: String,
    options: Option<PreviewOptions>,
    index_state: State<'_, AppState>,
    state: State<'_, PreviewState>,
    _app: AppHandle,
) -> Result<PreviewResult, String> {
    let (mut path, _, index_revision) = resolve_preview_target(&index_state, &target)?;
    let preview_state = state.inner().clone();
    let options = options.unwrap_or_default();
    let (task_id, cancellation) = preview_state.begin_task(options.task_id.clone());
    let outcome_token = if let Some(file_id) = target.file_id.as_deref() {
        match state
            .outcomes
            .begin(index_state.inner(), file_id, &task_id, &cancellation)
        {
            Ok((token, source)) => {
                path = source;
                Some(token)
            }
            Err(StorageError::PreviewRevisionConflict) => None,
            Err(error) => {
                state.cancel_task(&task_id);
                state.finish_task(&task_id, &cancellation);
                return Err(storage_message(error));
            }
        }
    } else {
        None
    };
    let task_id_for_task = task_id.clone();
    let cancellation_for_task = cancellation.clone();
    let join_result = tauri::async_runtime::spawn_blocking(move || {
        let result = preview_service::load_preview_with_cancellation(
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
        Ok(mut result) => {
            result.index_revision = index_revision;
            if let Some(token) = outcome_token {
                if state.outcomes.attach(&token, &result.preview_id) && !cancellation.is_cancelled()
                {
                    result.outcome_token = Some(token);
                } else {
                    preview_service::dispose_preview(state.inner(), &result.preview_id);
                    result.status = "cancelled".to_string();
                    result.content = None;
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

pub(crate) fn dispose_preview_impl(
    preview_id: String,
    state: State<'_, PreviewState>,
) -> Result<(), String> {
    preview_service::dispose_preview(state.inner(), &preview_id);
    Ok(())
}

pub(crate) fn cancel_preview_task_impl(
    task_id: String,
    state: State<'_, PreviewState>,
) -> Result<(), String> {
    state.cancel_task(&task_id);
    Ok(())
}

pub(crate) fn record_preview_outcome_impl(
    file_id: String,
    status: String,
    outcome_token: String,
    state: State<'_, AppState>,
    preview_state: State<'_, PreviewState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let outcome = preview_state
        .outcomes
        .record(state.inner(), &file_id, &outcome_token, &status)
        .map_err(structured_storage_error)?;
    if outcome.changed {
        emit_index_changed(&app, outcome.revision, vec![file_id.clone()], "preview");
    }
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids: if outcome.changed {
            vec![file_id]
        } else {
            Vec::new()
        },
        entry: outcome.value,
    })
}

pub(crate) fn get_index_recovery_impl(
    state: State<'_, AppState>,
) -> Result<Option<storage::IndexRecoveryStatus>, String> {
    let repository = IndexRepository::new(state.inner());
    repository
        .snapshot()
        .map(|snapshot| snapshot.recovery)
        .map_err(storage_message)
}

pub(crate) fn reset_index_recovery_impl(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexSnapshot, String> {
    let repository = IndexRepository::new(state.inner());
    let previous_revision = repository.snapshot().map_err(storage_message)?.revision;
    let snapshot = repository.reset_index_recovery().map_err(|error| {
        if let Ok(current) = repository.snapshot() {
            if current.revision > previous_revision && current.entries.is_empty() {
                emit_index_changed(&app, current.revision, Vec::new(), "recovery");
                return "空索引已保存，但待核对操作清理未完成，请刷新后重试".to_string();
            }
        }
        storage_message(error)
    })?;
    emit_index_changed(&app, snapshot.revision, Vec::new(), "recovery");
    Ok(snapshot)
}

pub(crate) fn export_index_diagnostic_impl(
    destination: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let repository = IndexRepository::new(state.inner());
    repository
        .export_recovery_diagnostic(&PathBuf::from(destination))
        .map_err(storage_message)
}

pub(crate) async fn refresh_index_impl(
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

pub(crate) fn content_index_status_impl(
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    state.inner().status().map_err(content_index_error)
}

pub(crate) async fn search_content_impl(
    request_id: String,
    query: String,
    use_regex: bool,
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<ContentSearchResponse, CommandError> {
    let ticket = state
        .queries
        .begin(&request_id)
        .map_err(content_index_error)?;
    let content = state.inner().clone();
    let search =
        tauri::async_runtime::spawn_blocking(move || content.run_query(&query, use_regex, &ticket))
            .await
            .map_err(|_| {
                command_error(
                    "task-failed",
                    "正文搜索任务未完成，请重试",
                    true,
                    "unchanged",
                )
            })?
            .map_err(content_index_error)?;
    Ok(ContentSearchResponse {
        request_id,
        status: search.status,
        results: search.results,
    })
}

pub(crate) async fn search_metadata_impl(
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
                message.message,
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

pub(crate) async fn rebuild_content_index_impl(
    operation_id: String,
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<ContentIndexRebuildResult, CommandError> {
    let control = batch_state.begin_content_index(&operation_id)?;
    let epoch = match content_state.begin_change() {
        Ok(epoch) => epoch,
        Err(error) => {
            batch_state.finish(&operation_id);
            return Err(content_index_error(error));
        }
    };
    let snapshot = match state.snapshot() {
        Ok(snapshot) => snapshot,
        Err(error) => {
            batch_state.finish(&operation_id);
            return Err(storage_command_error(error));
        }
    };
    let entries = snapshot.entries;
    let revision = snapshot.revision;
    let content_for_task = content_state.inner().clone();
    let control_for_task = control.clone();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        content_for_task.rebuild_at(&entries, revision, epoch, &|| {
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

pub(crate) async fn clear_content_index_impl(
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    app: AppHandle,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    let revision = state.snapshot().map_err(storage_command_error)?.revision;
    let epoch = content_state.begin_change().map_err(content_index_error)?;
    let content = content_state.inner().clone();
    let status = tauri::async_runtime::spawn_blocking(move || content.clear_at(revision, epoch))
        .await
        .map_err(|_| {
            command_error(
                "task-failed",
                "正文索引清除任务未完成，请重试",
                true,
                "unchanged",
            )
        })?
        .map_err(content_index_error)?;
    emit_content_index_status(&app, content_state.inner());
    Ok(status)
}

pub(crate) fn cancel_content_index_impl(
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
        storage::content_index::ContentIndexError::Cancelled => {
            ("content-search-cancelled", false, "unchanged")
        }
        storage::content_index::ContentIndexError::TimedOut => {
            ("content-search-timeout", true, "unchanged")
        }
        storage::content_index::ContentIndexError::Busy => {
            ("content-search-busy", true, "unchanged")
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
) -> Result<(IndexEntry, PathBuf), CommandError> {
    let (root, path) = resolve_registered_directory_child(state, target)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(directory_io_error)?;
    if !metadata.is_dir() {
        return Err(directory_target_error(
            filesystem::PathValidationError::Invalid,
        ));
    }
    Ok((root, path))
}

fn resolve_registered_directory_child(
    state: &AppState,
    target: &DirectoryTarget,
) -> Result<(IndexEntry, PathBuf), CommandError> {
    if target.directory_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let root = state
        .snapshot()
        .map_err(structured_storage_error)?
        .entries
        .into_iter()
        .find(|entry| entry.id == target.directory_id)
        .ok_or_else(|| directory_target_error(filesystem::PathValidationError::Missing))?;
    if root.kind != "folder" || root.invalid {
        return Err(directory_target_error(
            filesystem::PathValidationError::Missing,
        ));
    }
    let path = filesystem::resolve_directory_child(&root.path, &target.relative_path)
        .map_err(directory_target_error)?;
    let metadata = std::fs::symlink_metadata(&path).map_err(directory_io_error)?;
    if filesystem::is_unsafe_metadata(&metadata) || (!metadata.is_file() && !metadata.is_dir()) {
        return Err(directory_target_error(
            filesystem::PathValidationError::Invalid,
        ));
    }
    Ok((root, path))
}

fn directory_target_error(error: filesystem::PathValidationError) -> CommandError {
    let code = match error {
        filesystem::PathValidationError::Missing => "directory-missing",
        filesystem::PathValidationError::Invalid => "directory-invalid",
        filesystem::PathValidationError::PermissionDenied => "directory-permission-denied",
    };
    command_error(code, directory_path_message(error), false, "unchanged")
}

fn directory_io_error(error: std::io::Error) -> CommandError {
    match error.kind() {
        std::io::ErrorKind::NotFound => {
            directory_target_error(filesystem::PathValidationError::Missing)
        }
        std::io::ErrorKind::PermissionDenied => {
            directory_target_error(filesystem::PathValidationError::PermissionDenied)
        }
        _ => command_error(
            "directory-read",
            "目录读取失败，请重试".to_string(),
            true,
            "unchanged",
        ),
    }
}

fn resolve_preview_target(
    state: &AppState,
    target: &PreviewTarget,
) -> Result<(PathBuf, String, u64), String> {
    match (
        target.file_id.as_deref().filter(|id| !id.trim().is_empty()),
        target
            .directory_id
            .as_deref()
            .filter(|id| !id.trim().is_empty()),
    ) {
        (Some(_), Some(_)) | (None, None) => Err("预览目标无效，请重新选择资料".to_string()),
        (Some(file_id), None) => {
            let snapshot = state.snapshot().map_err(storage_message)?;
            let revision = snapshot.revision;
            let entry = snapshot
                .entries
                .into_iter()
                .find(|entry| entry.id == file_id)
                .ok_or_else(|| storage_message(StorageError::EntryNotFound))?;
            if entry.kind == "folder" {
                return Err("文件夹不能作为文件预览目标".to_string());
            }
            Ok((PathBuf::from(entry.path), entry.kind, revision))
        }
        (None, Some(directory_id)) => {
            let (_, path) = resolve_registered_directory_child(
                state,
                &DirectoryTarget {
                    directory_id: directory_id.to_string(),
                    relative_path: target.relative_path.clone(),
                },
            )
            .map_err(|error| error.message)?;
            let Some(info) = filesystem::type_info_for_path(&path) else {
                return Err("此格式暂不支持预览".to_string());
            };
            if info.kind == "folder" {
                return Err("文件夹不能作为文件预览目标".to_string());
            }
            let revision = state.snapshot().map_err(storage_message)?.revision;
            Ok((path, info.kind.to_string(), revision))
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
    if change_type != "preview" {
        if let Ok(snapshot) = app.state::<AppState>().snapshot() {
            schedule_content_index_sync(app, snapshot.revision, snapshot.entries);
        }
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
        let Some((source_revision, entries, epoch)) = content_state.take_pending_sync() else {
            if !content_state.finish_sync_worker() {
                break;
            }
            continue;
        };
        let result =
            content_state.sync_entries_with_stop(&entries, source_revision, epoch, &|| {
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
