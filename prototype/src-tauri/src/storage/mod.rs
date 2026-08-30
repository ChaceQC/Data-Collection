use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::filesystem::IndexEntry;

pub(crate) mod floating_ball;
pub(crate) mod settings;

pub const INDEX_FORMAT_VERSION: u32 = 3;
const LEGACY_INDEX_FORMAT_VERSION: u32 = 1;
const PREVIOUS_INDEX_FORMAT_VERSION: u32 = 2;
pub const FLOATING_RECENT_LIMIT: usize = 5;

#[derive(Debug, Error)]
pub enum StorageError {
    #[error("应用数据目录不可用")]
    DataDirectory,
    #[error("索引文件无法读取")]
    Read,
    #[error("索引文件无法写入")]
    Write,
    #[error("索引状态不可用")]
    State,
    #[error("资料 ID 不能为空")]
    InvalidId,
    #[error("找不到需要操作的资料")]
    EntryNotFound,
    #[error("目标路径已经在资料库中")]
    DuplicateEntry,
    #[error("索引文件格式损坏")]
    Corrupt,
    #[error("索引文件版本不受支持")]
    UnsupportedVersion,
}

#[derive(Debug, Default)]
pub struct AppState {
    index_path: Mutex<Option<PathBuf>>,
    entries: Mutex<Vec<IndexEntry>>,
    mutation_lock: Mutex<()>,
}

#[derive(Debug, Deserialize, Serialize)]
struct IndexDocument {
    version: u32,
    entries: Vec<IndexEntry>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum IndexMergeMode {
    RegularImport,
    FloatingRecord { base_recorded_at: i64 },
}

#[derive(Debug, Default)]
pub struct MergeStats {
    pub added_ids: Vec<String>,
    pub affected_ids: Vec<String>,
    pub added_count: usize,
    pub refreshed_count: usize,
    pub recorded_count: usize,
    pub accepted_count: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingRecentEntry {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub kind: String,
    pub status: String,
    pub invalid: bool,
    pub favorite: bool,
    pub recorded_at: i64,
}

impl AppState {
    pub fn initialize(&self, index_path: PathBuf) -> Result<(), StorageError> {
        let parent = index_path.parent().ok_or(StorageError::DataDirectory)?;
        fs::create_dir_all(parent).map_err(|_| StorageError::DataDirectory)?;
        let entries = load_entries(&index_path)?;
        *self.index_path.lock().map_err(|_| StorageError::State)? = Some(index_path);
        *self.entries.lock().map_err(|_| StorageError::State)? = entries;
        Ok(())
    }

    pub fn index_path(&self) -> Result<PathBuf, StorageError> {
        self.index_path
            .lock()
            .map_err(|_| StorageError::State)?
            .clone()
            .ok_or(StorageError::DataDirectory)
    }

    pub fn snapshot(&self) -> Result<Vec<IndexEntry>, StorageError> {
        self.entries
            .lock()
            .map_err(|_| StorageError::State)
            .map(|entries| entries.clone())
    }

    pub fn replace_entries(&self, entries: Vec<IndexEntry>) -> Result<(), StorageError> {
        *self.entries.lock().map_err(|_| StorageError::State)? = entries;
        Ok(())
    }

