//! 预览 command 的 IPC 边界。

use tauri::{AppHandle, State};

use crate::preview::{PreviewOptions, PreviewResult, PreviewState, PreviewSupport};
use crate::storage::AppState;

use super::{legacy_command_error, CommandError, IndexMutationResult, PreviewTarget};

#[tauri::command]
pub async fn can_preview(
    target: PreviewTarget,
    kind: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<PreviewSupport, CommandError> {
    super::can_preview_impl(target, kind, state, app)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub async fn load_preview(
    target: PreviewTarget,
    kind: String,
    options: Option<PreviewOptions>,
    index_state: State<'_, AppState>,
    state: State<'_, PreviewState>,
    app: AppHandle,
) -> Result<PreviewResult, CommandError> {
    super::load_preview_impl(target, kind, options, index_state, state, app)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub fn dispose_preview(
    preview_id: String,
    state: State<'_, PreviewState>,
) -> Result<(), CommandError> {
    super::dispose_preview_impl(preview_id, state).map_err(legacy_command_error)
}

#[tauri::command]
pub fn cancel_preview_task(
    task_id: String,
    state: State<'_, PreviewState>,
) -> Result<(), CommandError> {
    super::cancel_preview_task_impl(task_id, state).map_err(legacy_command_error)
}

#[tauri::command]
pub fn record_preview_outcome(
    file_id: String,
    status: String,
    expected_revision: u64,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    super::record_preview_outcome_impl(file_id, status, expected_revision, state, app)
}
