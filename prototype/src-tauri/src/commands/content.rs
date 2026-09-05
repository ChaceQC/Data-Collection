//! 正文索引和正文搜索 command 的 IPC 边界。

use tauri::{AppHandle, State};

use crate::storage::{self, AppState};

use super::{BatchState, CommandError, ContentIndexRebuildResult, ContentSearchResponse};

#[tauri::command]
pub fn content_index_status(
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    super::content_index_status_impl(state)
}

#[tauri::command]
pub fn search_content(
    query: String,
    use_regex: bool,
    state: State<'_, storage::content_index::ContentIndexState>,
) -> Result<ContentSearchResponse, CommandError> {
    super::search_content_impl(query, use_regex, state)
}

#[tauri::command]
pub async fn search_metadata(
    query: storage::metadata_search::MetadataSearchQuery,
    state: State<'_, AppState>,
) -> Result<storage::metadata_search::MetadataSearchResponse, CommandError> {
    super::search_metadata_impl(query, state).await
}

#[tauri::command]
pub async fn rebuild_content_index(
    operation_id: String,
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<ContentIndexRebuildResult, CommandError> {
    super::rebuild_content_index_impl(operation_id, state, content_state, batch_state, app).await
}

#[tauri::command]
pub fn clear_content_index(
    state: State<'_, AppState>,
    content_state: State<'_, storage::content_index::ContentIndexState>,
    app: AppHandle,
) -> Result<storage::content_index::ContentIndexStatus, CommandError> {
    super::clear_content_index_impl(state, content_state, app)
}

#[tauri::command]
pub fn cancel_content_index(
    operation_id: String,
    state: State<'_, BatchState>,
) -> Result<(), CommandError> {
    super::cancel_content_index_impl(operation_id, state)
}