    pub fn update_entries<F>(&self, mutation: F) -> Result<Vec<IndexEntry>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>) -> Result<bool, StorageError>,
    {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        let mut next = self.snapshot()?;
        let changed = mutation(&mut next)?;
        if changed {
            save_entries(&index_path, &next)?;
            self.replace_entries(next.clone())?;
            return Ok(next);
        }
        self.snapshot()
    }
}

pub fn load_entries(path: &Path) -> Result<Vec<IndexEntry>, StorageError> {
    if !path.exists() {
        return Ok(Vec::new());
    }
    let bytes = fs::read(path).map_err(|_| StorageError::Read)?;
    let document =
        serde_json::from_slice::<IndexDocument>(&bytes).map_err(|_| StorageError::Corrupt)?;
    let mut entries = document.entries;
    let needs_save = match document.version {
        INDEX_FORMAT_VERSION => normalize_entries(&mut entries),
        LEGACY_INDEX_FORMAT_VERSION | PREVIOUS_INDEX_FORMAT_VERSION => {
            normalize_entries(&mut entries);
            for entry in &mut entries {
                entry.last_recorded_at = None;
            }
            true
        }
        _ => return Err(StorageError::UnsupportedVersion),
    };
    if needs_save {
        save_entries(path, &entries)?;
    }
    Ok(entries)
}

pub fn save_entries(path: &Path, entries: &[IndexEntry]) -> Result<(), StorageError> {
    let document = IndexDocument {
        version: INDEX_FORMAT_VERSION,
        entries: entries.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| StorageError::Write)?;
    let mut file = AtomicWriteFile::open(path).map_err(|_| StorageError::Write)?;
    std::io::Write::write_all(file.as_file_mut(), &encoded).map_err(|_| StorageError::Write)?;
    file.commit().map_err(|_| StorageError::Write)
}

pub fn sort_entries(entries: &mut [IndexEntry]) {
    entries.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
}

pub fn merge_index_entries(
    entries: &mut Vec<IndexEntry>,
    incoming: impl IntoIterator<Item = IndexEntry>,
    mode: IndexMergeMode,
) -> MergeStats {
    let mut stats = MergeStats::default();
    for (input_index, mut incoming) in incoming.into_iter().enumerate() {
        let existing = entries
            .iter_mut()
            .find(|entry| crate::filesystem::same_path(&entry.path, &incoming.path));
        if let Some(existing) = existing {
            let id = existing.id.clone();
            let favorite = existing.favorite;
            let preview_status = existing.preview_status.clone();
            let added_at = existing.added_at;
            let last_recorded_at = existing.last_recorded_at;
            *existing = incoming;
            existing.id = id;
            existing.favorite = favorite;
            existing.preview_status = preview_status;
            existing.added_at = added_at;
            existing.last_recorded_at = match mode {
                IndexMergeMode::RegularImport => last_recorded_at,
                IndexMergeMode::FloatingRecord { base_recorded_at } => {
                    stats.recorded_count += 1;
                    Some(recorded_timestamp(base_recorded_at, input_index))
                }
            };
            stats.refreshed_count += 1;
            stats.accepted_count += 1;
            stats.affected_ids.push(existing.id.clone());
            continue;
        }

        if entries.len() >= crate::filesystem::MAX_INDEX_ENTRIES {
            stats.truncated = true;
            continue;
        }

        if let IndexMergeMode::FloatingRecord { base_recorded_at } = mode {
            incoming.last_recorded_at = Some(recorded_timestamp(base_recorded_at, input_index));
            stats.recorded_count += 1;
        }
        stats.added_ids.push(incoming.id.clone());
        stats.affected_ids.push(incoming.id.clone());
        stats.added_count += 1;
        stats.accepted_count += 1;
        entries.push(incoming);
    }
    sort_entries(entries);
    stats
}

pub fn floating_recent(entries: &[IndexEntry]) -> Vec<FloatingRecentEntry> {
    let mut recent = entries
        .iter()
        .filter_map(|entry| {
            let recorded_at = entry.last_recorded_at.filter(|value| *value > 0)?;
            Some(FloatingRecentEntry {
                id: entry.id.clone(),
                name: entry.name.clone(),
                file_type: entry.file_type.clone(),
                kind: entry.kind.clone(),
                status: entry.status.clone(),
                invalid: entry.invalid,
                favorite: entry.favorite,
                recorded_at,
            })
        })
        .collect::<Vec<_>>();
    recent.sort_by(|left, right| {
        right
            .recorded_at
            .cmp(&left.recorded_at)
            .then_with(|| left.id.cmp(&right.id))
    });
    recent.truncate(FLOATING_RECENT_LIMIT);
    recent
}

pub fn set_favorite(
    entries: &mut [IndexEntry],
    file_id: &str,
    favorite: bool,
) -> Result<bool, StorageError> {
    if file_id.trim().is_empty() {
        return Err(StorageError::InvalidId);
    }
    let entry = entries
        .iter_mut()
        .find(|entry| entry.id == file_id)
        .ok_or(StorageError::EntryNotFound)?;
    if entry.favorite == favorite {
        return Ok(false);
    }
    entry.favorite = favorite;
    Ok(true)
}

pub fn current_timestamp_millis() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .and_then(|duration| i64::try_from(duration.as_millis()).ok())
        .unwrap_or(1)
}

fn recorded_timestamp(base_recorded_at: i64, input_index: usize) -> i64 {
    base_recorded_at
        .max(1)
        .saturating_add(input_index.min(i64::MAX as usize) as i64)
}

