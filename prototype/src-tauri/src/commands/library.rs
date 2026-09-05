use std::collections::{HashMap, HashSet};

use serde::Serialize;
use tauri::{AppHandle, Manager, State};

use crate::storage::repository::IndexRepository;
use crate::{
    filesystem::{self, clipboard, external, operations, IndexEntry},
    storage::{self, AppState, StorageError},
};

use super::{
    command_error, storage_message, structured_storage_error, BatchControl, BatchItemResult,
    BatchMutationResult, BatchState, CommandError, GroupMutationResult, IndexMutationResult,
};

const MAX_BATCH_IDS: usize = 500;

pub fn cancel_batch_operation(
    operation_id: String,
    state: State<'_, BatchState>,
) -> Result<(), CommandError> {
    if !is_valid_batch_id(&operation_id) {
        return Err(command_error(
            "invalid-operation-id",
            "批量操作标识无效",
            false,
            "unchanged",
        ));
    }
    state.cancel(&operation_id)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClipboardCopyResult {
    pub name: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExternalOpenResult {
    pub name: String,
}

#[tauri::command]
pub fn set_favorite(
    file_id: String,
    favorite: bool,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .update_index_with_undo("favorite", |entries, _groups| {
            let changed = storage::set_favorite(entries, &file_id, favorite)?;
            let entry = entries.iter().find(|entry| entry.id == file_id).cloned();
            Ok((changed, entry))
        })
        .map_err(structured_storage_error)?;
    let changed_ids = if outcome.changed {
        vec![file_id.clone()]
    } else {
        Vec::new()
    };
    if outcome.changed {
        super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "favorite");
    }
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids,
        entry: outcome.value,
    })
}

#[tauri::command]
pub fn remove_index_entry(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .update_index_with_undo("remove-index", |entries, _groups| {
            let position = entries
                .iter()
                .position(|entry| entry.id == file_id)
                .ok_or(StorageError::EntryNotFound)?;
            entries.remove(position);
            Ok((true, ()))
        })
        .map_err(structured_storage_error)?;
    super::emit_index_changed(
        &app,
        outcome.revision,
        vec![file_id.clone()],
        "remove-index",
    );
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids: vec![file_id],
        entry: None,
    })
}

#[tauri::command]
pub fn set_entry_tags(
    file_id: String,
    tags: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let entry_id = file_id.clone();
    let outcome = repository
        .update_index_with_undo("tags", move |entries, _groups| {
            let changed = storage::set_entry_tags(entries, &entry_id, &tags)?;
            let entry = entries.iter().find(|entry| entry.id == entry_id).cloned();
            Ok((changed, entry))
        })
        .map_err(structured_storage_error)?;
    let changed_ids = changed_ids_for_single(&file_id, outcome.changed);
    if outcome.changed {
        super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "tags");
    }
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids,
        entry: outcome.value,
    })
}

#[tauri::command]
pub fn set_entry_group(
    file_id: String,
    group_id: Option<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let entry_id = file_id.clone();
    let outcome = repository
        .update_index_with_undo("group", move |entries, groups| {
            let changed =
                storage::set_entry_group(entries, groups, &entry_id, group_id.as_deref())?;
            let entry = entries.iter().find(|entry| entry.id == entry_id).cloned();
            Ok((changed, entry))
        })
        .map_err(structured_storage_error)?;
    let changed_ids = changed_ids_for_single(&file_id, outcome.changed);
    if outcome.changed {
        super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "group");
    }
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids,
        entry: outcome.value,
    })
}

#[tauri::command]
pub fn create_group(
    name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GroupMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let outcome = repository
        .update_index_with_undo("group-create", move |_entries, groups| {
            let group = storage::create_group(groups, &name)?;
            Ok((true, group))
        })
        .map_err(structured_storage_error)?;
    let group_id = outcome.value.id.clone();
    super::emit_index_changed(&app, outcome.revision, vec![group_id.clone()], "group");
    Ok(GroupMutationResult {
        revision: outcome.revision,
        changed_ids: vec![group_id],
        group: Some(outcome.value),
    })
}

