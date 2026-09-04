use std::path::Path;

use serde::{Deserialize, Serialize};
use thiserror::Error;

use super::app_data::{self, AppDataError, AppDataFile};

pub const FLOATING_PLACEMENT_FORMAT_VERSION: u32 = 1;
const MAX_MONITOR_KEY_LENGTH: usize = 256;
const MAX_COORDINATE_DIP: f64 = 100_000.0;

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloatingPlacement {
    pub mode: String,
    pub monitor_key: String,
    pub edge: Option<String>,
    pub offset_dip: Option<f64>,
    pub x_dip: Option<f64>,
    pub y_dip: Option<f64>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PlacementDocument {
    version: u32,
    placement: FloatingPlacement,
}

#[derive(Debug, Error)]
pub enum PlacementError {
    #[error("悬浮球位置文件不存在")]
    Missing,
    #[error("悬浮球位置文件无法读取")]
    Read,
    #[error("悬浮球位置文件无法写入")]
    Write,
    #[error("悬浮球位置文件格式损坏")]
    Corrupt,
    #[error("悬浮球位置文件版本不受支持")]
    UnsupportedVersion,
    #[error("悬浮球位置字段无效")]
    Invalid,
}

pub fn default_placement() -> FloatingPlacement {
    FloatingPlacement {
        mode: "edge".to_string(),
        monitor_key: "primary".to_string(),
        edge: Some("right".to_string()),
        offset_dip: Some(0.0),
        x_dip: None,
        y_dip: None,
    }
}

pub fn load_placement(path: &Path) -> Result<FloatingPlacement, PlacementError> {
    let Some(bytes) =
        app_data::read(path, AppDataFile::FloatingPlacement).map_err(map_app_data_error)?
    else {
        return Err(PlacementError::Missing);
    };
    let document =
        serde_json::from_slice::<PlacementDocument>(&bytes).map_err(|_| PlacementError::Corrupt)?;
    if document.version != FLOATING_PLACEMENT_FORMAT_VERSION {
        return Err(PlacementError::UnsupportedVersion);
    }
    validate_placement(&document.placement)?;
    Ok(document.placement)
}

pub fn save_placement(path: &Path, placement: &FloatingPlacement) -> Result<(), PlacementError> {
    validate_placement(placement)?;
    let document = PlacementDocument {
        version: FLOATING_PLACEMENT_FORMAT_VERSION,
        placement: placement.clone(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| PlacementError::Write)?;
    app_data::write(path, AppDataFile::FloatingPlacement, &encoded)
        .map_err(|_| PlacementError::Write)
}

fn map_app_data_error(error: AppDataError) -> PlacementError {
    match error {
        AppDataError::TooLarge | AppDataError::Unsafe => PlacementError::Corrupt,
        AppDataError::Read | AppDataError::Write | AppDataError::Directory => PlacementError::Read,
    }
}

pub fn validate_placement(placement: &FloatingPlacement) -> Result<(), PlacementError> {
    if placement.monitor_key.trim().is_empty()
        || placement.monitor_key.chars().count() > MAX_MONITOR_KEY_LENGTH
        || placement.monitor_key.chars().any(char::is_control)
    {
        return Err(PlacementError::Invalid);
    }

    match placement.mode.as_str() {
        "edge" => {
            if !matches!(
                placement.edge.as_deref(),
                Some("left" | "right" | "top" | "bottom")
            ) || placement.x_dip.is_some()
                || placement.y_dip.is_some()
            {
                return Err(PlacementError::Invalid);
            }
            validate_coordinate(placement.offset_dip)?;
        }
        "free" => {
            if placement.edge.is_some() || placement.offset_dip.is_some() {
                return Err(PlacementError::Invalid);
            }
            validate_coordinate(placement.x_dip)?;
            validate_coordinate(placement.y_dip)?;
        }
        _ => return Err(PlacementError::Invalid),
    }
    Ok(())
}

fn validate_coordinate(value: Option<f64>) -> Result<(), PlacementError> {
    let Some(value) = value else {
        return Err(PlacementError::Invalid);
    };
    if !value.is_finite() || !(0.0..=MAX_COORDINATE_DIP).contains(&value) {
        return Err(PlacementError::Invalid);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        default_placement, load_placement, save_placement, FloatingPlacement, PlacementError,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn round_trips_camel_case_placement_document() {
        let path = unique_temp_path();
        let placement = FloatingPlacement {
            mode: "edge".to_string(),
            monitor_key: "DISPLAY1".to_string(),
            edge: Some("right".to_string()),
            offset_dip: Some(360.0),
            x_dip: None,
            y_dip: None,
        };

        save_placement(&path, &placement).expect("placement should save");
        let loaded = load_placement(&path).expect("placement should load");
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("placement should exist"))
                .expect("placement should be JSON");

        assert_eq!(loaded, placement);
        assert_eq!(document["version"], 1);
        assert_eq!(document["placement"]["monitorKey"], "DISPLAY1");
        assert_eq!(document["placement"]["offsetDip"], 360.0);
        assert!(document["placement"].get("monitor_key").is_none());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn rejects_unknown_fields_and_invalid_coordinates() {
        let path = unique_temp_path();
        fs::write(
            &path,
            br#"{"version":1,"placement":{"mode":"edge","monitorKey":"DISPLAY1","edge":"right","offsetDip":-1,"xDip":null,"yDip":null,"extra":true}}"#,
        )
        .expect("invalid placement should be written");

        assert!(matches!(
            load_placement(&path),
            Err(PlacementError::Corrupt)
        ));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn missing_placement_uses_an_explicit_error_for_safe_fallback() {
        let path = unique_temp_path();
        assert!(matches!(
            load_placement(&path),
            Err(PlacementError::Missing)
        ));
        assert_eq!(default_placement().mode, "edge");
    }

    #[test]
    fn save_failure_does_not_create_a_path_outside_the_requested_parent() {
        let blocker = unique_temp_path();
        fs::write(&blocker, "not a directory").expect("blocker should be written");
        let path = blocker.join("floating-ball.json");

        assert!(matches!(
            save_placement(&path, &default_placement()),
            Err(PlacementError::Write)
        ));
        assert!(blocker.is_file());
        let _ = fs::remove_file(blocker);
    }

    fn unique_temp_path() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-floating-{timestamp}.json"))
    }
}
