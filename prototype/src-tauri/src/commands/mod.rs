use serde::Serialize;
use tauri::State;

use crate::{
    filesystem::{self, IndexEntry},
    preview::{self, PreviewOptions, PreviewResult, PreviewState, PreviewSupport},
    storage::{self, AppState, StorageError},
};

pub(crate) mod library;
pub(crate) mod settings;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexResult {
    pub entries: Vec<IndexEntry>,
    pub indexed_count: usize,
    pub refreshed_count: usize,
    pub skipped_count: usize,
    pub truncated: bool,
    pub added_ids: Vec<String>,
}

#[tauri::command]
pub fn load_file_index(state: State<'_, AppState>) -> Result<Vec<IndexEntry>, String> {
    state
        .update_entries(|entries| {
            let mut changed = false;
            for entry in entries.iter_mut() {
                changed |= filesystem::refresh_entry(entry);
            }
            let before_sort = entries
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>();
            storage::sort_entries(entries);
            let sorted_changed = before_sort
                != entries
                    .iter()
                    .map(|entry| entry.id.clone())
                    .collect::<Vec<_>>();
            Ok(changed || sorted_changed)
        })
        .map_err(storage_message)
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<IndexEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || filesystem::list_directory(&path))
        .await
        .map_err(|_| "目录读取任务未完成，请重试".to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn index_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
) -> Result<IndexResult, String> {
    if paths.is_empty() {
        return Err("请选择文件或文件夹".to_string());
    }

    let scan = tauri::async_runtime::spawn_blocking(move || filesystem::scan_paths(&paths))
        .await
        .map_err(|_| "索引任务未完成，请重试".to_string())?;
    let indexed_count = scan.entries.len();
    let skipped_count = scan.skipped_count;
    let truncated = scan.truncated;
    let mut added_ids = Vec::new();
    let mut refreshed_count = 0;
    let entries = state
        .update_entries(|entries| {
            for incoming in scan.entries {
                let incoming_path = incoming.path.clone();
                if let Some(existing) = entries
                    .iter_mut()
                    .find(|entry| filesystem::same_path(&entry.path, &incoming_path))
                {
                    let favorite = existing.favorite;
                    let preview_status = existing.preview_status.clone();
                    let added_at = existing.added_at;
                    let id = existing.id.clone();
                    *existing = incoming;
                    existing.favorite = favorite;
                    existing.preview_status = preview_status;
                    existing.added_at = added_at;
                    existing.id = id;
                    refreshed_count += 1;
                } else {
                    added_ids.push(incoming.id.clone());
                    entries.push(incoming);
                }
            }
            storage::sort_entries(entries);
            Ok(true)
        })
        .map_err(storage_message)?;

    Ok(IndexResult {
        entries,
        indexed_count,
        refreshed_count,
        skipped_count,
        truncated,
        added_ids,
    })
}

#[tauri::command]
pub async fn reposition_file(
    file_id: String,
    new_path: String,
    state: State<'_, AppState>,
) -> Result<Vec<IndexEntry>, String> {
    let replacement =
        tauri::async_runtime::spawn_blocking(move || filesystem::index_selected_path(&new_path))
            .await
            .map_err(|_| "重新定位任务未完成，请重试".to_string())?
            .map_err(|error| error.to_string())?;

    state
        .update_entries(|entries| {
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
            let mut replacement = replacement;
            replacement.id = id;
            replacement.favorite = favorite;
            replacement.added_at = added_at;
            replacement.preview_status = preview_status;
            entries[position] = replacement;
            storage::sort_entries(entries);
            Ok(true)
        })
        .map_err(|error| match error {
            StorageError::InvalidId if file_id.trim().is_empty() => "资料 ID 不能为空".to_string(),
            StorageError::InvalidId => "重新定位的文件类型不匹配，请选择相同类型的路径".to_string(),
            other => storage_message(other),
        })
}

#[tauri::command]
pub async fn can_preview(path: String, kind: String) -> Result<PreviewSupport, String> {
    tauri::async_runtime::spawn_blocking(move || preview::can_preview(&path, &kind))
        .await
        .map_err(|_| "预览检查任务未完成，请重试".to_string())
}

#[tauri::command]
pub async fn load_preview(
    path: String,
    kind: String,
    options: Option<PreviewOptions>,
    state: State<'_, PreviewState>,
) -> Result<PreviewResult, String> {
    let preview_state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        preview::load_preview(&path, &kind, options.unwrap_or_default(), &preview_state)
    })
    .await
    .map_err(|_| "预览任务未完成，请重试".to_string())
}

#[tauri::command]
pub fn dispose_preview(preview_id: String, state: State<'_, PreviewState>) -> Result<(), String> {
    preview::dispose_preview(state.inner(), &preview_id);
    Ok(())
}

pub(super) fn storage_message(error: StorageError) -> String {
    error.to_string()
}