#[tauri::command]
pub fn rename_group(
    group_id: String,
    name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GroupMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let id = group_id.clone();
    let outcome = repository
        .update_index_with_undo("group-rename", move |_entries, groups| {
            let (changed, group) = storage::rename_group(groups, &id, &name)?;
            Ok((changed, group))
        })
        .map_err(structured_storage_error)?;
    let changed_ids = changed_ids_for_single(&group_id, outcome.changed);
    if outcome.changed {
        super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "group");
    }
    Ok(GroupMutationResult {
        revision: outcome.revision,
        changed_ids,
        group: Some(outcome.value),
    })
}

#[tauri::command]
pub fn delete_group(
    group_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<GroupMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let id = group_id.clone();
    let outcome = repository
        .update_index_with_undo("group-delete", move |entries, groups| {
            let (group, mut changed_ids) = storage::delete_group(entries, groups, &id)?;
            changed_ids.push(id.clone());
            Ok((true, (group, changed_ids)))
        })
        .map_err(structured_storage_error)?;
    let (group, changed_ids) = outcome.value;
    super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "group");
    Ok(GroupMutationResult {
        revision: outcome.revision,
        changed_ids,
        group: Some(group),
    })
}

#[tauri::command]
pub async fn batch_set_favorite(
    operation_id: String,
    file_ids: Vec<String>,
    favorite: bool,
    _state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<BatchMutationResult, CommandError> {
    let file_ids = normalize_batch_ids(file_ids)?;
    let ids_for_mutation = file_ids.clone();
    let outcome = run_batch_mutation(
        &app,
        batch_state.inner(),
        operation_id.clone(),
        "batch-favorite",
        move |entries, _groups, control| {
            let positions = entries
                .iter()
                .enumerate()
                .map(|(position, entry)| (entry.id.clone(), position))
                .collect::<HashMap<_, _>>();
            let mut results = Vec::with_capacity(ids_for_mutation.len());
            for (index, id) in ids_for_mutation.iter().enumerate() {
                if let Some(reason) = control.stop_reason() {
                    append_stopped_results(&mut results, &ids_for_mutation[index..], reason);
                    break;
                }
                let Some(position) = positions.get(id).copied() else {
                    results.push(batch_skipped(id, "资料已不存在"));
                    continue;
                };
                let entry = &mut entries[position];
                if entry.favorite == favorite {
                    results.push(batch_skipped(id, "收藏状态未变化"));
                    continue;
                }
                entry.favorite = favorite;
                results.push(batch_success(id));
            }
            Ok((
                results.iter().any(|result| result.status == "success"),
                results,
            ))
        },
    )
    .await?;
    let (outcome, cancelled, timed_out) = outcome;
    emit_batch_result(&app, &outcome, "batch-favorite");
    Ok(to_batch_result(
        outcome,
        &operation_id,
        "batch-favorite",
        cancelled,
        timed_out,
    ))
}

#[tauri::command]
pub async fn batch_remove_index_entries(
    operation_id: String,
    file_ids: Vec<String>,
    _state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<BatchMutationResult, CommandError> {
    let file_ids = normalize_batch_ids(file_ids)?;
    let ids_for_mutation = file_ids.clone();
    let outcome = run_batch_mutation(
        &app,
        batch_state.inner(),
        operation_id.clone(),
        "batch-remove-index",
        move |entries, _groups, control| {
            let existing_ids = entries
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<HashSet<_>>();
            let mut removed_ids = HashSet::with_capacity(ids_for_mutation.len());
            let mut results = Vec::with_capacity(ids_for_mutation.len());
            for (index, id) in ids_for_mutation.iter().enumerate() {
                if let Some(reason) = control.stop_reason() {
                    append_stopped_results(&mut results, &ids_for_mutation[index..], reason);
                    break;
                }
                if !existing_ids.contains(id) {
                    results.push(batch_skipped(id, "资料已不存在"));
                    continue;
                }
                removed_ids.insert(id.clone());
                results.push(batch_success(id));
            }
            if !removed_ids.is_empty() {
                entries.retain(|entry| !removed_ids.contains(&entry.id));
            }
            Ok((
                results.iter().any(|result| result.status == "success"),
                results,
            ))
        },
    )
    .await?;
    let (outcome, cancelled, timed_out) = outcome;
    emit_batch_result(&app, &outcome, "batch-remove-index");
    Ok(to_batch_result(
        outcome,
        &operation_id,
        "batch-remove-index",
        cancelled,
        timed_out,
    ))
}

#[tauri::command]
pub async fn batch_update_tags(
    operation_id: String,
    file_ids: Vec<String>,
    tags: Vec<String>,
    add: bool,
    _state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<BatchMutationResult, CommandError> {
    let file_ids = normalize_batch_ids(file_ids)?;
    let tags = storage::normalize_tags(&tags).map_err(structured_storage_error)?;
    if tags.is_empty() {
        return Err(structured_storage_error(StorageError::InvalidTag));
    }
    let ids_for_mutation = file_ids.clone();
    let tags_for_mutation = tags.clone();
    let outcome = run_batch_mutation(
        &app,
        batch_state.inner(),
        operation_id.clone(),
        "batch-tags",
        move |entries, _groups, control| {
            let positions = entries
                .iter()
                .enumerate()
                .map(|(position, entry)| (entry.id.clone(), position))
                .collect::<HashMap<_, _>>();
            let mut results = Vec::with_capacity(ids_for_mutation.len());
            for (index, id) in ids_for_mutation.iter().enumerate() {
                if let Some(reason) = control.stop_reason() {
                    append_stopped_results(&mut results, &ids_for_mutation[index..], reason);
                    break;
                }
                let Some(position) = positions.get(id).copied() else {
                    results.push(batch_skipped(id, "资料已不存在"));
                    continue;
                };
                let entry = &mut entries[position];
                let mut next_tags = entry.tags.clone();
                if add {
                    for tag in &tags_for_mutation {
                        if !next_tags
                            .iter()
                            .any(|current| current.eq_ignore_ascii_case(tag))
                        {
                            next_tags.push(tag.clone());
                        }
                    }
                    if next_tags.len() > storage::MAX_TAGS_PER_ENTRY {
                        results.push(batch_skipped(id, "标签数量已达上限"));
                        continue;
                    }
                } else {
                    next_tags.retain(|current| {
                        !tags_for_mutation
                            .iter()
                            .any(|tag| current.eq_ignore_ascii_case(tag))
                    });
                }
                if next_tags == entry.tags {
                    results.push(batch_skipped(id, "标签状态未变化"));
                    continue;
                }
                entry.tags = next_tags;
                results.push(batch_success(id));
            }
            Ok((
                results.iter().any(|result| result.status == "success"),
                results,
            ))
        },
    )
    .await?;
    let (outcome, cancelled, timed_out) = outcome;
    emit_batch_result(&app, &outcome, "batch-tags");
    Ok(to_batch_result(
        outcome,
        &operation_id,
        "batch-tags",
        cancelled,
        timed_out,
    ))
}

#[tauri::command]
pub async fn batch_set_group(
    operation_id: String,
    file_ids: Vec<String>,
    group_id: Option<String>,
    _state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<BatchMutationResult, CommandError> {
    let file_ids = normalize_batch_ids(file_ids)?;
    let ids_for_mutation = file_ids.clone();
    let outcome = run_batch_mutation(
        &app,
        batch_state.inner(),
        operation_id.clone(),
        "batch-group",
        move |entries, groups, control| {
            if let Some(group_id) = group_id.as_deref() {
                if group_id.trim().is_empty() {
                    return Err(StorageError::InvalidId);
                }
                if !groups.iter().any(|group| group.id == group_id) {
                    return Err(StorageError::GroupNotFound);
                }
            }
            let positions = entries
                .iter()
                .enumerate()
                .map(|(position, entry)| (entry.id.clone(), position))
                .collect::<HashMap<_, _>>();
            let mut results = Vec::with_capacity(ids_for_mutation.len());
            for (index, id) in ids_for_mutation.iter().enumerate() {
                if let Some(reason) = control.stop_reason() {
                    append_stopped_results(&mut results, &ids_for_mutation[index..], reason);
                    break;
                }
                let Some(position) = positions.get(id).copied() else {
                    results.push(batch_skipped(id, "资料已不存在"));
                    continue;
                };
                let entry = &mut entries[position];
                if entry.group_id.as_deref() == group_id.as_deref() {
                    results.push(batch_skipped(id, "分组状态未变化"));
                    continue;
                }
                entry.group_id = group_id.clone();
                results.push(batch_success(id));
            }
            Ok((
                results.iter().any(|result| result.status == "success"),
                results,
            ))
        },
    )
    .await?;
    let (outcome, cancelled, timed_out) = outcome;
    emit_batch_result(&app, &outcome, "batch-group");
    Ok(to_batch_result(
        outcome,
        &operation_id,
        "batch-group",
        cancelled,
        timed_out,
    ))
}

#[tauri::command]
pub fn undo_last(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let repository = IndexRepository::new(state.inner());
    let outcome = repository.undo_last().map_err(structured_storage_error)?;
    let changed_ids = outcome.value.clone();
    super::emit_index_changed(&app, outcome.revision, changed_ids.clone(), "undo");
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids,
        entry: None,
    })
}

fn changed_ids_for_single(file_id: &str, changed: bool) -> Vec<String> {
    if changed {
        vec![file_id.to_string()]
    } else {
        Vec::new()
    }
}

fn normalize_batch_ids(file_ids: Vec<String>) -> Result<Vec<String>, CommandError> {
    if file_ids.len() > MAX_BATCH_IDS {
        return Err(command_error(
            "batch-too-large",
            format!("一次最多操作 {MAX_BATCH_IDS} 项资料"),
            false,
            "unchanged",
        ));
    }
    let mut seen = HashSet::with_capacity(file_ids.len());
    let mut normalized = Vec::with_capacity(file_ids.len());
    for file_id in file_ids {
        if !is_valid_batch_id(&file_id) {
            return Err(structured_storage_error(StorageError::InvalidId));
        }
        if seen.insert(file_id.clone()) {
            normalized.push(file_id);
        }
    }
    if normalized.is_empty() {
        return Err(command_error(
            "invalid-batch",
            "请先选择资料",
            false,
            "unchanged",
        ));
    }
    Ok(normalized)
}

fn is_valid_batch_id(value: &str) -> bool {
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

fn batch_success(id: &str) -> BatchItemResult {
    BatchItemResult {
        id: id.to_string(),
        status: "success".to_string(),
        reason: None,
    }
}

fn batch_skipped(id: &str, reason: &str) -> BatchItemResult {
    BatchItemResult {
        id: id.to_string(),
        status: "skipped".to_string(),
        reason: Some(reason.to_string()),
    }
}

async fn run_batch_mutation<T, F>(
    app: &AppHandle,
    batch_state: &BatchState,
    operation_id: String,
    operation: &'static str,
    mutation: F,
) -> Result<(storage::MutationResult<T>, bool, bool), CommandError>
where
    T: Send + 'static,
    F: FnOnce(
            &mut Vec<IndexEntry>,
            &mut Vec<storage::Group>,
            &BatchControl,
        ) -> Result<(bool, T), StorageError>
        + Send
        + 'static,
{
    let control = batch_state.begin(&operation_id)?;
    let control_for_task = control.clone();
    let app_for_task = app.clone();
    let operation_name = operation.to_string();
    let joined = tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_task.state::<AppState>();
        state
            .inner()
            .update_index_with_undo(&operation_name, |entries, groups| {
                mutation(entries, groups, control_for_task.as_ref())
            })
    })
    .await;
    let cancelled = control.cancelled();
    let timed_out = control.timed_out();
    batch_state.finish(&operation_id);
    let outcome = joined
        .map_err(|_| command_error("task-failed", "批量操作任务未完成，请重试", true, "unknown"))?
        .map_err(structured_storage_error)?;
    Ok((outcome, cancelled, timed_out))
}

fn append_stopped_results(results: &mut Vec<BatchItemResult>, ids: &[String], reason: &str) {
    results.extend(ids.iter().map(|id| batch_skipped(id, reason)));
}

fn emit_batch_result(
    app: &AppHandle,
    outcome: &storage::MutationResult<Vec<BatchItemResult>>,
    change_type: &str,
) {
    if outcome.changed {
        let ids = outcome
            .value
            .iter()
            .filter(|result| result.status == "success")
            .map(|result| result.id.clone())
            .collect::<Vec<_>>();
        super::emit_index_changed(app, outcome.revision, ids, change_type);
    }
}

fn to_batch_result(
    outcome: storage::MutationResult<Vec<BatchItemResult>>,
    operation_id: &str,
    operation: &str,
    cancelled: bool,
    timed_out: bool,
) -> BatchMutationResult {
    let changed_ids = outcome
        .value
        .iter()
        .filter(|result| result.status == "success")
        .map(|result| result.id.clone())
        .collect();
    BatchMutationResult {
        operation_id: operation_id.to_string(),
        revision: outcome.revision,
        changed_ids,
        operation: operation.to_string(),
        results: outcome.value,
        cancelled,
        timed_out,
    }
}

#[tauri::command]
pub async fn copy_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardCopyResult, CommandError> {
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let entry = find_entry(&repository, &file_id)?;
    if entry.kind == "folder" {
        return Err(command_error(
            "folder-not-supported",
            "暂时只支持复制普通文件",
            false,
            "unchanged",
        ));
    }
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_source, metadata) =
            operations::validate_indexed_file(&entry).map_err(operation_error)?;
        let (source, _) =
            operations::revalidate_indexed_file(&entry, &metadata).map_err(operation_error)?;
        clipboard::set_file(&source).map_err(|error| {
            command_error("clipboard-failed", error.to_string(), true, "unchanged")
        })
    })
    .await
    .map_err(|_| {
        command_error(
            "task-failed",
            "复制到剪贴板任务未完成，请重试",
            true,
            "unchanged",
        )
    })??;
    Ok(ClipboardCopyResult { name })
}

