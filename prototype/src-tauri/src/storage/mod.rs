use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex,
    },
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
    #[error("索引恢复状态不可用")]
    Recovery,
}

#[derive(Debug, Default)]
pub struct AppState {
    index_path: Mutex<Option<PathBuf>>,
    entries: Mutex<Vec<IndexEntry>>,
    mutation_lock: Mutex<()>,
    pending_operations_path: Mutex<Option<PathBuf>>,
    pending_operations: Mutex<Vec<PendingOperation>>,
    recovery: Mutex<Option<RecoveryInfo>>,
    revision: AtomicU64,
}

#[derive(Debug, Deserialize, Serialize)]
struct IndexDocument {
    version: u32,
    entries: Vec<IndexEntry>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingDocument {
    version: u32,
    operations: Vec<PendingOperation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingOperation {
    file_id: String,
    operation: String,
    path: String,
    state: String,
    created_at: i64,
}

#[derive(Clone, Debug)]
struct RecoveryInfo {
    issue: String,
    backup_created: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRecoveryStatus {
    pub required: bool,
    pub issue: String,
    pub backup_created: bool,
    pub pending_operations: usize,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSnapshot {
    pub entries: Vec<IndexEntry>,
    pub revision: u64,
    pub recovery: Option<IndexRecoveryStatus>,
}

#[derive(Debug)]
pub struct MutationResult<T> {
    pub value: T,
    pub entries: Vec<IndexEntry>,
    pub revision: u64,
    pub changed: bool,
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
        let (entries, mut recovery) = match load_entries(&index_path) {
            Ok(entries) => (entries, None),
            Err(error @ (StorageError::Corrupt | StorageError::UnsupportedVersion)) => {
                let issue = match error {
                    StorageError::Corrupt => "索引文件损坏",
                    StorageError::UnsupportedVersion => "索引文件版本不受支持",
                    _ => "索引文件无法恢复",
                };
                (
                    Vec::new(),
                    Some(RecoveryInfo {
                        issue: issue.to_string(),
                        backup_created: backup_file(&index_path),
                    }),
                )
            }
            Err(StorageError::Write) => {
                let (entries, _) = read_entries_document(&index_path)?;
                (
                    entries,
                    Some(RecoveryInfo {
                        issue: "索引格式迁移未完成".to_string(),
                        backup_created: backup_file(&index_path),
                    }),
                )
            }
            Err(error) => return Err(error),
        };
        let pending_path = index_path.with_file_name("pending-operations.json");
        let pending_operations = match load_pending_operations(&pending_path) {
            Ok(operations) => operations,
            Err(StorageError::Corrupt | StorageError::UnsupportedVersion) => {
                let backup_created = backup_file(&pending_path);
                let repaired = save_pending_operations(&pending_path, &[]).is_ok();
                if recovery.is_none() {
                    recovery = Some(RecoveryInfo {
                        issue: "待同步操作记录损坏".to_string(),
                        backup_created: backup_created && repaired,
                    });
                }
                Vec::new()
            }
            Err(error) => return Err(error),
        };
        *self.index_path.lock().map_err(|_| StorageError::State)? = Some(index_path);
        *self
            .pending_operations_path
            .lock()
            .map_err(|_| StorageError::State)? = Some(pending_path);
        *self.entries.lock().map_err(|_| StorageError::State)? = entries;
        *self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)? = pending_operations;
        *self.recovery.lock().map_err(|_| StorageError::State)? = recovery;
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

    pub fn snapshot_with_revision(&self) -> Result<IndexSnapshot, StorageError> {
        Ok(IndexSnapshot {
            entries: self.snapshot()?,
            revision: self.revision(),
            recovery: self.recovery_status()?,
        })
    }

    pub fn revision(&self) -> u64 {
        self.revision.load(Ordering::Acquire)
    }

    pub fn recovery_status(&self) -> Result<Option<IndexRecoveryStatus>, StorageError> {
        let recovery = self
            .recovery
            .lock()
            .map_err(|_| StorageError::State)?
            .clone();
        let pending_operations = self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)?
            .len();
        if recovery.is_none() && pending_operations == 0 {
            return Ok(None);
        }
        Ok(Some(IndexRecoveryStatus {
            required: true,
            issue: recovery
                .as_ref()
                .map(|value| value.issue.clone())
                .unwrap_or_else(|| "存在待同步的文件操作，请刷新索引".to_string()),
            backup_created: recovery
                .as_ref()
                .map(|value| value.backup_created)
                .unwrap_or(false),
            pending_operations,
        }))
    }

    pub fn replace_entries(&self, entries: Vec<IndexEntry>) -> Result<(), StorageError> {
        *self.entries.lock().map_err(|_| StorageError::State)? = entries;
        Ok(())
    }

    #[cfg(test)]
    pub fn update_entries<F>(&self, mutation: F) -> Result<Vec<IndexEntry>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>) -> Result<bool, StorageError>,
    {
        self.update_entries_with(|entries| mutation(entries).map(|changed| (changed, ())))
            .map(|result| result.entries)
    }

    pub fn update_entries_with<F, T>(&self, mutation: F) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>) -> Result<(bool, T), StorageError>,
    {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        let mut next = self.snapshot()?;
        let (changed, value) = mutation(&mut next)?;
        let revision = if changed {
            save_entries(&index_path, &next)?;
            self.replace_entries(next.clone())?;
            self.revision.fetch_add(1, Ordering::AcqRel) + 1
        } else {
            self.revision()
        };
        Ok(MutationResult {
            value,
            entries: next,
            revision,
            changed,
        })
    }

