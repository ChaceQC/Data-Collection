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
use tauri::{AppHandle, Emitter, Runtime, State};

use crate::storage::repository::IndexRepository;
use crate::{
    filesystem::{self, DirectoryEntry, IndexEntry},
    preview::{self, PreviewOptions, PreviewResult, PreviewState, PreviewSupport},
    storage::{self, AppState, Group, IndexSnapshot, StorageError},
};

pub(crate) mod floating_ball;
pub(crate) mod library;
pub(crate) mod settings;
pub(crate) mod window;

const BATCH_TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Debug, Default)]
pub struct BatchState {
    operations: Mutex<HashMap<String, Arc<BatchControl>>>,
}

#[derive(Debug)]
pub(crate) struct BatchControl {
    cancelled: AtomicBool,
    started_at: Instant,
}

impl BatchState {
    pub(crate) fn begin(&self, operation_id: &str) -> Result<Arc<BatchControl>, CommandError> {
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
        if self.started_at.elapsed() >= BATCH_TIMEOUT {
            return Some("批量操作超时");
        }
        None
    }

    pub(crate) fn cancelled(&self) -> bool {
        self.cancelled.load(Ordering::Acquire)
    }

    pub(crate) fn timed_out(&self) -> bool {
        self.started_at.elapsed() >= BATCH_TIMEOUT && !self.cancelled()
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

    let scan = tauri::async_runtime::spawn_blocking(move || filesystem::scan_paths(&paths))
        .await
        .map_err(|_| "索引任务未完成，请重试".to_string())?;
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
            let tags = entries[position].tags.clone();
            let group_id = entries[position].group_id.clone();
            let mut replacement = replacement;
            replacement.id = id;
            replacement.favorite = favorite;
            replacement.added_at = added_at;
            replacement.preview_status = preview_status;
            replacement.last_recorded_at = last_recorded_at;
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
        Ok(result) => Ok(result),
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
    repository.recovery_status().map_err(storage_message)
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
    let entries = repository.snapshot().map_err(storage_message)?;
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

pub(crate) fn refresh_index_sync<R: Runtime>(
    state: &AppState,
    app: &AppHandle<R>,
) -> Result<IndexRefreshResult, String> {
    let repository = IndexRepository::new(state);
    let reconciled = repository
        .reconcile_pending_operations()
        .map_err(storage_message)?;
    let entries = repository.snapshot().map_err(storage_message)?;
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
                .into_iter()
                .find(|entry| entry.id == file_id)
                .ok_or_else(|| storage_message(StorageError::EntryNotFound))?;
            if entry.kind == "folder" {
                return Err("文件夹不能作为文件预览目标".to_string());
            }
            Ok((PathBuf::from(entry.path), entry.kind))
        }
        (None, Some(directory_id)) => {
            let (_, path) = resolve_directory_target(
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
    crate::windows::tray::refresh_menu(app);
}
