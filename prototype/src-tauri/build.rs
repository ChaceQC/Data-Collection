use tauri_build::{AppManifest, Attributes};

fn main() {
    let attributes = Attributes::new().app_manifest(AppManifest::new().commands(&[
        "load_file_index",
        "list_directory",
        "index_paths",
        "refresh_index",
        "get_index_recovery",
        "reset_index_recovery",
        "export_index_diagnostic",
        "reposition_file",
        "set_favorite",
        "remove_index_entry",
        "copy_indexed_file",
        "open_indexed_file",
        "reveal_indexed_file",
        "rename_indexed_file",
        "delete_original_file",
        "load_settings",
        "update_settings",
        "set_floating_window_visible",
        "show_main_window",
        "tray_status",
        "exit_app",
        "cancel_preview_task",
    ]));
    tauri_build::try_build(attributes).expect("failed to run Tauri build script");
}
