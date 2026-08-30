use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::{
    filesystem,
    storage::{self, floating_ball::FloatingPlacement, AppState, StorageError},
    windows::{self, FloatingBallState},
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingRecordResult {
    pub recent: Vec<storage::FloatingRecentEntry>,
    pub indexed_count: usize,
    pub refreshed_count: usize,
    pub recorded_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatingRecordedEvent {
    ids: Vec<String>,
    indexed_count: usize,
    refreshed_count: usize,
    recorded_count: usize,
    skipped_count: usize,
    skipped_reasons: Vec<String>,
    truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct FloatingOpenEvent {
    file_id: String,
}

#[tauri::command]
pub async fn record_floating_paths(
    paths: Vec<String>,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<FloatingRecordResult, String> {
    if paths.is_empty() {
        return Err("请拖入文件或文件夹".to_string());
    }

    let scan = tauri::async_runtime::spawn_blocking(move || filesystem::scan_paths(&paths))
        .await
        .map_err(|_| "悬浮球记录任务未完成，请重试".to_string())?;
    let skipped_count = scan.skipped_count;
    let skipped_reasons = scan.skipped_reasons.clone();
    let scan_truncated = scan.truncated;
    let mut merge_stats = storage::MergeStats::default();
    let entries = state
        .update_entries(|entries| {
            merge_stats = storage::merge_index_entries(
                entries,
                scan.entries,
                storage::IndexMergeMode::FloatingRecord {
                    base_recorded_at: storage::current_timestamp_millis(),
                },
            );
            Ok(merge_stats.accepted_count > 0)
        })
        .map_err(|error| match error {
            StorageError::Write => "资料记录保存失败，原有索引未改变".to_string(),
            other => other.to_string(),
        })?;
    let truncated = scan_truncated || merge_stats.truncated;
    let result = FloatingRecordResult {
        recent: storage::floating_recent(&entries),
        indexed_count: merge_stats.added_count,
        refreshed_count: merge_stats.refreshed_count,
        recorded_count: merge_stats.recorded_count,
        skipped_count,
        skipped_reasons: skipped_reasons.clone(),
        truncated,
    };
    let _ = app.emit_to(
        "main",
        "floating-recorded",
        FloatingRecordedEvent {
            ids: merge_stats.affected_ids,
            indexed_count: result.indexed_count,
            refreshed_count: result.refreshed_count,
            recorded_count: result.recorded_count,
            skipped_count: result.skipped_count,
            skipped_reasons: result.skipped_reasons.clone(),
            truncated: result.truncated,
        },
    );
    Ok(result)
}

#[tauri::command]
pub fn get_floating_recent(
    state: State<'_, AppState>,
) -> Result<Vec<storage::FloatingRecentEntry>, String> {
    let entries = state
        .update_entries(|entries| {
            let mut changed = false;
            for entry in entries.iter_mut() {
                changed |= filesystem::refresh_entry(entry);
            }
            Ok(changed)
        })
        .map_err(|error| error.to_string())?;
    Ok(storage::floating_recent(&entries))
}

#[tauri::command]
pub fn open_main_from_floating(
    file_id: String,
    state: State<'_, AppState>,
    app: AppHandle,
) -> Result<(), String> {
    if file_id.trim().is_empty() {
        return Err("资料 ID 不能为空".to_string());
    }
    let exists = state
        .snapshot()
        .map_err(|error| error.to_string())?
        .iter()
        .any(|entry| entry.id == file_id);
    if !exists {
        return Err("找不到需要打开的资料".to_string());
    }
    let main = app
        .get_webview_window("main")
        .ok_or_else(|| "主窗口不可用，请重试".to_string())?;
    main.show()
        .map_err(|_| "主窗口无法显示，请重试".to_string())?;
    main.set_focus()
        .map_err(|_| "主窗口无法获得焦点，请重试".to_string())?;
    app.emit_to("main", "floating-open-file", FloatingOpenEvent { file_id })
        .map_err(|_| "主窗口无法接收悬浮球操作，请重试".to_string())
}

#[tauri::command]
pub fn load_floating_placement(app: AppHandle) -> Result<FloatingPlacement, String> {
    let areas = windows::monitor::available_work_areas(&app);
    let path = placement_path(&app)?;
    let placement = storage::floating_ball::load_placement(&path)
        .map(|placement| windows::monitor::normalize_placement(placement, &areas))
        .unwrap_or_else(|_| windows::monitor::safe_default(&areas));
    Ok(placement)
}

#[tauri::command]
pub fn save_floating_placement(
    placement: FloatingPlacement,
    app: AppHandle,
) -> Result<FloatingPlacement, String> {
    crate::storage::floating_ball::validate_placement(&placement)
        .map_err(|_| "悬浮球位置字段无效".to_string())?;
    let areas = windows::monitor::available_work_areas(&app);
    let normalized = windows::monitor::normalize_placement(placement, &areas);
    let path = placement_path(&app)?;
    storage::floating_ball::save_placement(&path, &normalized)
        .map_err(|_| "悬浮球位置无法保存，下次启动可能使用安全默认位置".to_string())?;
    Ok(normalized)
}

#[tauri::command]
pub fn floating_window_status(
    state: State<'_, FloatingBallState>,
    app: AppHandle,
) -> windows::FloatingWindowStatus {
    state.status(&app)
}

#[tauri::command]
pub async fn retry_floating_ball(
    state: State<'_, FloatingBallState>,
    app: AppHandle,
) -> Result<windows::FloatingWindowStatus, String> {
    if !state.desired_visible() {
        return Ok(state.status(&app));
    }
    if app
        .get_webview_window(windows::FLOATING_BALL_LABEL)
        .is_some()
    {
        return Ok(state.status(&app));
    }
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|_| "应用数据目录不可用".to_string())?;
    match windows::create_floating_ball(&app, &state, &data_dir.join("floating-ball.json")) {
        Ok(()) => Ok(state.status(&app)),
        Err(error) => {
            state.set_creation_error(Some(error.clone()));
            Err(error)
        }
    }
}

fn placement_path<R: tauri::Runtime>(app: &AppHandle<R>) -> Result<std::path::PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("floating-ball.json"))
        .map_err(|_| "应用数据目录不可用".to_string())
}