#[tauri::command]
pub async fn open_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<ExternalOpenResult, CommandError> {
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let entry = find_entry(&repository, &file_id)?;
    if entry.kind == "folder" {
        return Err(command_error(
            "folder-not-supported",
            "暂时只支持用默认程序打开普通文件",
            false,
            "unchanged",
        ));
    }
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_path, metadata) =
            operations::validate_indexed_file(&entry).map_err(operation_error)?;
        let (path, metadata) =
            operations::revalidate_indexed_file(&entry, &metadata).map_err(operation_error)?;
        external::open_with_default(&path, &metadata).map_err(external_error)
    })
    .await
    .map_err(|_| {
        command_error(
            "task-failed",
            "打开文件任务未完成，请重试",
            true,
            "unchanged",
        )
    })??;
    super::record_entry_opened(state.inner(), &app, &file_id).map_err(structured_storage_error)?;
    Ok(ExternalOpenResult { name })
}

#[tauri::command]
pub async fn reveal_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ExternalOpenResult, CommandError> {
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let entry = find_entry(&repository, &file_id)?;
    let is_directory = entry.kind == "folder";
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (_path, metadata) =
            operations::validate_indexed_entry(&entry).map_err(operation_error)?;
        let (path, metadata) =
            operations::revalidate_indexed_entry(&entry, &metadata).map_err(operation_error)?;
        external::reveal_in_explorer(&path, is_directory, &metadata).map_err(external_error)
    })
    .await
    .map_err(|_| {
        command_error(
            "task-failed",
            "定位文件任务未完成，请重试",
            true,
            "unchanged",
        )
    })??;
    Ok(ExternalOpenResult { name })
}

