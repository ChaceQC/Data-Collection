use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};

use serde::Serialize;
use tauri::{
    menu::{CheckMenuItem, Menu, MenuItem, Submenu},
    tray::{MouseButton, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, Runtime,
};

use crate::{
    commands::{self, settings::apply_runtime_settings},
    storage::{
        self,
        settings::{SettingsState, SettingsUpdate},
        AppState,
    },
};

use super::{
    lifecycle::{self, LifecycleState},
    tray_model::{self, TrayMenuAction},
    FloatingBallState,
};

pub const TRAY_ID: &str = "main-tray";
const PRODUCT_NAME: &str = "本地资料工作台";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayStatus {
    pub available: bool,
    pub error: Option<String>,
}

#[derive(Debug, Default)]
pub struct TrayState {
    exiting: AtomicBool,
    menu_lock: Mutex<()>,
    creation_error: Mutex<Option<String>>,
}

impl TrayState {
    pub fn begin_exit(&self) -> bool {
        !self.exiting.swap(true, Ordering::AcqRel)
    }

    pub fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
    }

    pub fn set_creation_error(&self, error: Option<String>) {
        if let Ok(mut current) = self.creation_error.lock() {
            *current = error;
        }
    }

    pub fn error(&self) -> Option<String> {
        self.creation_error
            .lock()
            .ok()
            .and_then(|current| current.clone())
    }
}

pub fn status<R: Runtime>(app: &AppHandle<R>, state: &TrayState) -> TrayStatus {
    let available = app.tray_by_id(TRAY_ID).is_some();
    TrayStatus {
        available,
        error: if available {
            None
        } else {
            state
                .error()
                .or_else(|| Some("系统托盘不可用，请重试".to_string()))
        },
    }
}

pub fn create_tray<R: Runtime>(app: &AppHandle<R>, state: &TrayState) -> Result<(), String> {
    if app.tray_by_id(TRAY_ID).is_some() {
        state.set_creation_error(None);
        refresh_menu(app);
        return Ok(());
    }
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or_else(|| "托盘图标不可用，请重试".to_string())?;
    let menu = build_menu(app)?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .tooltip(PRODUCT_NAME)
        .show_menu_on_left_click(false)
        .menu(&menu)
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(|_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                ..
            } = event
            {
                let _ = lifecycle::show_main_window(_tray.app_handle());
            }
        })
        .build(app)
        .map_err(|_| "系统托盘无法创建，请重试".to_string())?;
    state.set_creation_error(None);
    Ok(())
}

pub fn refresh_menu<R: Runtime>(app: &AppHandle<R>) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    let state = app.state::<TrayState>();
    if state.is_exiting() {
        return;
    }
    let Ok(_guard) = state.menu_lock.try_lock() else {
        return;
    };
    match build_menu(app) {
        Ok(menu) => {
            if tray.set_menu(Some(menu)).is_ok() {
                state.set_creation_error(None);
            } else {
                state.set_creation_error(Some("托盘菜单暂时无法更新，请重试".to_string()));
            }
        }
        Err(error) => state.set_creation_error(Some(error)),
    }
}