fn normalize_entries(entries: &mut [IndexEntry]) -> bool {
    let mut changed = normalize_added_at(entries);
    for entry in entries {
        if entry.last_recorded_at.is_some_and(|value| value <= 0) {
            entry.last_recorded_at = None;
            changed = true;
        }
    }
    changed
}

fn normalize_added_at(entries: &mut [IndexEntry]) -> bool {
    let mut changed = false;
    for entry in entries {
        let fallback = entry.modified_at.max(0);
        if entry.added_at <= 0 && entry.added_at != fallback {
            entry.added_at = fallback;
            changed = true;
        }
    }
    changed
}

#[cfg(test)]
mod tests {
    use super::{
        floating_recent, load_entries, merge_index_entries, save_entries, sort_entries, AppState,
        IndexMergeMode, StorageError,
    };
    use crate::filesystem::IndexEntry;
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn writes_versioned_index_and_reads_it_back() {
        let path = unique_temp_path();
        let entry = sample_entry("资料.md", 20);
        assert!(save_entries(&path, std::slice::from_ref(&entry)).is_ok());
        let loaded = load_entries(&path).expect("index should load");
        assert_eq!(loaded, vec![entry]);
        assert!(fs::remove_file(path).is_ok());
    }

    #[test]
    fn sorts_newer_entries_first() {
        let mut entries = vec![sample_entry("旧.txt", 1), sample_entry("新.txt", 2)];
        sort_entries(&mut entries);
        assert_eq!(entries[0].name, "新.txt");
    }

    #[test]
    fn state_starts_without_an_index_path() {
        let state = AppState::default();
        assert!(state.index_path().is_err());
    }

    #[test]
    fn updates_and_removes_entries_without_touching_the_original_file() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("资料 文件.txt");
        fs::write(&source_path, "原始内容").expect("source file should be written");
        let entry = crate::filesystem::index_selected_path(&source_path.to_string_lossy())
            .expect("source entry should be indexed");
        let state = AppState::default();
        state
            .initialize(index_path.clone())
            .expect("state should initialize");

        state
            .update_entries(|entries| {
                entries.push(entry.clone());
                Ok(true)
            })
            .expect("entry should be added");
        state
            .update_entries(|entries| {
                let current = entries
                    .iter_mut()
                    .find(|current| current.id == entry.id)
                    .ok_or(StorageError::EntryNotFound)?;
                current.favorite = true;
                Ok(true)
            })
            .expect("favorite should be updated");
        let persisted = load_entries(&index_path).expect("updated index should load");
        assert!(persisted[0].favorite);
        assert!(source_path.exists());

        state
            .update_entries(|entries| {
                entries.retain(|current| current.id != entry.id);
                Ok(true)
            })
            .expect("entry should be removed");
        assert!(load_entries(&index_path)
            .expect("removed index should load")
            .is_empty());
        assert!(source_path.exists());
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn migrates_legacy_index_and_backfills_added_at_without_clearing_entries() {
        for version in [1, 2] {
            let path = unique_temp_path();
            let entry = sample_entry("旧资料.txt", 42);
            let mut legacy_entry = serde_json::to_value(&entry).expect("entry should serialize");
            legacy_entry
                .as_object_mut()
                .expect("entry should be an object")
                .remove("addedAt");
            legacy_entry["lastRecordedAt"] = serde_json::json!(9999);
            let legacy = serde_json::json!({ "version": version, "entries": [legacy_entry] });
            fs::write(
                &path,
                serde_json::to_vec(&legacy).expect("legacy should serialize"),
            )
            .expect("legacy index should be written");

            let loaded = load_entries(&path).expect("legacy index should migrate");

            assert_eq!(loaded[0].added_at, 42);
            assert_eq!(loaded[0].last_recorded_at, None);
            let migrated: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).expect("migrated index should exist"))
                    .expect("migrated index should be valid JSON");
            assert_eq!(migrated["version"], 3);
            assert_eq!(migrated["entries"][0]["addedAt"], 42);
            assert_eq!(
                migrated["entries"][0]["lastRecordedAt"],
                serde_json::Value::Null
            );
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn floating_merge_preserves_user_fields_and_orders_millisecond_records() {
        let mut existing = sample_entry("资料.txt", 20);
        existing.favorite = true;
        existing.added_at = 11;
        existing.preview_status = "ready".to_string();
        existing.last_recorded_at = Some(100);
        let mut incoming = sample_entry("资料.txt", 30);
        incoming.id = "incoming-id".to_string();
        incoming.name = "资料.txt".to_string();

        let mut entries = vec![existing];
        let stats = merge_index_entries(
            &mut entries,
            [incoming],
            IndexMergeMode::FloatingRecord {
                base_recorded_at: 2_000,
            },
        );

        assert_eq!(stats.added_count, 0);
        assert_eq!(stats.refreshed_count, 1);
        assert_eq!(stats.recorded_count, 1);
        assert_eq!(entries[0].id, "资料.txt");
        assert!(entries[0].favorite);
        assert_eq!(entries[0].added_at, 11);
        assert_eq!(entries[0].preview_status, "ready");
        assert_eq!(entries[0].last_recorded_at, Some(2_000));

        let mut more = (0..6)
            .map(|index| {
                let mut entry = sample_entry(&format!("最近{index}.txt"), index);
                entry.id = format!("recent-{index}");
                entry.last_recorded_at = Some(3_000 + index);
                entry
            })
            .collect::<Vec<_>>();
        more.push(sample_entry("主窗口导入.txt", 99));
        let recent = floating_recent(&more);
        assert_eq!(recent.len(), 5);
        assert_eq!(recent[0].id, "recent-5");
        assert!(!recent.iter().any(|entry| entry.name == "主窗口导入.txt"));
    }

