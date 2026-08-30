#[cfg(not(test))]
use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    },
    thread,
    time::{Duration, Instant},
};

#[cfg(not(test))]
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindow};

use crate::storage::floating_ball::{self, FloatingPlacement};

pub const BALL_SIZE_DIP: f64 = 64.0;
#[cfg(not(test))]
pub const ENTER_NEAR_DIP: f64 = 28.0;
#[cfg(not(test))]
pub const LEAVE_NEAR_DIP: f64 = 16.0;
#[cfg(not(test))]
pub const PROXIMITY_POLL_INTERVAL_MS: u64 = 80;

#[derive(Clone, Debug, PartialEq)]
pub struct WorkArea {
    pub key: String,
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
    pub scale_factor: f64,
    pub primary: bool,
}

#[cfg(not(test))]
pub fn available_work_areas<R: Runtime>(app: &AppHandle<R>) -> Vec<WorkArea> {
    let monitors = app.available_monitors().unwrap_or_default();
    let primary_monitor = app
        .get_webview_window("main")
        .and_then(|window| window.current_monitor().ok().flatten())
        .or_else(|| app.primary_monitor().ok().flatten());
    let primary_key = primary_monitor
        .as_ref()
        .and_then(|monitor| monitor.name().cloned());
    let primary_position = primary_monitor
        .as_ref()
        .map(|monitor| (monitor.position().x, monitor.position().y));
    let primary_key = primary_key.or_else(|| {
        app.primary_monitor()
            .ok()
            .flatten()
            .and_then(|monitor| monitor.name().cloned())
    });
    let mut areas = monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let key = monitor
                .name()
                .cloned()
                .unwrap_or_else(|| format!("display-{index}"));
            let work_area = monitor.work_area();
            WorkArea {
                primary: primary_key.as_deref() == Some(key.as_str())
                    || primary_position == Some((monitor.position().x, monitor.position().y)),
                key,
                x: work_area.position.x,
                y: work_area.position.y,
                width: work_area.size.width,
                height: work_area.size.height,
                scale_factor: valid_scale_factor(monitor.scale_factor()),
            }
        })
        .collect::<Vec<_>>();
    areas.sort_by_key(|area| (!area.primary, area.key.clone()));
    if areas.is_empty() {
        areas.push(WorkArea {
            key: "primary".to_string(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
            scale_factor: 1.0,
            primary: true,
        });
    }
    areas
}

pub fn safe_default(areas: &[WorkArea]) -> FloatingPlacement {
    let area = areas.first().cloned().unwrap_or_else(fallback_work_area);
    let mut placement = floating_ball::default_placement();
    placement.monitor_key = area.key;
    placement.offset_dip =
        Some(((area.height as f64 / area.scale_factor) - BALL_SIZE_DIP).max(0.0) / 2.0);
    placement
}

pub fn normalize_placement(placement: FloatingPlacement, areas: &[WorkArea]) -> FloatingPlacement {
    let placement = if floating_ball::validate_placement(&placement).is_ok() {
        placement
    } else {
        safe_default(areas)
    };
    let area = select_area(&placement.monitor_key, areas);
    let width_dip = area.width as f64 / area.scale_factor;
    let height_dip = area.height as f64 / area.scale_factor;
    let max_x = (width_dip - BALL_SIZE_DIP).max(0.0);
    let max_y = (height_dip - BALL_SIZE_DIP).max(0.0);
    match placement.mode.as_str() {
        "edge" => {
            let edge = placement
                .edge
                .clone()
                .unwrap_or_else(|| "right".to_string());
            let offset_limit = if matches!(edge.as_str(), "left" | "right") {
                max_y
            } else {
                max_x
            };
            FloatingPlacement {
                mode: "edge".to_string(),
                monitor_key: area.key.clone(),
                edge: Some(edge),
                offset_dip: Some(clamp(
                    placement.offset_dip.unwrap_or(offset_limit / 2.0),
                    0.0,
                    offset_limit,
                )),
                x_dip: None,
                y_dip: None,
            }
        }
        "free" => FloatingPlacement {
            mode: "free".to_string(),
            monitor_key: area.key.clone(),
            edge: None,
            offset_dip: None,
            x_dip: Some(clamp(placement.x_dip.unwrap_or(max_x / 2.0), 0.0, max_x)),
            y_dip: Some(clamp(placement.y_dip.unwrap_or(max_y / 2.0), 0.0, max_y)),
        },
        _ => unreachable!("invalid placement is replaced above"),
    }
}

pub fn window_position_physical(placement: &FloatingPlacement, areas: &[WorkArea]) -> (i32, i32) {
    let normalized = normalize_placement(placement.clone(), areas);
    let area = select_area(&normalized.monitor_key, areas);
    let ball_width = (BALL_SIZE_DIP * area.scale_factor).round() as i32;
    let ball_height = (BALL_SIZE_DIP * area.scale_factor).round() as i32;
    let max_x = (area.width as i32 - ball_width).max(0);
    let max_y = (area.height as i32 - ball_height).max(0);
    let offset = (normalized.offset_dip.unwrap_or(0.0) * area.scale_factor).round() as i32;
    match normalized.mode.as_str() {
        "edge" => match normalized.edge.as_deref() {
            Some("left") => (area.x, area.y + offset.clamp(0, max_y)),
            Some("top") => (area.x + offset.clamp(0, max_x), area.y),
            Some("bottom") => (area.x + offset.clamp(0, max_x), area.y + max_y),
            _ => (area.x + max_x, area.y + offset.clamp(0, max_y)),
        },
        "free" => {
            let x = (normalized.x_dip.unwrap_or(0.0) * area.scale_factor).round() as i32;
            let y = (normalized.y_dip.unwrap_or(0.0) * area.scale_factor).round() as i32;
            (area.x + x.clamp(0, max_x), area.y + y.clamp(0, max_y))
        }
        _ => unreachable!("invalid placement is replaced above"),
    }
}

