use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::config::PREVIEW_LIMITS;

pub const SETTINGS_FORMAT_VERSION: u32 = 2;
const LEGACY_SETTINGS_FORMAT_VERSION: u32 = 1;
pub const DEFAULT_PAGE_SIZE: u32 = 20;
pub const PAGE_SIZE_OPTIONS: &[u32] = &[10, 20, 50];

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SortPreference {
    pub key: String,
    pub direction: String,
}

impl Default for SortPreference {
    fn default() -> Self {
        Self {
            key: "addedAt".to_string(),
            direction: "desc".to_string(),
        }
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub default_sort: SortPreference,
    pub page_size: u32,
    pub confirm_before_remove: bool,
    #[serde(default)]
    pub hide_to_tray: bool,
    #[serde(default = "default_show_floating_window")]
    pub show_floating_window: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewLimitView {
    pub label: String,
    pub max_bytes: u64,
    pub max_pixels: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub default_sort: SortPreference,
    pub page_size: u32,
    pub confirm_before_remove: bool,
    pub hide_to_tray: bool,
    pub show_floating_window: bool,
    pub preview_limits: Vec<PreviewLimitView>,
}

#[derive(Debug, Error)]
pub enum SettingsError {
    #[error("应用数据目录不可用")]
    DataDirectory,
    #[error("设置文件无法读取")]
    Read,
    #[error("设置文件无法写入")]
    Write,
    #[error("设置状态不可用")]
    State,
    #[error("设置文件格式损坏")]
    Corrupt,
    #[error("设置文件版本不受支持")]
    UnsupportedVersion,
    #[error("设置值不受支持")]
    InvalidValue,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct SettingsDocument {
    version: u32,
    settings: PersistedSettings,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedSettings {
    #[serde(default)]
    default_sort: SortPreference,
    #[serde(default = "default_page_size")]
    page_size: u32,
    #[serde(default = "default_confirm_before_remove")]
    confirm_before_remove: bool,
    #[serde(default)]
    hide_to_tray: bool,
    #[serde(default = "default_show_floating_window")]
    show_floating_window: bool,
}

impl Default for PersistedSettings {
    fn default() -> Self {
        Self {
            default_sort: SortPreference::default(),
            page_size: DEFAULT_PAGE_SIZE,
            confirm_before_remove: true,
            hide_to_tray: false,
            show_floating_window: true,
        }
    }
}

#[derive(Debug, Default)]
pub struct SettingsState {
    settings_path: Mutex<Option<PathBuf>>,
    settings: Mutex<PersistedSettings>,
    mutation_lock: Mutex<()>,
}

impl SettingsState {
    pub fn initialize(&self, settings_path: PathBuf) -> Result<(), SettingsError> {
        let parent = settings_path.parent().ok_or(SettingsError::DataDirectory)?;
        fs::create_dir_all(parent).map_err(|_| SettingsError::DataDirectory)?;

        let settings = if settings_path.exists() {
            match read_settings(&settings_path) {
                Ok(read_result) => {
                    if read_result.needs_migration {
                        // 迁移失败时保留旧文件和内存快照，避免启动失败或半写文档。
                        let _ = save_settings(&settings_path, &read_result.settings);
                    }
                    read_result.settings
                }
                Err(
                    SettingsError::Corrupt
                    | SettingsError::UnsupportedVersion
                    | SettingsError::InvalidValue,
                ) => PersistedSettings::default(),
                Err(error) => return Err(error),
            }
        } else {
            let settings = PersistedSettings::default();
            save_settings(&settings_path, &settings)?;
            settings
        };

        *self
            .settings_path
            .lock()
            .map_err(|_| SettingsError::State)? = Some(settings_path);
        *self.settings.lock().map_err(|_| SettingsError::State)? = settings;
        Ok(())
    }

    pub fn snapshot(&self) -> Result<AppSettings, SettingsError> {
        self.settings
            .lock()
            .map_err(|_| SettingsError::State)
            .map(|settings| AppSettings::from_persisted(&settings))
    }

    pub fn update(&self, update: SettingsUpdate) -> Result<AppSettings, SettingsError> {
        let next = validate_update(update)?;
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| SettingsError::State)?;
        let settings_path = self
            .settings_path
            .lock()
            .map_err(|_| SettingsError::State)?
            .clone()
            .ok_or(SettingsError::DataDirectory)?;

        save_settings(&settings_path, &next)?;
        *self.settings.lock().map_err(|_| SettingsError::State)? = next.clone();
        Ok(AppSettings::from_persisted(&next))
    }
}

impl AppSettings {
    fn from_persisted(settings: &PersistedSettings) -> Self {
        Self {
            default_sort: settings.default_sort.clone(),
            page_size: settings.page_size,
            confirm_before_remove: settings.confirm_before_remove,
            hide_to_tray: settings.hide_to_tray,
            show_floating_window: settings.show_floating_window,
            preview_limits: PREVIEW_LIMITS
                .iter()
                .map(|limit| PreviewLimitView {
                    label: limit.label.to_string(),
                    max_bytes: limit.max_bytes,
                    max_pixels: limit.max_pixels,
                })
                .collect(),
        }
    }
}

struct ReadSettings {
    settings: PersistedSettings,
    needs_migration: bool,
}

fn read_settings(path: &Path) -> Result<ReadSettings, SettingsError> {
    let bytes = fs::read(path).map_err(|_| SettingsError::Read)?;
    let document =
        serde_json::from_slice::<SettingsDocument>(&bytes).map_err(|_| SettingsError::Corrupt)?;
    let needs_migration = document.version == LEGACY_SETTINGS_FORMAT_VERSION;
    if document.version != SETTINGS_FORMAT_VERSION && !needs_migration {
        return Err(SettingsError::UnsupportedVersion);
    }
    let settings = validate_update(SettingsUpdate {
        default_sort: document.settings.default_sort,
        page_size: document.settings.page_size,
        confirm_before_remove: document.settings.confirm_before_remove,
        hide_to_tray: document.settings.hide_to_tray,
        show_floating_window: document.settings.show_floating_window,
    })?;
    Ok(ReadSettings {
        settings,
        needs_migration,
    })
}

fn save_settings(path: &Path, settings: &PersistedSettings) -> Result<(), SettingsError> {
    let document = SettingsDocument {
        version: SETTINGS_FORMAT_VERSION,
        settings: settings.clone(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| SettingsError::Write)?;
    let mut file = AtomicWriteFile::open(path).map_err(|_| SettingsError::Write)?;
    file.as_file_mut()
        .write_all(&encoded)
        .map_err(|_| SettingsError::Write)?;
    file.commit().map_err(|_| SettingsError::Write)
}

fn validate_update(update: SettingsUpdate) -> Result<PersistedSettings, SettingsError> {
    let valid_key = matches!(
        update.default_sort.key.as_str(),
        "addedAt" | "modifiedAt" | "name" | "size"
    );
    let valid_direction = matches!(update.default_sort.direction.as_str(), "asc" | "desc");
    if !valid_key || !valid_direction || !PAGE_SIZE_OPTIONS.contains(&update.page_size) {
        return Err(SettingsError::InvalidValue);
    }
    Ok(PersistedSettings {
        default_sort: update.default_sort,
        page_size: update.page_size,
        confirm_before_remove: update.confirm_before_remove,
        hide_to_tray: update.hide_to_tray,
        show_floating_window: update.show_floating_window,
    })
}

fn default_page_size() -> u32 {
    DEFAULT_PAGE_SIZE
}

fn default_confirm_before_remove() -> bool {
    true
}

fn default_show_floating_window() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{
        SettingsState, SettingsUpdate, SortPreference, DEFAULT_PAGE_SIZE, SETTINGS_FORMAT_VERSION,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn persists_safe_defaults_and_read_only_preview_limits() {
        let path = unique_path("settings.json");
        let state = SettingsState::default();
        state
            .initialize(path.clone())
            .expect("settings should initialize");

        let settings = state.snapshot().expect("settings should be readable");
        assert_eq!(settings.page_size, DEFAULT_PAGE_SIZE);
        assert!(settings.confirm_before_remove);
        assert!(!settings.hide_to_tray);
        assert!(settings.show_floating_window);
        assert!(!settings.preview_limits.is_empty());
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("settings file should exist"))
                .expect("settings file should be JSON");
        assert_eq!(document["version"], SETTINGS_FORMAT_VERSION);
        assert!(document["settings"].get("previewLimits").is_none());
        cleanup(path);
    }

    #[test]
    fn falls_back_from_corrupt_settings_without_overwriting_the_file() {
        let path = unique_path("settings-corrupt.json");
        fs::write(&path, b"not-json").expect("corrupt settings should be written");
        let state = SettingsState::default();

        state
            .initialize(path.clone())
            .expect("settings should recover");
        assert_eq!(
            state.snapshot().expect("settings should read").page_size,
            DEFAULT_PAGE_SIZE
        );
        assert_eq!(
            fs::read(&path).expect("settings should remain"),
            b"not-json"
        );
        cleanup(path);
    }

    #[test]
    fn accepts_supported_values_and_persists_them_atomically() {
        let path = unique_path("settings-update.json");
        let state = SettingsState::default();
        state
            .initialize(path.clone())
            .expect("settings should initialize");
        let updated = state
            .update(SettingsUpdate {
                default_sort: SortPreference {
                    key: "name".to_string(),
                    direction: "asc".to_string(),
                },
                page_size: 50,
                confirm_before_remove: false,
                hide_to_tray: true,
                show_floating_window: false,
            })
            .expect("settings update should succeed");

        assert_eq!(updated.default_sort.key, "name");
        assert_eq!(updated.page_size, 50);
        assert!(!updated.confirm_before_remove);
        assert!(updated.hide_to_tray);
        assert!(!updated.show_floating_window);
        let reloaded = SettingsState::default();
        reloaded
            .initialize(path.clone())
            .expect("updated settings should reload");
        assert_eq!(reloaded.snapshot().expect("settings should read"), updated);
        cleanup(path);
    }

    #[test]
    fn rejects_unsupported_values_without_changing_the_snapshot() {
        let path = unique_path("settings-invalid.json");
        let state = SettingsState::default();
        state
            .initialize(path.clone())
            .expect("settings should initialize");
        let before = state.snapshot().expect("settings should read");
        let result = state.update(SettingsUpdate {
            default_sort: SortPreference {
                key: "random".to_string(),
                direction: "desc".to_string(),
            },
            page_size: 999,
            confirm_before_remove: false,
            hide_to_tray: false,
            show_floating_window: true,
        });

        assert!(result.is_err());
        assert_eq!(state.snapshot().expect("settings should read"), before);
        cleanup(path);
    }

    #[test]
    fn migrates_v1_settings_without_losing_existing_preferences() {
        let path = unique_path("settings-v1.json");
        let legacy = serde_json::json!({
            "version": 1,
            "settings": {
                "defaultSort": { "key": "name", "direction": "asc" },
                "pageSize": 50,
                "confirmBeforeRemove": false
            }
        });
        fs::write(
            &path,
            serde_json::to_vec(&legacy).expect("legacy settings should serialize"),
        )
        .expect("legacy settings should be written");

        let state = SettingsState::default();
        state
            .initialize(path.clone())
            .expect("settings should migrate");
        let settings = state.snapshot().expect("settings should be readable");
        assert_eq!(settings.default_sort.key, "name");
        assert_eq!(settings.page_size, 50);
        assert!(!settings.confirm_before_remove);
        assert!(!settings.hide_to_tray);
        assert!(settings.show_floating_window);

        let migrated: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("migrated settings should exist"))
                .expect("migrated settings should be JSON");
        assert_eq!(migrated["version"], SETTINGS_FORMAT_VERSION);
        assert_eq!(migrated["settings"]["hideToTray"], false);
        assert_eq!(migrated["settings"]["showFloatingWindow"], true);
        cleanup(path);
    }

    #[test]
    fn rejects_non_boolean_v2_flags_without_overwriting_the_file() {
        let path = unique_path("settings-invalid-boolean.json");
        let invalid = br#"{"version":2,"settings":{"hideToTray":"yes","showFloatingWindow":true}}"#;
        fs::write(&path, invalid).expect("invalid settings should be written");

        let state = SettingsState::default();
        state
            .initialize(path.clone())
            .expect("settings should recover");
        assert!(!state.snapshot().expect("settings should read").hide_to_tray);
        assert_eq!(fs::read(&path).expect("settings should remain"), invalid);
        cleanup(path);
    }

    fn unique_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-{timestamp}-{name}"))
    }

    fn cleanup(path: PathBuf) {
        let _ = fs::remove_file(path);
    }
}
