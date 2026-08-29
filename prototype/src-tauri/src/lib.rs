#[cfg(not(test))]
mod commands;
mod config;
#[cfg_attr(test, allow(dead_code))]
mod filesystem;
#[cfg_attr(test, allow(dead_code))]
mod preview;
#[cfg_attr(test, allow(dead_code))]
mod storage;

#[cfg(not(test))]
use std::io::Error;

#[cfg(not(test))]
use tauri::Manager;

#[cfg(not(test))]
pub fn run() {
    let result = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .register_uri_scheme_protocol(preview::RESOURCE_SCHEME, |_context, request| {
            let state = _context.app_handle().state::<preview::PreviewState>();
            state.resource_response(&request)
        })
        .manage(storage::AppState::default())
        .manage(storage::settings::SettingsState::default())
        .manage(preview::PreviewState::default())
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
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::load_file_index,
            commands::list_directory,
            commands::index_paths,
            commands::reposition_file,
            commands::library::set_favorite,
            commands::library::remove_index_entry,
            commands::library::copy_indexed_file,
            commands::library::open_indexed_file,
            commands::library::reveal_indexed_file,
            commands::library::rename_indexed_file,
            commands::library::delete_original_file,
            commands::settings::load_settings,
            commands::settings::update_settings,
            commands::can_preview,
            commands::load_preview,
            commands::dispose_preview
        ])
        .build(tauri::generate_context!())
        .map(|app| {
            app.run(|app_handle, event| {
                if matches!(event, tauri::RunEvent::Exit) {
                    app_handle.state::<preview::PreviewState>().dispose_all();
                }
            });
        });

    if let Err(error) = result {
        eprintln!("本地资料工作台启动失败: {error}");
    }
}
