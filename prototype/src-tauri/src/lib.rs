#[cfg(not(test))]
mod commands;
#[cfg_attr(test, allow(dead_code))]
mod filesystem;
#[cfg(test)]
#[path = "windows/lifecycle_policy.rs"]
mod lifecycle_policy_tests;
#[cfg(test)]
#[path = "windows/monitor.rs"]
mod monitor_tests;
#[cfg_attr(test, allow(dead_code))]
mod preview;
#[cfg_attr(test, allow(dead_code))]
mod storage;
#[cfg(test)]
#[path = "windows/tray_model.rs"]
mod tray_model_tests;
#[cfg(not(test))]
mod windows;

#[cfg(not(test))]
use std::io::Error;

#[cfg(not(test))]
use tauri::{Emitter, Manager};

#[cfg(not(test))]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(preview::RESOURCE_SCHEME, |_context, request| {
            let state = _context.app_handle().state::<preview::PreviewState>();
            state.resource_response(&request)
        })
        .manage(storage::AppState::default())
        .manage(commands::BatchState::default())
        .manage(storage::settings::SettingsState::default())
        .manage({
            let state = preview::PreviewState::default();
            state.start_cleanup_task();
            state
        })
        .manage(windows::FloatingBallState::default())
        .manage(windows::lifecycle::LifecycleState::default())
        .manage(windows::tray::TrayState::default())
        .setup(|app| {
            let data_dir = app
                .path()
                .app_data_dir()
                .map_err(|_| Error::other("无法使用应用数据目录"))?;
            app.state::<storage::AppState>()
                .initialize(data_dir.join("index.json"))
                .map_err(|error| Error::other(error.to_string()))?;
            app.state::<storage::settings::SettingsState>()
                .initialize(data_dir.join("settings.json"))
                .map_err(|error| Error::other(error.to_string()))?;
            let settings = app
                .state::<storage::settings::SettingsState>()
                .snapshot()
                .map_err(|error| Error::other(error.to_string()))?;
            let floating_state = app.state::<windows::FloatingBallState>();
            floating_state.set_desired_visible(settings.show_floating_window);
            if let Some(main_window) = app.get_webview_window("main") {
                let app_handle = app.handle().clone();
                main_window.on_window_event(move |event| {
                    windows::lifecycle::handle_main_window_event(
                        &app_handle,
                        &app_handle.state::<windows::lifecycle::LifecycleState>(),
                        event,
                    );
                });
            }
            if settings.show_floating_window {
                if let Err(error) = windows::create_floating_ball(
                    app.handle(),
                    &floating_state,
                    &data_dir.join("floating-ball.json"),
                ) {
                    floating_state.set_creation_error(Some(error));
                }
            }
            let tray_state = app.state::<windows::tray::TrayState>();
            if let Err(error) = windows::tray::create_tray(app.handle(), &tray_state) {
                tray_state.set_creation_error(Some(error.clone()));
                let _ = app.emit_to("main", "tray-unavailable", error);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file_index,
            commands::list_directory,
            commands::reveal_directory_child,
            commands::index_paths,
            commands::refresh_index,
            commands::get_index_recovery,
            commands::reset_index_recovery,
            commands::export_index_diagnostic,
            commands::reposition_file,
            commands::floating_ball::record_floating_paths,
            commands::floating_ball::get_floating_recent,
            commands::floating_ball::open_main_from_floating,
            commands::floating_ball::load_floating_placement,
            commands::floating_ball::save_floating_placement,
            commands::floating_ball::floating_window_status,
            commands::floating_ball::retry_floating_ball,
            commands::library::set_favorite,
            commands::library::remove_index_entry,
            commands::library::copy_indexed_file,
            commands::library::open_indexed_file,
            commands::library::reveal_indexed_file,
            commands::library::rename_indexed_file,
            commands::library::delete_original_file,
            commands::library::set_entry_tags,
            commands::library::set_entry_group,
            commands::library::create_group,
            commands::library::rename_group,
            commands::library::delete_group,
            commands::library::batch_set_favorite,
            commands::library::batch_remove_index_entries,
            commands::library::batch_update_tags,
            commands::library::batch_set_group,
            commands::library::cancel_batch_operation,
            commands::library::undo_last,
            commands::settings::load_settings,
            commands::settings::update_settings,
            commands::window::set_floating_window_visible,
            commands::window::show_main_window,
            commands::window::tray_status,
            commands::window::exit_app,
            commands::can_preview,
            commands::load_preview,
            commands::dispose_preview,
            commands::cancel_preview_task,
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app_handle, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    app_handle
                        .state::<windows::lifecycle::LifecycleState>()
                        .begin_exit();
                    app_handle.state::<windows::tray::TrayState>().begin_exit();
                    let floating_state = app_handle.state::<windows::FloatingBallState>();
                    windows::close_floating_ball(app_handle, &floating_state);
                    app_handle.state::<preview::PreviewState>().dispose_all();
                    let _ = app_handle.remove_tray_by_id(windows::tray::TRAY_ID);
                }
            });
        });

    if let Err(error) = result {
        eprintln!("本地资料工作台启动失败: {error}");
    }
}
