use tauri::{AppHandle, Emitter, State};

use crate::windows::{
    self, lifecycle::LifecycleState, tray::TrayState, FloatingBallState, FloatingWindowStatus,
};

#[tauri::command]
pub async fn set_floating_window_visible(
    visible: bool,
    state: State<'_, FloatingBallState>,
    app: AppHandle,
) -> Result<FloatingWindowStatus, String> {
    if visible {
        windows::show_floating_ball(&app, &state)?;
    } else {
        windows::hide_floating_ball(&app, &state);
    }
    let status = state.status(&app);
    let _ = app.emit_to("main", "floating-window-status", status.clone());
    let _ = app.emit_to("floating-ball", "floating-window-status", status.clone());
    windows::tray::refresh_menu(&app);
    Ok(status)
}

#[tauri::command]
pub fn show_main_window(app: AppHandle) -> Result<(), String> {
    windows::lifecycle::show_main_window(&app)
}

#[tauri::command]
pub fn tray_status(state: State<'_, TrayState>, app: AppHandle) -> windows::tray::TrayStatus {
    windows::tray::status(&app, &state)
}

#[tauri::command]
pub fn exit_app(
    app: AppHandle,
    lifecycle: State<'_, LifecycleState>,
    floating: State<'_, FloatingBallState>,
    preview: State<'_, crate::preview::PreviewState>,
) -> Result<(), String> {
    windows::lifecycle::request_exit(&app, &lifecycle, &floating, &preview);
    Ok(())
}