fn build_menu<R: Runtime>(app: &AppHandle<R>) -> Result<Menu<R>, String> {
    let settings = app
        .state::<SettingsState>()
        .snapshot()
        .map_err(|_| "本地设置暂时无法读取".to_string())?;
    let open_main = MenuItem::with_id(app, "tray-open-main", "打开主窗口", true, None::<&str>)
        .map_err(|_| "托盘菜单无法创建".to_string())?;
    let toggle_floating = CheckMenuItem::with_id(
        app,
        "tray-toggle-floating",
        if settings.show_floating_window {
            "隐藏悬浮窗"
        } else {
            "显示悬浮窗"
        },
        true,
        settings.show_floating_window,
        None::<&str>,
    )
    .map_err(|_| "托盘菜单无法创建".to_string())?;
    let refresh_index =
        MenuItem::with_id(app, "tray-refresh-index", "刷新索引", true, None::<&str>)
            .map_err(|_| "托盘菜单无法创建".to_string())?;
    let recent = build_recent_submenu(app)?;
    let open_settings =
        MenuItem::with_id(app, "tray-open-settings", "打开设置", true, None::<&str>)
            .map_err(|_| "托盘菜单无法创建".to_string())?;
    let exit = MenuItem::with_id(app, "tray-exit", "退出", true, None::<&str>)
        .map_err(|_| "托盘菜单无法创建".to_string())?;
    let menu = Menu::new(app).map_err(|_| "托盘菜单无法创建".to_string())?;
    menu.append(&open_main)
        .and_then(|_| menu.append(&toggle_floating))
        .and_then(|_| menu.append(&refresh_index))
        .and_then(|_| menu.append(&recent))
        .and_then(|_| menu.append(&open_settings))
        .and_then(|_| menu.append(&exit))
        .map_err(|_| "托盘菜单无法创建".to_string())?;
    Ok(menu)
}

fn build_recent_submenu<R: Runtime>(app: &AppHandle<R>) -> Result<Submenu<R>, String> {
    let recent = app
        .state::<AppState>()
        .snapshot()
        .map_err(|_| "最近任务暂时无法读取".to_string())
        .map(|entries| storage::floating_recent(&entries));
    let submenu = Submenu::with_id(app, "tray-recent-tasks", "最近任务", true)
        .map_err(|_| "托盘菜单无法创建".to_string())?;
    match recent {
        Ok(entries) if entries.is_empty() => {
            let item = MenuItem::with_id(
                app,
                "tray-recent-empty",
                "暂无最近任务",
                false,
                None::<&str>,
            )
            .map_err(|_| "托盘菜单无法创建".to_string())?;
            submenu
                .append(&item)
                .map_err(|_| "托盘菜单无法创建".to_string())?;
        }
        Ok(entries) => {
            for entry in entries {
                let safe_id = entry.id.as_str();
                if tray_model::parse_menu_id(&format!("tray-task-open:{safe_id}")).is_none() {
                    continue;
                }
                let task = Submenu::with_id(
                    app,
                    format!("tray-task:{safe_id}"),
                    tray_model::task_label(&entry.name, entry.invalid),
                    true,
                )
                .map_err(|_| "托盘菜单无法创建".to_string())?;
                let open = MenuItem::with_id(
                    app,
                    format!("tray-task-open:{safe_id}"),
                    "打开任务",
                    true,
                    None::<&str>,
                )
                .map_err(|_| "托盘菜单无法创建".to_string())?;
                let favorite = MenuItem::with_id(
                    app,
                    format!("tray-task-favorite:{safe_id}"),
                    tray_model::favorite_label(entry.favorite),
                    true,
                    None::<&str>,
                )
                .map_err(|_| "托盘菜单无法创建".to_string())?;
                task.append(&open)
                    .and_then(|_| task.append(&favorite))
                    .map_err(|_| "托盘菜单无法创建".to_string())?;
                submenu
                    .append(&task)
                    .map_err(|_| "托盘菜单无法创建".to_string())?;
            }
        }
        Err(_) => {
            let item = MenuItem::with_id(
                app,
                "tray-recent-error",
                "最近任务暂时无法读取",
                false,
                None::<&str>,
            )
            .map_err(|_| "托盘菜单无法创建".to_string())?;
            submenu
                .append(&item)
                .map_err(|_| "托盘菜单无法创建".to_string())?;
        }
    }
    Ok(submenu)
}

