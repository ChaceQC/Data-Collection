use std::path::PathBuf;

use serde::Serialize;
use tauri::{AppHandle, State};

use crate::{
    filesystem::{self, clipboard, external, operations, IndexEntry},
    storage::{self, AppState, StorageError},
};

use super::storage_message;

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
) -> Result<Vec<IndexEntry>, String> {
    let entries = state
        .update_entries(|entries| storage::set_favorite(entries, &file_id, favorite))
        .map_err(storage_message)?;
    super::emit_index_changed(&app, vec![file_id]);
    Ok(entries)
}

#[tauri::command]
pub fn remove_index_entry(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<IndexEntry>, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entries = state
        .update_entries(|entries| {
            let position = entries
                .iter()
                .position(|entry| entry.id == file_id)
                .ok_or(StorageError::EntryNotFound)?;
            entries.remove(position);
            Ok(true)
        })
        .map_err(storage_message)?;
    super::emit_index_changed(&app, vec![file_id]);
    Ok(entries)
}

#[tauri::command]
pub async fn copy_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ClipboardCopyResult, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entry = find_entry(&state, &file_id)?;
    if entry.kind == "folder" {
        return Err("暂时只支持复制普通文件".to_string());
    }
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (source, _) =
            operations::validate_indexed_file(&entry).map_err(|error| error.to_string())?;
        clipboard::set_file(&source).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "复制到剪贴板任务未完成，请重试".to_string())??;
    Ok(ClipboardCopyResult { name })
}

#[tauri::command]
pub async fn open_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ExternalOpenResult, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entry = find_entry(&state, &file_id)?;
    if entry.kind == "folder" {
        return Err("暂时只支持用默认程序打开普通文件".to_string());
    }
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (path, _) =
            operations::validate_indexed_file(&entry).map_err(|error| error.to_string())?;
        external::open_with_default(&path).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "打开文件任务未完成，请重试".to_string())??;
    Ok(ExternalOpenResult { name })
}

#[tauri::command]
pub async fn reveal_indexed_file(
    file_id: String,
    state: State<'_, AppState>,
) -> Result<ExternalOpenResult, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entry = find_entry(&state, &file_id)?;
    let is_directory = entry.kind == "folder";
    let name = entry.name.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let path = if is_directory {
            filesystem::validate_directory_path(&entry.path).map_err(map_path_validation_error)?
        } else {
            operations::validate_indexed_file(&entry)
                .map_err(|error| error.to_string())?
                .0
        };
        external::reveal_in_explorer(&path, is_directory).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "定位文件任务未完成，请重试".to_string())??;
    Ok(ExternalOpenResult { name })
}

#[tauri::command]
pub async fn rename_indexed_file(
    file_id: String,
    new_name: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<IndexEntry>, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entry = find_entry(&state, &file_id)?;
    if entry.kind == "folder" {
        return Err("暂时只支持重命名普通文件".to_string());
    }
    let operation = tauri::async_runtime::spawn_blocking(move || {
        let (source, _) =
            operations::validate_indexed_file(&entry).map_err(|error| error.to_string())?;
        let target =
            operations::validate_new_name(&source, &new_name).map_err(|error| error.to_string())?;
        operations::rename_file(&source, &target).map_err(|error| error.to_string())?;
        let mut replacement = match filesystem::index_selected_path(&target.to_string_lossy()) {
            Ok(replacement) => replacement,
            Err(_) => {
                let _ = operations::restore_renamed_file(&target, &source);
                return Err("文件已重命名，但无法读取新文件元数据".to_string());
            }
        };
        replacement.id = entry.id.clone();
        replacement.favorite = entry.favorite;
        replacement.added_at = entry.added_at;
        replacement.preview_status = entry.preview_status.clone();
        replacement.last_recorded_at = entry.last_recorded_at;
        Ok::<(PathBuf, PathBuf, IndexEntry), String>((source, target, replacement))
    })
    .await
    .map_err(|_| "重命名任务未完成，请重试".to_string())??;
    let (source, target, replacement) = operation;
    let updated_entries = state.update_entries(|entries| {
        let current = entries
            .iter_mut()
            .find(|entry| entry.id == file_id)
            .ok_or(StorageError::EntryNotFound)?;
        if !filesystem::same_path(&current.path, &source.to_string_lossy()) {
            return Err(StorageError::EntryNotFound);
        }
        *current = replacement.clone();
        storage::sort_entries(entries);
        Ok(true)
    });
    match updated_entries {
        Ok(entries) => {
            super::emit_index_changed(&app, vec![file_id]);
            Ok(entries)
        }
        Err(error) => {
            if operations::restore_renamed_file(&target, &source) {
                Err(storage_message(error))
            } else {
                Err("文件已重命名，但索引未同步且无法自动回滚，请手动检查".to_string())
            }
        }
    }
}

#[tauri::command]
pub async fn delete_original_file(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<Vec<IndexEntry>, String> {
    if file_id.trim().is_empty() {
        return Err(storage_message(StorageError::InvalidId));
    }
    let entry = find_entry(&state, &file_id)?;
    if entry.kind == "folder" {
        return Err("暂时不支持删除文件夹".to_string());
    }
    if entry.invalid {
        return Err("文件已失效，请使用“从资料库移除”清理记录".to_string());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let (source, _) =
            operations::validate_indexed_file(&entry).map_err(|error| error.to_string())?;
        operations::delete_to_recycle_bin(&source).map_err(|error| error.to_string())
    })
    .await
    .map_err(|_| "删除任务未完成，请重试".to_string())??;

    match state.update_entries(|entries| {
        let position = entries
            .iter()
            .position(|entry| entry.id == file_id)
            .ok_or(StorageError::EntryNotFound)?;
        entries.remove(position);
        Ok(true)
    }) {
        Ok(entries) => {
            super::emit_index_changed(&app, vec![file_id]);
            Ok(entries)
        }
        Err(error) => Err(format!(
            "原文件已移入回收站，但索引未同步：{}",
            storage_message(error)
        )),
    }
}

fn find_entry(state: &State<'_, AppState>, file_id: &str) -> Result<IndexEntry, String> {
    state
        .snapshot()
        .map_err(storage_message)?
        .into_iter()
        .find(|entry| entry.id == file_id)
        .ok_or_else(|| storage_message(StorageError::EntryNotFound))
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