#[cfg(not(test))]
pub fn start_proximity_monitor<R: Runtime>(app: AppHandle<R>, stop: Arc<AtomicBool>) {
    thread::spawn(move || {
        let mut was_near = false;
        let mut last_emitted_at = Instant::now();
        while !stop.load(Ordering::Acquire) {
            let Some(window) = app.get_webview_window("floating-ball") else {
                break;
            };
            if let Ok(is_near) = cursor_is_near(&app, &window, was_near) {
                if is_near != was_near || last_emitted_at.elapsed() >= Duration::from_millis(400) {
                    let _ = app.emit_to("floating-ball", "floating-near", is_near);
                    last_emitted_at = Instant::now();
                }
                was_near = is_near;
            }
            thread::sleep(Duration::from_millis(PROXIMITY_POLL_INTERVAL_MS));
        }
    });
}

#[cfg(not(test))]
fn cursor_is_near<R: Runtime>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    was_near: bool,
) -> Result<bool, ()> {
    let cursor = app.cursor_position().map_err(|_| ())?;
    let position = window.outer_position().map_err(|_| ())?;
    let size = window.outer_size().map_err(|_| ())?;
    let scale_factor = valid_scale_factor(window.scale_factor().map_err(|_| ())?);
    let left = position.x as f64;
    let top = position.y as f64;
    let right = left + size.width as f64;
    let bottom = top + size.height as f64;
    let distance_x = (left - cursor.x).max(0.0).max(cursor.x - right);
    let distance_y = (top - cursor.y).max(0.0).max(cursor.y - bottom);
    let distance = (distance_x.powi(2) + distance_y.powi(2)).sqrt();
    let enter_threshold = ENTER_NEAR_DIP * scale_factor;
    if !was_near {
        return Ok(distance <= enter_threshold);
    }
    let leave_threshold = LEAVE_NEAR_DIP * scale_factor;
    let within_leave_threshold = distance <= leave_threshold;
    let within_hysteresis_band = distance > leave_threshold && distance <= enter_threshold;
    Ok(within_leave_threshold || within_hysteresis_band)
}

fn select_area<'a>(monitor_key: &str, areas: &'a [WorkArea]) -> &'a WorkArea {
    areas
        .iter()
        .find(|area| area.key == monitor_key)
        .or_else(|| areas.iter().find(|area| area.primary))
        .or_else(|| areas.first())
        .expect("available_work_areas always returns a fallback")
}

fn fallback_work_area() -> WorkArea {
    WorkArea {
        key: "primary".to_string(),
        x: 0,
        y: 0,
        width: 1920,
        height: 1080,
        scale_factor: 1.0,
        primary: true,
    }
}

#[cfg(not(test))]
fn valid_scale_factor(value: f64) -> f64 {
    if value.is_finite() && value > 0.0 {
        value
    } else {
        1.0
    }
}

fn clamp(value: f64, minimum: f64, maximum: f64) -> f64 {
    value.max(minimum).min(maximum)
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_placement, safe_default, window_position_physical, WorkArea, BALL_SIZE_DIP,
    };
    use crate::storage::floating_ball::FloatingPlacement;

    fn areas() -> Vec<WorkArea> {
        vec![WorkArea {
            key: "DISPLAY1".to_string(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1040,
            scale_factor: 1.5,
            primary: true,
        }]
    }

    #[test]
    fn safe_default_is_centered_on_the_right_work_area_edge() {
        let area = areas();
        let placement = safe_default(&area);
        let (x, y) = window_position_physical(&placement, &area);
        assert_eq!(x, 1920 - (BALL_SIZE_DIP * 1.5) as i32);
        assert_eq!(y, (1040 - (BALL_SIZE_DIP * 1.5) as i32) / 2);
    }

    #[test]
    fn clamps_free_positions_and_falls_back_from_unknown_monitors() {
        let placement = FloatingPlacement {
            mode: "free".to_string(),
            monitor_key: "missing".to_string(),
            edge: None,
            offset_dip: None,
            x_dip: Some(99_999.0),
            y_dip: Some(99_999.0),
        };
        let normalized = normalize_placement(placement, &areas());
        assert_eq!(normalized.monitor_key, "DISPLAY1");
        assert_eq!(normalized.x_dip, Some((1920.0 / 1.5) - BALL_SIZE_DIP));
        assert_eq!(normalized.y_dip, Some((1040.0 / 1.5) - BALL_SIZE_DIP));
    }

    #[test]
    fn uses_the_edge_offset_axis_for_each_edge() {
        let placement = FloatingPlacement {
            mode: "edge".to_string(),
            monitor_key: "DISPLAY1".to_string(),
            edge: Some("top".to_string()),
            offset_dip: Some(200.0),
            x_dip: None,
            y_dip: None,
        };
        assert_eq!(window_position_physical(&placement, &areas()), (300, 0));
    }
}