    pub fn reset_index_recovery(&self) -> Result<IndexSnapshot, StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        save_entries(&index_path, &[])?;
        self.replace_entries(Vec::new())?;
        self.revision.fetch_add(1, Ordering::AcqRel);
        *self.recovery.lock().map_err(|_| StorageError::State)? = None;
        Ok(IndexSnapshot {
            entries: Vec::new(),
            revision: self.revision(),
            recovery: self.recovery_status()?,
        })
    }

    pub fn export_recovery_diagnostic(&self, destination: &Path) -> Result<(), StorageError> {
        let parent = destination.parent().ok_or(StorageError::DataDirectory)?;
        let parent_path = parent.to_string_lossy();
        let safe_parent = crate::filesystem::validate_directory_path(&parent_path)
            .map_err(|_| StorageError::Write)?;
        let file_name = destination
            .file_name()
            .filter(|name| !name.is_empty())
            .ok_or(StorageError::Write)?;
        let target = safe_parent.join(file_name);
        if let Ok(metadata) = fs::symlink_metadata(&target) {
            if crate::filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
                return Err(StorageError::Write);
            }
        }
        let status = self.recovery_status()?.unwrap_or(IndexRecoveryStatus {
            required: false,
            issue: "没有待处理的索引恢复问题".to_string(),
            backup_created: false,
            pending_operations: 0,
        });
        let diagnostic = serde_json::json!({
            "format": "local-material-workbench-diagnostic",
            "indexFormatVersion": INDEX_FORMAT_VERSION,
            "recovery": status,
        });
        let encoded = serde_json::to_vec_pretty(&diagnostic).map_err(|_| StorageError::Write)?;
        let mut file = AtomicWriteFile::open(target).map_err(|_| StorageError::Write)?;
        std::io::Write::write_all(file.as_file_mut(), &encoded).map_err(|_| StorageError::Write)?;
        file.commit().map_err(|_| StorageError::Write)
    }

    pub fn reconcile_pending_operations(&self) -> Result<bool, StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        let mut entries = self.snapshot()?;
        let pending = self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)?
            .clone();
        let mut resolved_ids = Vec::new();
        for operation in &pending {
            if operation.operation != "delete-original" || operation.state != "physical-complete" {
                continue;
            }
            if !path_exists(&operation.path) {
                entries.retain(|entry| entry.id != operation.file_id);
                resolved_ids.push(operation.file_id.clone());
            }
        }
        let changed = entries != self.snapshot()?;
        if changed {
            save_entries(&index_path, &entries)?;
            self.replace_entries(entries)?;
            self.revision.fetch_add(1, Ordering::AcqRel);
        }
        if !resolved_ids.is_empty() {
            let mut operations = self
                .pending_operations
                .lock()
                .map_err(|_| StorageError::State)?;
            operations.retain(|operation| !resolved_ids.contains(&operation.file_id));
            let pending_path = self.pending_operations_path()?;
            save_pending_operations(&pending_path, &operations)?;
        }
        Ok(changed)
    }

    pub fn prepare_delete(&self, file_id: &str, path: &Path) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let entry = self
            .snapshot()?
            .into_iter()
            .find(|entry| {
                entry.id == file_id
                    && crate::filesystem::same_path(&entry.path, &path.to_string_lossy())
            })
            .ok_or(StorageError::EntryNotFound)?;
        let mut operations = self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)?
            .clone();
        operations.retain(|operation| operation.file_id != entry.id);
        operations.push(PendingOperation {
            file_id: entry.id,
            operation: "delete-original".to_string(),
            path: path.to_string_lossy().into_owned(),
            state: "prepared".to_string(),
            created_at: current_timestamp_millis(),
        });
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &operations)?;
        *self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)? = operations;
        Ok(())
    }

    pub fn mark_delete_complete(&self, file_id: &str) -> Result<(), StorageError> {
        self.update_pending_delete(file_id, "physical-complete")
    }

    pub fn clear_pending_delete(&self, file_id: &str) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let mut operations = self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)?
            .clone();
        operations.retain(|operation| operation.file_id != file_id);
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &operations)?;
        *self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)? = operations;
        Ok(())
    }

    fn update_pending_delete(&self, file_id: &str, next_state: &str) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let mut operations = self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)?
            .clone();
        let Some(operation) = operations
            .iter_mut()
            .find(|operation| operation.file_id == file_id)
        else {
            return Err(StorageError::Recovery);
        };
        operation.state = next_state.to_string();
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &operations)?;
        *self
            .pending_operations
            .lock()
            .map_err(|_| StorageError::State)? = operations;
        Ok(())
    }

    fn pending_operations_path(&self) -> Result<PathBuf, StorageError> {
        self.pending_operations_path
            .lock()
            .map_err(|_| StorageError::State)?
            .clone()
            .ok_or(StorageError::DataDirectory)
    }
}

