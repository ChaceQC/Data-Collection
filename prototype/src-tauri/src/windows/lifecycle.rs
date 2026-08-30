use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, Emitter, Manager, Runtime, WindowEvent};

use crate::{preview::PreviewState, storage::settings::SettingsState};

use super::{close_floating_ball, FloatingBallState};

pub const MAIN_WINDOW_LABEL: &str = "main";

#[derive(Debug, Default)]
pub struct LifecycleState {
    exiting: AtomicBool,
}

#[allow(dead_code)]
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum AppLifecycleState {
    Visible,
    HiddenToTray,
    FloatingDisabled,
    FloatingError,
    Exiting,
}

impl LifecycleState {
    pub fn begin_exit(&self) -> bool {
        !self.exiting.swap(true, Ordering::AcqRel)
    }

    pub fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
    }
}

pub fn handle_main_window_event<R: Runtime>(
    app: &AppHandle<R>,
    state: &LifecycleState,
    event: &WindowEvent,
) {
    let WindowEvent::CloseRequested { api, .. } = event else {
        return;
    };
    if state.is_exiting() {
        return;
    }
    let hide_to_tray = app
        .state::<SettingsState>()
        .snapshot()
        .map(|settings| settings.hide_to_tray)
        .unwrap_or(false);
    if !hide_to_tray {
        return;
    }
    if app.tray_by_id(super::tray::TRAY_ID).is_none() {
        api.prevent_close();
        let _ = app.emit_to(
            MAIN_WINDOW_LABEL,
            "tray-unavailable",
            "托盘不可用，已保留主窗口；请关闭隐藏设置后再退出",
        );
        return;
    }
    api.prevent_close();
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.hide();
    }
    let _ = app.emit_to(MAIN_WINDOW_LABEL, "main-window-hidden", ());
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "主窗口不可用，请重试".to_string())?;
    window
        .show()
        .map_err(|_| "主窗口无法显示，请重试".to_string())?;
    window
        .unminimize()
        .map_err(|_| "主窗口无法恢复，请重试".to_string())?;
    window
        .set_focus()
        .map_err(|_| "主窗口无法获得焦点，请重试".to_string())?;
    Ok(())
}

pub fn request_exit<R: Runtime>(
    app: &AppHandle<R>,
    state: &LifecycleState,
    floating_state: &FloatingBallState,
    preview_state: &PreviewState,
) {
    if !state.begin_exit() {
        return;
    }
    close_floating_ball(app, floating_state);
    preview_state.dispose_all();
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        let _ = window.destroy();
    }
    app.exit(0);
}

#[allow(dead_code)]
pub fn lifecycle_state<R: Runtime>(
    app: &AppHandle<R>,
    settings: &SettingsState,
    floating: &FloatingBallState,
) -> AppLifecycleState {
    let Ok(app_settings) = settings.snapshot() else {
        return AppLifecycleState::FloatingError;
    };
    if app.state::<LifecycleState>().is_exiting() {
        return AppLifecycleState::Exiting;
    }
    if !app_settings.show_floating_window {
        return AppLifecycleState::FloatingDisabled;
    }
    if floating.status(app).available {
        if app
            .get_webview_window(MAIN_WINDOW_LABEL)
            .and_then(|window| window.is_visible().ok())
            .unwrap_or(false)
        {
            AppLifecycleState::Visible
        } else {
            AppLifecycleState::HiddenToTray
        }
    } else {
        AppLifecycleState::FloatingError
    }
}