fn handle_menu_event<R: Runtime>(app: &AppHandle<R>, event: tauri::menu::MenuEvent) {
    let Some(action) = tray_model::parse_menu_id(event.id().as_ref()) else {
        return;
    };
    match action {
        TrayMenuAction::OpenMain => {
            if let Err(error) = lifecycle::show_main_window(app) {
                emit_error(app, &error);
            }
        }
        TrayMenuAction::OpenSettings => {
            if let Err(error) = lifecycle::show_main_window(app) {
                emit_error(app, &error);
                return;
            }
            let _ = app.emit_to("main", "open-settings", ());
        }
        TrayMenuAction::ToggleFloating => toggle_floating(app),
        TrayMenuAction::RefreshIndex => {
            let state = app.state::<AppState>();
            if commands::refresh_index_sync(state.inner(), app).is_err() {
                emit_error(app, "索引刷新失败，请重试");
            }
        }
        TrayMenuAction::Exit => {
            let lifecycle_state = app.state::<LifecycleState>();
            let floating = app.state::<FloatingBallState>();
            let preview = app.state::<crate::preview::PreviewState>();
            if app.state::<TrayState>().begin_exit() {
                lifecycle::request_exit(app, &lifecycle_state, &floating, &preview);
            }
        }
        TrayMenuAction::OpenTask(file_id) => open_task(app, &file_id),
        TrayMenuAction::ToggleFavorite(file_id) => toggle_favorite(app, &file_id),
    }
}

fn toggle_floating<R: Runtime>(app: &AppHandle<R>) {
    let settings_state = app.state::<SettingsState>();
    let Ok(current) = settings_state.snapshot() else {
        emit_error(app, "本地设置暂时无法读取");
        return;
    };
    let next_visible = !current.show_floating_window;
    let update = SettingsUpdate {
        default_sort: current.default_sort,
        page_size: current.page_size,
        confirm_before_remove: current.confirm_before_remove,
        hide_to_tray: current.hide_to_tray,
        show_floating_window: next_visible,
        expected_revision: Some(current.revision),
    };
    match settings_state.update(update) {
        Ok(saved) => {
            let app_handle = app.clone();
            tauri::async_runtime::spawn(async move {
                apply_runtime_settings(&app_handle, &saved);
            });
        }
        Err(_) => emit_error(app, "悬浮窗设置保存失败，请重试"),
    }
}

fn open_task<R: Runtime>(app: &AppHandle<R>, file_id: &str) {
    let exists = app
        .state::<AppState>()
        .snapshot()
        .map(|entries| entries.iter().any(|entry| entry.id == file_id))
        .unwrap_or(false);
    if !exists {
        emit_error(app, "最近任务已从资料库移除");
        refresh_menu(app);
        return;
    }
    if let Err(error) = lifecycle::show_main_window(app) {
        emit_error(app, &error);
        return;
    }
    let _ = app.emit_to(
        "main",
        "floating-open-file",
        serde_json::json!({ "fileId": file_id }),
    );
}

fn toggle_favorite<R: Runtime>(app: &AppHandle<R>, file_id: &str) {
    let current_favorite = app.state::<AppState>().snapshot().ok().and_then(|entries| {
        entries
            .into_iter()
            .find(|entry| entry.id == file_id)
            .map(|entry| entry.favorite)
    });
    let Some(current_favorite) = current_favorite else {
        emit_error(app, "最近任务已从资料库移除");
        refresh_menu(app);
        return;
    };
    let result = app
        .state::<AppState>()
        .update_index_with_undo("favorite", |entries, _groups| {
            let changed = storage::set_favorite(entries, file_id, !current_favorite)?;
            Ok((changed, ()))
        });
    match result {
        Ok(result) if result.changed => commands::emit_index_changed(
            app,
            result.revision,
            vec![file_id.to_string()],
            "favorite",
        ),
        Ok(_) => {}
        Err(_) => emit_error(app, "收藏状态更新失败，请重试"),
    }
}

fn emit_error<R: Runtime>(app: &AppHandle<R>, message: &str) {
    let _ = app.emit_to("main", "tray-action-error", message);
}