pub fn load_entries(path: &Path) -> Result<Vec<IndexEntry>, StorageError> {
    let (entries, needs_save) = read_entries_document(path)?;
    if needs_save {
        save_entries(path, &entries)?;
    }
    Ok(entries)
}

fn read_entries_document(path: &Path) -> Result<(Vec<IndexEntry>, bool), StorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok((Vec::new(), false));
        }
        Err(_) => return Err(StorageError::Read),
    };
    if crate::filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(StorageError::Corrupt);
    }
    let bytes = fs::read(path).map_err(|_| StorageError::Read)?;
    let document =
        serde_json::from_slice::<IndexDocument>(&bytes).map_err(|_| StorageError::Corrupt)?;
    let mut entries = document.entries;
    let needs_save = match document.version {
        INDEX_FORMAT_VERSION => normalize_entries(&mut entries)?,
        LEGACY_INDEX_FORMAT_VERSION | PREVIOUS_INDEX_FORMAT_VERSION => {
            normalize_entries(&mut entries)?;
            true
        }
        _ => return Err(StorageError::UnsupportedVersion),
    };
    validate_entries(&entries)?;
    Ok((entries, needs_save))
}

pub fn save_entries(path: &Path, entries: &[IndexEntry]) -> Result<(), StorageError> {
    validate_entries(entries)?;
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

fn normalize_entries(entries: &mut Vec<IndexEntry>) -> Result<bool, StorageError> {
    let mut changed = normalize_added_at(entries);
    for entry in entries.iter_mut() {
        if entry.last_recorded_at.is_some_and(|value| value <= 0) {
            entry.last_recorded_at = None;
            changed = true;
        }
        if entry.invalid && entry.status != "路径失效" {
            entry.status = "路径失效".to_string();
            changed = true;
        } else if !entry.invalid && entry.status == "路径失效" {
            entry.invalid = true;
            changed = true;
        }
    }
    changed |= deduplicate_entries(entries);
    validate_entries(entries)?;
    Ok(changed)
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

fn deduplicate_entries(entries: &mut Vec<IndexEntry>) -> bool {
    let original = entries.to_vec();
    let mut deduplicated = Vec::with_capacity(entries.len());
    for entry in original {
        let duplicate_index = deduplicated.iter().position(|current: &IndexEntry| {
            current.id == entry.id
                || crate::filesystem::path_identity(&current.path)
                    == crate::filesystem::path_identity(&entry.path)
        });
        if let Some(index) = duplicate_index {
            merge_duplicate_metadata(&mut deduplicated[index], &entry);
        } else {
            deduplicated.push(entry);
        }
    }
    let changed =
        deduplicated.len() != entries.len() || deduplicated.as_slice() != entries.as_slice();
    if changed {
        *entries = deduplicated;
    }
    changed
}

fn merge_duplicate_metadata(current: &mut IndexEntry, duplicate: &IndexEntry) {
    current.favorite |= duplicate.favorite;
    if current.added_at <= 0 || (duplicate.added_at > 0 && duplicate.added_at < current.added_at) {
        current.added_at = duplicate.added_at;
    }
    current.last_recorded_at = match (current.last_recorded_at, duplicate.last_recorded_at) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (None, value) => value,
        (value, None) => value,
    };
    if current.preview_status == "idle" && duplicate.preview_status != "idle" {
        current.preview_status = duplicate.preview_status.clone();
    }
    if duplicate.invalid {
        current.invalid = true;
        current.status = "路径失效".to_string();
    }
}

fn validate_entries(entries: &[IndexEntry]) -> Result<(), StorageError> {
    let mut ids = HashSet::new();
    let mut paths = HashSet::new();
    for entry in entries {
        let path_name = Path::new(&entry.path)
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or_default();
        if entry.id.trim().is_empty()
            || !ids.insert(entry.id.clone())
            || entry.path.trim().is_empty()
            || !paths.insert(crate::filesystem::path_identity(&entry.path))
            || entry.name.trim().is_empty()
            || path_name != entry.name
            || entry.size > MAX_INDEXED_SIZE_BYTES
            || entry.modified_at < 0
            || entry.added_at < 0
            || entry
                .last_recorded_at
                .is_some_and(|value| !(1..=MAX_TIMESTAMP_MILLIS).contains(&value))
            || entry.modified_at > MAX_TIMESTAMP_SECONDS
            || entry.added_at > MAX_TIMESTAMP_SECONDS
        {
            return Err(StorageError::Corrupt);
        }
        if !matches!(entry.status.as_str(), "已登记" | "路径失效")
            || entry.invalid != (entry.status == "路径失效")
            || !matches!(
                entry.preview_status.as_str(),
                "idle"
                    | "loading"
                    | "ready"
                    | "unsupported"
                    | "missing"
                    | "permission-denied"
                    | "too-large"
                    | "converter-missing"
                    | "parse-error"
            )
        {
            return Err(StorageError::Corrupt);
        }
        if entry.kind == "folder" {
            if entry.file_type != "文件夹" {
                return Err(StorageError::Corrupt);
            }
        } else if let Some(info) = crate::filesystem::type_info_for_path(Path::new(&entry.path)) {
            if info.kind != entry.kind || info.file_type != entry.file_type {
                return Err(StorageError::Corrupt);
            }
        } else if entry.kind != "other" || entry.file_type != "其他文件" {
            return Err(StorageError::Corrupt);
        }
    }
    Ok(())
}

const MAX_TIMESTAMP_SECONDS: i64 = 4_102_444_800;
const MAX_TIMESTAMP_MILLIS: i64 = MAX_TIMESTAMP_SECONDS.saturating_mul(1_000);
const MAX_INDEXED_SIZE_BYTES: u64 = 1_u64 << 50;

fn path_exists(path: &str) -> bool {
    fs::symlink_metadata(path).is_ok()
}

fn load_pending_operations(path: &Path) -> Result<Vec<PendingOperation>, StorageError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Ok(Vec::new());
        }
        Err(_) => return Err(StorageError::Read),
    };
    if crate::filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(StorageError::Corrupt);
    }
    let bytes = fs::read(path).map_err(|_| StorageError::Read)?;
    let document =
        serde_json::from_slice::<PendingDocument>(&bytes).map_err(|_| StorageError::Corrupt)?;
    if document.version != 1 {
        return Err(StorageError::UnsupportedVersion);
    }
    if document.operations.iter().any(|operation| {
        operation.file_id.trim().is_empty()
            || operation.operation != "delete-original"
            || !matches!(operation.state.as_str(), "prepared" | "physical-complete")
            || operation.path.trim().is_empty()
            || operation.created_at <= 0
    }) {
        return Err(StorageError::Corrupt);
    }
    Ok(document.operations)
}