#[tauri::command]
pub async fn rename_indexed_file(
    file_id: String,
    new_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    let worker_app = app.clone();
    let id = file_id.clone();
    let outcome = tauri::async_runtime::spawn_blocking(move || {
        storage::file_actions::rename(&worker_app.state::<AppState>(), &id, &new_name)
            .map_err(file_action_error)
    })
    .await
    .map_err(|_| {
        command_error(
            "task-failed",
            "重命名结果未确认，请刷新后检查资料路径",
            true,
            "unknown",
        )
    })??;
    let _ = state;
    super::emit_index_changed(&app, outcome.revision, vec![file_id.clone()], "rename");
    Ok(IndexMutationResult {
        revision: outcome.revision,
        changed_ids: vec![file_id],
        entry: outcome.value,
    })
}

#[tauri::command]
pub async fn delete_original_file(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let guard = state
        .begin_file_action(&file_id)
        .map_err(structured_storage_error)?;
    let entry = find_entry(&repository, &file_id)?;
    if entry.kind == "folder" {
        return Err(command_error(
            "folder-not-supported",
            "暂时不支持删除文件夹",
            false,
            "unchanged",
        ));
    }
    if entry.invalid {
        return Err(command_error(
            "source-missing",
            "文件已失效，请使用“从资料库移除”清理记录",
            false,
            "unchanged",
        ));
    }
    let (source, source_metadata) =
        operations::validate_indexed_file(&entry).map_err(operation_error)?;
    repository
        .prepare_delete(&file_id, &source)
        .map_err(structured_storage_error)?;
    let delete_result = tauri::async_runtime::spawn_blocking(move || {
        operations::delete_to_recycle_bin(&source, &source_metadata).map_err(operation_error)
    })
    .await
    .map_err(|_| command_error("task-failed", "删除任务未完成，请重试", true, "unknown"))?;
    if let Err(error) = delete_result {
        drop(guard);
        let _ = repository.reconcile_pending_operations();
        super::emit_index_changed(
            &app,
            state.snapshot().map_err(structured_storage_error)?.revision,
            vec![file_id],
            "recovery",
        );
        return Err(command_error(&error.code, error.message, true, "unknown"));
    }
    repository.mark_delete_complete(&file_id).map_err(|_| {
        command_error(
            "partial-success",
            "原文件已处理，但删除结果未能保存，请刷新并核对资料",
            true,
            "unknown",
        )
    })?;

    match repository.update_entries_with(|entries| {
        if !matches!(std::fs::symlink_metadata(&entry.path), Err(error) if error.kind() == std::io::ErrorKind::NotFound) {
            return Err(StorageError::SourceChanged);
        }
        let position = entries
            .iter()
            .position(|current| current.id == file_id && current.added_at == entry.added_at
                && filesystem::same_path(&current.path, &entry.path))
            .ok_or(StorageError::SourceChanged)?;
        entries.remove(position);
        Ok((true, ()))
    }) {
        Ok(outcome) => {
            let revision = outcome.revision;
            super::emit_index_changed(&app, revision, vec![file_id.clone()], "delete-original");
            if repository.clear_pending_delete(&file_id).is_err() {
                return Err(command_error(
                    "partial-success",
                    "原文件已移入回收站，索引已更新但待同步记录未清理",
                    true,
                    "unknown",
                ));
            }
            Ok(IndexMutationResult {
                revision,
                changed_ids: vec![file_id],
                entry: None,
            })
        }
        Err(error) => Err(command_error(
            "partial-success",
            format!(
                "原文件已移入回收站，但索引未同步：{}",
                storage_message(error)
            ),
            true,
            "unknown",
        )),
    }
}

