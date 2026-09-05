//! 索引、导入和目录 command 的公开 IPC 边界。
//!
//! 具体业务实现暂时保留在 `commands::mod` 的兼容层，所有进入 Tauri 的
//! 索引 command 统一在这里收敛错误形状，后续可以独立迁移实现而不改变协议。

use tauri::{AppHandle, State};

use crate::filesystem::DirectoryEntry;
use crate::storage::{AppState, IndexSnapshot};

use super::{
    legacy_command_error, BatchState, CommandError, DirectoryTarget, IndexImportResult,
    IndexMutationResult, IndexRefreshResult, RecursiveImportResult,
};

#[tauri::command]
pub async fn load_file_index(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexSnapshot, CommandError> {
    super::load_file_index_impl(state, app).map_err(legacy_command_error)
}

#[tauri::command]
pub async fn list_directory(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<Vec<DirectoryEntry>, CommandError> {
    super::list_directory_impl(target, state)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub async fn reveal_directory_child(
    target: DirectoryTarget,
    state: State<'_, AppState>,
) -> Result<super::library::ExternalOpenResult, CommandError> {
    super::reveal_directory_child_impl(target, state)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub async fn index_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexImportResult, CommandError> {
    super::index_paths_command_impl(paths, state, app)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub async fn import_folders_recursive(
    paths: Vec<String>,
    operation_id: String,
    policy: Option<crate::filesystem::recursive_import::RecursiveImportPolicy>,
    state: State<'_, AppState>,
    batch_state: State<'_, BatchState>,
    app: AppHandle,
) -> Result<RecursiveImportResult, CommandError> {
    super::import_folders_recursive_impl(paths, operation_id, policy, state, batch_state, app).await
}

#[tauri::command]
pub async fn reposition_file(
    file_id: String,
    new_path: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexMutationResult, CommandError> {
    super::reposition_file_impl(file_id, new_path, state, app)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub async fn refresh_index(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexRefreshResult, CommandError> {
    super::refresh_index_impl(state, app)
        .await
        .map_err(legacy_command_error)
}

#[tauri::command]
pub fn get_index_recovery(
    state: State<'_, AppState>,
) -> Result<Option<crate::storage::IndexRecoveryStatus>, CommandError> {
    super::get_index_recovery_impl(state).map_err(legacy_command_error)
}

#[tauri::command]
pub fn reset_index_recovery(
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<IndexSnapshot, CommandError> {
    super::reset_index_recovery_impl(state, app).map_err(legacy_command_error)
}

#[tauri::command]
pub fn export_index_diagnostic(
    destination: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    super::export_index_diagnostic_impl(destination, state).map_err(legacy_command_error)
}