    #[test]
    fn rejects_corrupt_or_unknown_indexes_instead_of_returning_an_empty_index() {
        let corrupt_path = unique_temp_path();
        fs::write(&corrupt_path, b"not-json").expect("corrupt index should be written");
        assert!(matches!(
            load_entries(&corrupt_path),
            Err(StorageError::Corrupt)
        ));
        assert_eq!(
            fs::read(&corrupt_path).expect("corrupt index should remain"),
            b"not-json"
        );
        let _ = fs::remove_file(corrupt_path);

        let unknown_path = unique_temp_path();
        fs::write(&unknown_path, br#"{"version":99,"entries":[]}"#)
            .expect("unknown index should be written");
        assert!(matches!(
            load_entries(&unknown_path),
            Err(StorageError::UnsupportedVersion)
        ));
        let _ = fs::remove_file(unknown_path);
    }

    #[test]
    fn keeps_the_memory_snapshot_when_an_index_write_fails() {
        let root = unique_temp_path().with_extension("");
        fs::create_dir_all(&root).expect("test directory should be created");
        let index_path = root.join("index.json");
        let state = AppState::default();
        state
            .initialize(index_path)
            .expect("state should initialize");
        fs::remove_dir_all(&root).expect("test directory should be removable");

        let result = state.update_entries(|entries| {
            entries.push(sample_entry("不会写入.txt", 1));
            Ok(true)
        });

        assert!(matches!(result, Err(StorageError::Write)));
        assert!(state
            .snapshot()
            .expect("state should remain readable")
            .is_empty());
    }

    #[test]
    fn favorite_update_preserves_the_entry_identity_and_user_metadata() {
        let mut entry = sample_entry("收藏资料.md", 12);
        entry.added_at = 7;
        entry.last_recorded_at = Some(99);
        entry.preview_status = "ready".to_string();
        let original = entry.clone();
        let mut entries = vec![entry];

        assert!(
            super::set_favorite(&mut entries, &original.id, true).expect("favorite should update")
        );
        assert!(entries[0].favorite);
        assert_eq!(entries[0].id, original.id);
        assert_eq!(entries[0].path, original.path);
        assert_eq!(entries[0].added_at, original.added_at);
        assert_eq!(entries[0].last_recorded_at, original.last_recorded_at);
        assert_eq!(entries[0].preview_status, original.preview_status);
    }

    fn sample_entry(name: &str, modified_at: i64) -> IndexEntry {
        IndexEntry {
            id: name.to_string(),
            path: format!("C:\\资料\\{name}"),
            name: name.to_string(),
            kind: "text".to_string(),
            file_type: "文本文件".to_string(),
            size: 1,
            modified_at,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: modified_at,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
        }
    }

    fn unique_temp_path() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-workbench-index-{timestamp}.json"))
    }
}
