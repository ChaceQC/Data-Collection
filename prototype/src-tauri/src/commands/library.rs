use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::storage::repository::IndexRepository;
use crate::{
    filesystem::{self, clipboard, external, operations, IndexEntry},
    storage::{self, AppState, StorageError},
};

use super::{
    command_error, storage_message, structured_storage_error, CommandError, IndexMutationResult,
};

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
        .update_entries_with(|entries| {
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
        .update_entries_with(|entries| {
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
        let (source, _) = operations::validate_indexed_file(&entry).map_err(operation_error)?;
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
        let (path, _) = operations::validate_indexed_file(&entry).map_err(operation_error)?;
        external::open_with_default(&path).map_err(|error| {
            command_error("external-open-failed", error.to_string(), true, "unchanged")
        })
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
        let path = if is_directory {
            filesystem::validate_directory_path(&entry.path).map_err(|error| {
                command_error(
                    "source-invalid",
                    map_path_validation_error(error),
                    true,
                    "unchanged",
                )
            })?
        } else {
            operations::validate_indexed_file(&entry)
                .map_err(operation_error)?
                .0
        };
        external::reveal_in_explorer(&path, is_directory).map_err(|error| {
            command_error("external-open-failed", error.to_string(), true, "unchanged")
        })
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
    if file_id.trim().is_empty() {
        return Err(structured_storage_error(StorageError::InvalidId));
    }
    let repository = IndexRepository::new(state.inner());
    let entry = find_entry(&repository, &file_id)?;
    if entry.kind == "folder" {
        return Err(command_error(
            "folder-not-supported",
            "暂时只支持重命名普通文件",
            false,
            "unchanged",
        ));
    }
    let operation = tauri::async_runtime::spawn_blocking(move || {
        let (source, _) = operations::validate_indexed_file(&entry).map_err(operation_error)?;
        let target = operations::validate_new_name(&source, &new_name).map_err(operation_error)?;
        operations::rename_file(&source, &target).map_err(operation_error)?;
        let mut replacement = match filesystem::index_selected_path(&target.to_string_lossy()) {
            Ok(replacement) => replacement,
            Err(_) => {
                let _ = operations::restore_renamed_file(&target, &source);
                return Err(command_error(
                    "metadata-failed",
                    "文件已重命名，但无法读取新文件元数据",
                    true,
                    "unchanged",
                ));
            }
        };
        replacement.id = entry.id.clone();
        replacement.favorite = entry.favorite;
        replacement.added_at = entry.added_at;
        replacement.preview_status = entry.preview_status.clone();
        replacement.last_recorded_at = entry.last_recorded_at;
        Ok::<(PathBuf, PathBuf, IndexEntry), CommandError>((source, target, replacement))
    })
    .await
    .map_err(|_| command_error("task-failed", "重命名任务未完成，请重试", true, "unchanged"))??;
    let (source, target, replacement) = operation;
    let outcome = repository.update_entries_with(|entries| {
        let current = entries
            .iter_mut()
            .find(|entry| entry.id == file_id)
            .ok_or(StorageError::EntryNotFound)?;
        if !filesystem::same_path(&current.path, &source.to_string_lossy()) {
            return Err(StorageError::EntryNotFound);
        }
        *current = replacement.clone();
        storage::sort_entries(entries);
        Ok((true, Some(replacement.clone())))
    });
    match outcome {
        Ok(outcome) => {
            super::emit_index_changed(&app, outcome.revision, vec![file_id.clone()], "rename");
            Ok(IndexMutationResult {
                revision: outcome.revision,
                changed_ids: vec![file_id],
                entry: outcome.value,
            })
        }
        Err(error) => {
            if operations::restore_renamed_file(&target, &source) {
                Err(structured_storage_error(error))
            } else {
                Err(command_error(
                    "partial-success",
                    "文件已重命名，但索引未同步且无法自动回滚，请手动检查",
                    false,
                    "unknown",
                ))
            }
        }
    }
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
    let (source, _) = operations::validate_indexed_file(&entry).map_err(operation_error)?;
    repository
        .prepare_delete(&file_id, &source)
        .map_err(structured_storage_error)?;
    let delete_result = tauri::async_runtime::spawn_blocking(move || {
        operations::delete_to_recycle_bin(&source).map_err(operation_error)
    })
    .await
    .map_err(|_| command_error("task-failed", "删除任务未完成，请重试", true, "unknown"))?;
    if let Err(error) = delete_result {
        let _ = repository.clear_pending_delete(&file_id);
        return Err(error);
    }
    repository
        .mark_delete_complete(&file_id)
        .map_err(|error| command_error("partial-success", error.to_string(), false, "unknown"))?;

    match repository.update_entries_with(|entries| {
        let position = entries
            .iter()
            .position(|entry| entry.id == file_id)
            .ok_or(StorageError::EntryNotFound)?;
        entries.remove(position);
        Ok((true, ()))
    }) {
        Ok(outcome) => {
            let revision = outcome.revision;
            if repository.clear_pending_delete(&file_id).is_err() {
                return Err(command_error(
                    "partial-success",
                    "原文件已移入回收站，索引已更新但待同步记录未清理",
                    true,
                    "unknown",
                ));
            }
            super::emit_index_changed(&app, revision, vec![file_id.clone()], "delete-original");
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
        .into_iter()
        .find(|entry| entry.id == file_id)
        .ok_or_else(|| structured_storage_error(StorageError::EntryNotFound))
}

fn operation_error(error: operations::FileOperationError) -> CommandError {
    let (code, retryable, state) = match &error {
        operations::FileOperationError::SourceMissing => ("source-missing", false, "unchanged"),
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

fn map_path_validation_error(error: filesystem::PathValidationError) -> String {
    match error {
        filesystem::PathValidationError::Missing => {
            "资料路径已失效，请先重新定位或重新导入".to_string()
        }
        filesystem::PathValidationError::PermissionDenied => {
            "没有访问资料路径的权限，请检查文件权限".to_string()
        }
        filesystem::PathValidationError::Invalid => {
            "资料路径不是可访问的普通文件或文件夹".to_string()
        }
    }
}
