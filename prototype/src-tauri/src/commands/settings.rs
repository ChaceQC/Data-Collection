use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::{
    commands::command_error,
    storage::settings::{AppSettings, SettingsState, SettingsUpdate},
    windows::{self, FloatingBallState, FloatingWindowStatus},
};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SettingsChangedEvent {
    pub settings: AppSettings,
    pub floating_window: FloatingWindowStatus,
    pub warning: Option<String>,
}

#[tauri::command]
pub fn load_settings(state: State<'_, SettingsState>) -> Result<AppSettings, String> {
    state.snapshot().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn update_settings(
    settings: SettingsUpdate,
    state: State<'_, SettingsState>,
    app: AppHandle,
) -> Result<AppSettings, super::CommandError> {
    let saved = state.update(settings).map_err(settings_error)?;
    apply_runtime_settings(&app, &saved);
    Ok(saved)
}

fn settings_error(error: crate::storage::settings::SettingsError) -> super::CommandError {
    let (code, retryable) = match error {
        crate::storage::settings::SettingsError::Conflict => ("settings-conflict", false),
        crate::storage::settings::SettingsError::InvalidValue => ("settings-invalid", false),
        crate::storage::settings::SettingsError::DataDirectory
        | crate::storage::settings::SettingsError::Read
        | crate::storage::settings::SettingsError::Write
        | crate::storage::settings::SettingsError::State
        | crate::storage::settings::SettingsError::Corrupt
        | crate::storage::settings::SettingsError::UnsupportedVersion => {
            ("settings-unavailable", true)
        }
    };
    command_error(code, error.to_string(), retryable, "unchanged")
}

pub(crate) fn apply_runtime_settings<R: Runtime>(
    app: &AppHandle<R>,
    settings: &AppSettings,
) -> FloatingWindowStatus {
    let floating_state = app.state::<FloatingBallState>();
    let apply_result = if settings.show_floating_window {
        windows::show_floating_ball(app, &floating_state)
    } else {
        windows::hide_floating_ball(app, &floating_state);
        Ok(())
    };
    let status = match apply_result {
        Ok(()) => floating_state.status(app),
        Err(error) => {
            floating_state.set_creation_error(Some(error));
            floating_state.status(app)
        }
    };
    let warning = if settings.show_floating_window && !status.available {
        status.error.clone()
    } else {
        None
    };
    let _ = app.emit_to(
        "main",
        "settings-changed",
        SettingsChangedEvent {
            settings: settings.clone(),
            floating_window: status.clone(),
            warning,
        },
    );
    let _ = app.emit_to("floating-ball", "floating-window-status", status.clone());
    windows::tray::refresh_menu(app);
    status
}