fn save_pending_operations(
    path: &Path,
    operations: &[PendingOperation],
) -> Result<(), StorageError> {
    if operations.is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|_| StorageError::Write)?;
        }
        return Ok(());
    }
    let document = PendingDocument {
        version: 1,
        operations: operations.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| StorageError::Write)?;
    let mut file = AtomicWriteFile::open(path).map_err(|_| StorageError::Write)?;
    std::io::Write::write_all(file.as_file_mut(), &encoded).map_err(|_| StorageError::Write)?;
    file.commit().map_err(|_| StorageError::Write)
}

fn backup_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if crate::filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return false;
    }
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    for attempt in 0..3_u32 {
        let backup = path.with_file_name(format!(
            "{}.recovery-{}-{}.bak",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("index"),
            timestamp,
            attempt
        ));
        if backup.exists() {
            continue;
        }
        if fs::copy(path, backup).is_ok() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{
        floating_recent, load_entries, merge_index_entries, save_entries, sort_entries, AppState,
        IndexMergeMode, StorageError, INDEX_FORMAT_VERSION,
    };
    use crate::filesystem::IndexEntry;
    use std::{
        fs,
        path::{Path, PathBuf},
        time::SystemTime,
    };

    #[test]
    fn writes_versioned_index_and_reads_it_back() {
        let path = unique_temp_path();
        let entry = sample_entry("资料.txt", 20);
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
            assert_eq!(loaded[0].last_recorded_at, Some(9999));
            let migrated: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).expect("migrated index should exist"))
                    .expect("migrated index should be valid JSON");
            assert_eq!(migrated["version"], 3);
            assert_eq!(migrated["entries"][0]["addedAt"], 42);
            assert_eq!(
                migrated["entries"][0]["lastRecordedAt"],
                serde_json::json!(9999)
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

    #[test]
    fn deduplicates_ids_and_paths_deterministically_while_preserving_user_fields() {
        let path = unique_temp_path();
        let first = sample_entry("重复.txt", 10);
        let mut duplicate = first.clone();
        duplicate.favorite = true;
        duplicate.last_recorded_at = Some(99);
        duplicate.preview_status = "ready".to_string();
        let document = serde_json::json!({
            "version": INDEX_FORMAT_VERSION,
            "entries": [first.clone(), duplicate]
        });
        fs::write(
            &path,
            serde_json::to_vec(&document).expect("index should serialize"),
        )
        .expect("index should be written");

        let loaded = load_entries(&path).expect("duplicate index should recover");
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].id, first.id);
        assert!(loaded[0].favorite);
        assert_eq!(loaded[0].last_recorded_at, Some(99));
        assert_eq!(loaded[0].preview_status, "ready");
        assert!(fs::read(&path).is_ok());
        let _ = fs::remove_file(path);
    }

    #[test]
    fn recovers_a_corrupt_index_without_startup_failure_and_requires_explicit_reset() {
        let path = unique_temp_path();
        fs::write(&path, b"not-json").expect("corrupt index should be written");
        let state = AppState::default();
        state
            .initialize(path.clone())
            .expect("corrupt index should enter recovery");
        assert!(state
            .snapshot()
            .expect("snapshot should be readable")
            .is_empty());
        let recovery = state
            .recovery_status()
            .expect("recovery status should be readable")
            .expect("recovery should be required");
        assert!(recovery.required);
        assert!(recovery.backup_created);

        let snapshot = state
            .reset_index_recovery()
            .expect("explicit reset should create an empty index");
        assert!(snapshot.recovery.is_none());
        assert_eq!(snapshot.revision, 1);
        let saved: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("reset index should exist"))
                .expect("reset index should be JSON");
        assert_eq!(saved["version"], INDEX_FORMAT_VERSION);
        cleanup_recovery_artifacts(&path);
    }

    #[test]
    fn increments_revision_only_after_a_persisted_index_change() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("revision.txt");
        fs::write(&source_path, "内容").expect("source should be written");
        let entry = crate::filesystem::index_selected_path(&source_path.to_string_lossy())
            .expect("source should be indexable");
        let state = AppState::default();
        state
            .initialize(index_path.clone())
            .expect("state should initialize");
        let added = state
            .update_entries_with(|entries| {
                entries.push(entry);
                Ok((true, ()))
            })
            .expect("entry should be persisted");
        assert_eq!(added.revision, 1);
        let unchanged = state
            .update_entries_with(|_| Ok((false, ())))
            .expect("unchanged index should be readable");
        assert_eq!(unchanged.revision, 1);
        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn rejects_unreasonable_indexed_sizes() {
        let path = unique_temp_path();
        let mut entry = sample_entry("过大.txt", 10);
        entry.size = u64::MAX;
        let document = serde_json::json!({
            "version": INDEX_FORMAT_VERSION,
            "entries": [entry]
        });
        fs::write(
            &path,
            serde_json::to_vec(&document).expect("index should serialize"),
        )
        .expect("index should be written");
        assert!(matches!(load_entries(&path), Err(StorageError::Corrupt)));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reconciles_a_completed_delete_after_index_save_failure() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("待同步删除.txt");
        fs::write(&source_path, "内容").expect("source should be written");
        let entry = crate::filesystem::index_selected_path(&source_path.to_string_lossy())
            .expect("source should be indexable");
        let state = AppState::default();
        state
            .initialize(index_path.clone())
            .expect("state should initialize");
        state
            .update_entries(|entries| {
                entries.push(entry.clone());
                Ok(true)
            })
            .expect("entry should be saved");
        let canonical_source = fs::canonicalize(&source_path).expect("source should canonicalize");
        state
            .prepare_delete(&entry.id, &canonical_source)
            .expect("delete should be recorded");
        state
            .mark_delete_complete(&entry.id)
            .expect("physical completion should be recorded");
        fs::remove_file(&source_path).expect("source should be removed");

        assert!(state
            .reconcile_pending_operations()
            .expect("pending operation should reconcile"));
        assert!(state
            .snapshot()
            .expect("snapshot should be readable")
            .is_empty());
        assert!(state
            .recovery_status()
            .expect("status should be readable")
            .is_none());
        let _ = fs::remove_file(&index_path);
        let _ = fs::remove_file(index_path.with_file_name("pending-operations.json"));
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

    fn cleanup_recovery_artifacts(path: &Path) {
        let _ = fs::remove_file(path);
        if let Some(parent) = path.parent() {
            let prefix = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or_default()
                .to_string();
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(&format!("{prefix}.recovery-"))
                    {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}
