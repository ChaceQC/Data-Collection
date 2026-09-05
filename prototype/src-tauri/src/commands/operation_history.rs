use tauri::State;

use super::{legacy_command_error, CommandError};
use crate::storage::operation_history::{
    OperationHistorySnapshot, OperationHistoryState, OperationRecord,
};

#[tauri::command]
pub fn load_operation_history(
    state: State<'_, OperationHistoryState>,
) -> Result<OperationHistorySnapshot, CommandError> {
    state
        .snapshot()
        .map_err(|error| legacy_command_error(error.to_string()))
}

#[tauri::command]
pub fn save_operation_record(
    record: OperationRecord,
    state: State<'_, OperationHistoryState>,
) -> Result<OperationRecord, CommandError> {
    state
        .upsert(record)
        .map_err(|error| legacy_command_error(error.to_string()))
}

#[tauri::command]
pub fn clear_operation_history(
    state: State<'_, OperationHistoryState>,
) -> Result<(), CommandError> {
    state
        .clear()
        .map_err(|error| legacy_command_error(error.to_string()))
}
