use std::{
    fs,
    path::{Path, PathBuf},
    sync::Mutex,
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::filesystem::IndexEntry;

pub(crate) mod settings;

pub const INDEX_FORMAT_VERSION: u32 = 2;
const LEGACY_INDEX_FORMAT_VERSION: u32 = 1;

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
        INDEX_FORMAT_VERSION => normalize_added_at(&mut entries),
        LEGACY_INDEX_FORMAT_VERSION => {
            normalize_added_at(&mut entries);
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
    use super::{load_entries, save_entries, sort_entries, AppState, StorageError};
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
        let path = unique_temp_path();
        let entry = sample_entry("旧资料.txt", 42);
        let mut legacy_entry = serde_json::to_value(&entry).expect("entry should serialize");
        legacy_entry
            .as_object_mut()
            .expect("entry should be an object")
            .remove("addedAt");
        let legacy = serde_json::json!({ "version": 1, "entries": [legacy_entry] });
        fs::write(
            &path,
            serde_json::to_vec(&legacy).expect("legacy should serialize"),
        )
        .expect("legacy index should be written");

        let loaded = load_entries(&path).expect("legacy index should migrate");

        assert_eq!(loaded[0].added_at, 42);
        let migrated: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("migrated index should exist"))
                .expect("migrated index should be valid JSON");
        assert_eq!(migrated["version"], 2);
        assert_eq!(migrated["entries"][0]["addedAt"], 42);
        let _ = fs::remove_file(path);
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
