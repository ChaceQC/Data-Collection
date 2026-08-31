use std::path::{Path, PathBuf};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};

use serde::Serialize;
use tauri::{AppHandle, Manager, PhysicalPosition, Runtime};

pub(crate) mod floating_ball;
pub(crate) mod lifecycle;
pub(crate) mod lifecycle_policy;
pub(crate) mod monitor;
pub(crate) mod tray;
pub(crate) mod tray_model;

pub const FLOATING_BALL_LABEL: &str = "floating-ball";

#[derive(Debug)]
pub struct FloatingBallState {
    stop: Mutex<Arc<AtomicBool>>,
    creation_error: Mutex<Option<String>>,
    desired_visible: AtomicBool,
    placement_path: Mutex<Option<PathBuf>>,
}

impl Default for FloatingBallState {
    fn default() -> Self {
        Self {
            stop: Mutex::new(Arc::new(AtomicBool::new(false))),
            creation_error: Mutex::new(None),
            desired_visible: AtomicBool::new(true),
            placement_path: Mutex::new(None),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingWindowStatus {
    pub visible: bool,
    pub available: bool,
    pub error: Option<String>,
}

impl FloatingBallState {
    pub fn set_creation_error(&self, error: Option<String>) {
        if let Ok(mut current) = self.creation_error.lock() {
            *current = error;
        }
    }

    pub fn set_desired_visible(&self, visible: bool) {
        self.desired_visible.store(visible, Ordering::Release);
    }

    pub fn desired_visible(&self) -> bool {
        self.desired_visible.load(Ordering::Acquire)
    }

    pub fn set_placement_path(&self, path: &Path) {
        if let Ok(mut current) = self.placement_path.lock() {
            *current = Some(path.to_path_buf());
        }
    }

    pub fn placement_path(&self) -> Option<PathBuf> {
        self.placement_path
            .lock()
            .ok()
            .and_then(|current| current.clone())
    }

    pub fn status<R: Runtime>(&self, app: &AppHandle<R>) -> FloatingWindowStatus {
        let window = app.get_webview_window(FLOATING_BALL_LABEL);
        let visible = window
            .as_ref()
            .and_then(|current| current.is_visible().ok())
            .unwrap_or(false);
        let available = !self.desired_visible() || window.is_some();
        let error = if available {
            None
        } else {
            self.creation_error
                .lock()
                .ok()
                .and_then(|current| current.clone())
                .or_else(|| Some("悬浮球不可用，请重试".to_string()))
        };
        FloatingWindowStatus {
            visible,
            available,
            error,
        }
    }

    pub fn stop(&self) {
        if let Ok(current) = self.stop.lock() {
            current.store(true, Ordering::Release);
        }
    }

    pub fn restart_monitor(&self) -> Arc<AtomicBool> {
        let next = Arc::new(AtomicBool::new(false));
        if let Ok(mut current) = self.stop.lock() {
            current.store(true, Ordering::Release);
            *current = next.clone();
        } else {
            next.store(true, Ordering::Release);
        }
        self.set_creation_error(None);
        next
    }
}

pub fn create_floating_ball<R: Runtime>(
    app: &AppHandle<R>,
    state: &FloatingBallState,
    placement_path: &std::path::Path,
) -> Result<(), String> {
    state.set_desired_visible(true);
    state.set_placement_path(placement_path);
    if let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) {
        if window.is_visible().unwrap_or(false) {
            state.set_creation_error(None);
            return Ok(());
        }
        state.stop();
        window
            .show()
            .map_err(|_| "悬浮球窗口无法显示，请重试".to_string())?;
        monitor::start_proximity_monitor(app.clone(), state.restart_monitor());
        return Ok(());
    }
    state.stop();
    let areas = monitor::available_work_areas(app);
    let placement = crate::storage::floating_ball::load_placement(placement_path)
        .map(|placement| monitor::normalize_placement(placement, &areas))
        .unwrap_or_else(|_| monitor::safe_default(&areas));
    let physical_position = monitor::window_position_physical(&placement, &areas);
    let window = floating_ball::build_window(app)?;
    if window
        .set_position(PhysicalPosition::new(
            physical_position.0,
            physical_position.1,
        ))
        .is_err()
    {
        let _ = window.destroy();
        return Err("悬浮球窗口位置无法设置，请重试".to_string());
    }
    if window.show().is_err() {
        let _ = window.destroy();
        return Err("悬浮球窗口无法显示，请重试".to_string());
    }
    monitor::start_proximity_monitor(app.clone(), state.restart_monitor());
    Ok(())
}

pub fn hide_floating_ball<R: Runtime>(app: &AppHandle<R>, state: &FloatingBallState) {
    state.set_desired_visible(false);
    state.stop();
    if let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) {
        let _ = window.destroy();
    }
    state.set_creation_error(None);
}

pub fn show_floating_ball<R: Runtime>(
    app: &AppHandle<R>,
    state: &FloatingBallState,
) -> Result<(), String> {
    state.set_desired_visible(true);
    let placement_path = match state.placement_path() {
        Some(path) => path,
        None => app
            .path()
            .app_data_dir()
            .map_err(|_| "应用数据目录不可用".to_string())?
            .join("floating-ball.json"),
    };
    create_floating_ball(app, state, &placement_path)?;
    state.set_creation_error(None);
    Ok(())
}

pub fn close_floating_ball<R: Runtime>(app: &AppHandle<R>, state: &FloatingBallState) {
    state.set_desired_visible(false);
    state.stop();
    if let Some(window) = app.get_webview_window(FLOATING_BALL_LABEL) {
        let _ = window.destroy();
    }
}
