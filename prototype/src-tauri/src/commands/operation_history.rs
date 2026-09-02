use tauri::State;

use crate::storage::operation_history::{
    OperationHistorySnapshot, OperationHistoryState, OperationRecord,
};

#[tauri::command]
pub fn load_operation_history(
    state: State<'_, OperationHistoryState>,
) -> Result<OperationHistorySnapshot, String> {
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_operation_record(
    record: OperationRecord,
    state: State<'_, OperationHistoryState>,
) -> Result<OperationRecord, String> {
    state.upsert(record).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn clear_operation_history(state: State<'_, OperationHistoryState>) -> Result<(), String> {
    state.clear().map_err(|error| error.to_string())
}