fn find_entry(repository: &IndexRepository<'_>, file_id: &str) -> Result<IndexEntry, CommandError> {
    repository
        .snapshot()
        .map_err(structured_storage_error)?
        .entries
        .into_iter()
        .find(|entry| entry.id == file_id)
        .ok_or_else(|| structured_storage_error(StorageError::EntryNotFound))
}

pub(super) fn file_action_error(error: storage::file_actions::FileActionError) -> CommandError {
    use storage::file_actions::FileActionError;
    match error {
        FileActionError::Storage(StorageError::PreviewRevisionConflict) => {
            structured_storage_error(StorageError::SourceChanged)
        }
        FileActionError::Storage(error) => structured_storage_error(error),
        FileActionError::Operation(error) => operation_error(error),
        FileActionError::InvalidPath => {
            command_error("destination-invalid", error.to_string(), true, "unchanged")
        }
        FileActionError::Partial => {
            command_error("partial-success", error.to_string(), true, "unknown")
        }
    }
}

fn operation_error(error: operations::FileOperationError) -> CommandError {
    let (code, retryable, state) = match &error {
        operations::FileOperationError::SourceMissing => ("source-missing", false, "unchanged"),
        operations::FileOperationError::SourceChanged => ("source-changed", true, "unchanged"),
        operations::FileOperationError::SourcePermissionDenied => {
            ("source-permission-denied", true, "unchanged")
        }
        operations::FileOperationError::SourceInvalid => ("source-invalid", false, "unchanged"),
        operations::FileOperationError::DestinationInvalid => {
            ("destination-invalid", true, "unchanged")
        }
        operations::FileOperationError::UnsafePath => ("unsafe-path", false, "unchanged"),
        operations::FileOperationError::TargetConflict => ("target-conflict", false, "unchanged"),
        operations::FileOperationError::InvalidName => ("invalid-name", false, "unchanged"),
        operations::FileOperationError::ExtensionChanged => {
            ("extension-changed", false, "unchanged")
        }
        operations::FileOperationError::NameUnchanged => ("name-unchanged", false, "unchanged"),
        operations::FileOperationError::RenameFailed => ("rename-failed", true, "unchanged"),
        operations::FileOperationError::RecycleFailed => ("recycle-failed", true, "unknown"),
    };
    command_error(code, error.to_string(), retryable, state)
}

fn external_error(error: external::ExternalOpenError) -> CommandError {
    if matches!(error, external::ExternalOpenError::TargetChanged) {
        command_error("source-changed", error.to_string(), true, "unchanged")
    } else {
        command_error("external-open-failed", error.to_string(), true, "unchanged")
    }
}
