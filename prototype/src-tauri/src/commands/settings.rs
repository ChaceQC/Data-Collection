use tauri::State;

use crate::storage::settings::{AppSettings, SettingsState, SettingsUpdate};

#[tauri::command]
pub fn load_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn update_settings(
    settings: SettingsUpdate,
    state: State<'_, SettingsState>,
) -> Result<AppSettings, String> {
    state.update(settings).map_err(|error| error.to_string())
}
