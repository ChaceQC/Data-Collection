use std::{
    collections::{HashMap, HashSet},
    fs,
    path::{Path, PathBuf},
    sync::{Mutex, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use uuid::Uuid;

use crate::filesystem::IndexEntry;

use self::app_data::{AppDataError, AppDataFile};

pub(crate) mod app_data;
pub(crate) mod content_index;
pub(crate) mod content_limits;
pub(crate) mod content_query;
pub(crate) mod content_search;
pub(crate) mod file_actions;
pub(crate) mod floating_ball;
pub(crate) mod floating_files;
pub(crate) mod index_mutations;
pub(crate) mod index_persistence;
pub(crate) mod index_state;
pub(crate) mod metadata_search;
pub(crate) mod operation_history;
pub(crate) mod pending_operations;
#[cfg(not(test))]
pub(crate) mod repository;
pub(crate) mod settings;
pub(crate) mod undo;

pub const INDEX_FORMAT_VERSION: u32 = 5;
const LEGACY_INDEX_FORMAT_VERSION: u32 = 1;
const PREVIOUS_INDEX_FORMAT_VERSION: u32 = 4;
const MAX_GROUPS: usize = 256;
const MAX_GROUP_NAME_CHARS: usize = 64;
pub(crate) const MAX_TAGS_PER_ENTRY: usize = 32;
const MAX_TAG_CHARS: usize = 32;
const MAX_UNDO_RECORDS: usize = 50;
pub const FLOATING_RECENT_LIMIT: usize = 5;

type IndexDocumentParts = (Vec<IndexEntry>, Vec<Group>, Vec<UndoRecord>, u64);
type ReadIndexDocument = (Vec<IndexEntry>, Vec<Group>, Vec<UndoRecord>, u64, bool);

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
    #[error("分组名称无效")]
    InvalidGroupName,
    #[error("分组名称已经存在")]
    DuplicateGroup,
    #[error("找不到需要操作的分组")]
    GroupNotFound,
    #[error("标签无效")]
    InvalidTag,
    #[error("撤销操作不可用")]
    UndoUnavailable,
    #[error("撤销目标已发生变化")]
    UndoConflict,
    #[error("预览状态无效")]
    InvalidPreviewStatus,
    #[error("预览结果已过期，请重新打开资料")]
    PreviewRevisionConflict,
    #[error("该资料正在执行文件操作，请稍后重试")]
    FileBusy,
    #[error("资料来源已改变，请刷新索引后重试")]
    SourceChanged,
    #[error("资料已恢复或已重新定位，请刷新索引")]
    RepositionNotNeeded,
    #[error("所选路径类型不匹配，请按原资料选择文件或文件夹")]
    RepositionKindMismatch,
}

#[derive(Debug, Default)]
pub struct AppState {
    index_path: Mutex<Option<PathBuf>>,
    mutation_lock: Mutex<()>,
    active_file_actions: Mutex<HashSet<String>>,
    pending_operations_path: Mutex<Option<PathBuf>>,
    snapshot: RwLock<IndexStateData>,
}

pub(super) use index_state::IndexStateData;

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct IndexDocument {
    version: u32,
    #[serde(default)]
    revision: u64,
    entries: Vec<IndexEntry>,
    #[serde(default)]
    groups: Vec<Group>,
    #[serde(default)]
    undo_log: Vec<UndoRecord>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Group {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoEntryChange {
    file_id: String,
    before: Option<IndexEntry>,
    after: Option<IndexEntry>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct UndoGroupChange {
    group_id: String,
    before: Option<Group>,
    after: Option<Group>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct UndoRecord {
    id: String,
    operation: String,
    revision: u64,
    created_at: i64,
    entries: Vec<UndoEntryChange>,
    groups: Vec<UndoGroupChange>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct PendingDocument {
    version: u32,
    operations: Vec<PendingOperation>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PendingOperation {
    file_id: String,
    operation: String,
    path: String,
    state: String,
    created_at: i64,
    #[serde(default)]
    source: Option<pending_operations::SourceSnapshot>,
}

#[derive(Clone, Debug)]
pub(crate) struct RecoveryInfo {
    issue: String,
    backup_created: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexRecoveryStatus {
    pub required: bool,
    pub issue: String,
    pub backup_created: bool,
    pub pending_operations: usize,
    pub index_blocked: bool,
    pub pending_file_ids: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexSnapshot {
    pub entries: Vec<IndexEntry>,
    pub groups: Vec<Group>,
    pub revision: u64,
    pub recovery: Option<IndexRecoveryStatus>,
    pub undo: Option<UndoStatus>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UndoStatus {
    pub id: String,
    pub operation: String,
    pub count: usize,
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
        app_data::ensure_parent(&index_path).map_err(|_| StorageError::DataDirectory)?;
        let (entries, groups, undo_log, revision, mut recovery) =
            match load_index_document(&index_path) {
                Ok((entries, groups, undo_log, revision)) => {
                    (entries, groups, undo_log, revision, None)
                }
                Err(error @ (StorageError::Corrupt | StorageError::UnsupportedVersion)) => {
                    let issue = match error {
                        StorageError::Corrupt => "索引文件损坏",
                        StorageError::UnsupportedVersion => "索引文件版本不受支持",
                        _ => "索引文件无法恢复",
                    };
                    (
                        Vec::new(),
                        Vec::new(),
                        Vec::new(),
                        0,
                        Some(RecoveryInfo {
                            issue: issue.to_string(),
                            backup_created: backup_file(&index_path, AppDataFile::Index),
                        }),
                    )
                }
                Err(StorageError::Write) => {
                    let (entries, groups, undo_log, revision, _) =
                        read_index_document(&index_path)?;
                    (
                        entries,
                        groups,
                        undo_log,
                        revision,
                        Some(RecoveryInfo {
                            issue: "索引格式迁移未完成".to_string(),
                            backup_created: backup_file(&index_path, AppDataFile::Index),
                        }),
                    )
                }
                Err(error) => return Err(error),
            };
        let pending_path = index_path.with_file_name("pending-operations.json");
        let pending_operations = match load_pending_operations(&pending_path) {
            Ok(operations) => operations,
            Err(StorageError::Corrupt | StorageError::UnsupportedVersion) => {
                let backup_created = backup_file(&pending_path, AppDataFile::PendingOperations);
                let repaired =
                    backup_created && save_pending_operations(&pending_path, &[]).is_ok();
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
        *self.snapshot.write().map_err(|_| StorageError::State)? = IndexStateData {
            entries,
            groups,
            undo_log,
            recovery,
            pending_operations,
            revision,
            source_revisions: HashMap::new(),
        };
        Ok(())
    }

    pub fn index_path(&self) -> Result<PathBuf, StorageError> {
        self.index_path
            .lock()
            .map_err(|_| StorageError::State)?
            .clone()
            .ok_or(StorageError::DataDirectory)
    }

    pub fn snapshot(&self) -> Result<IndexSnapshot, StorageError> {
        self.snapshot
            .read()
            .map_err(|_| StorageError::State)
            .map(|state| state.public_snapshot())
    }

    pub fn recovery_status(&self) -> Result<Option<IndexRecoveryStatus>, StorageError> {
        self.snapshot
            .read()
            .map_err(|_| StorageError::State)
            .map(|state| state.recovery_status())
    }

    fn state_snapshot(&self) -> Result<IndexStateData, StorageError> {
        self.snapshot
            .read()
            .map_err(|_| StorageError::State)
            .map(|state| state.clone())
    }

    fn replace_state(&self, mut state: IndexStateData) -> Result<(), StorageError> {
        let mut current = self.snapshot.write().map_err(|_| StorageError::State)?;
        let previous = current
            .entries
            .iter()
            .map(|entry| (entry.id.as_str(), entry))
            .collect::<HashMap<_, _>>();
        state.source_revisions = state
            .entries
            .iter()
            .map(|entry| {
                let unchanged = previous.get(entry.id.as_str()).is_some_and(|old| {
                    old.path == entry.path
                        && old.name == entry.name
                        && old.kind == entry.kind
                        && old.invalid == entry.invalid
                        && old.size == entry.size
                        && old.modified_at == entry.modified_at
                });
                let revision = if unchanged {
                    current
                        .source_revisions
                        .get(&entry.id)
                        .copied()
                        .unwrap_or(0)
                } else {
                    state.revision
                };
                (entry.id.clone(), revision)
            })
            .collect();
        *current = state;
        Ok(())
    }

    pub(crate) fn preview_source(&self, file_id: &str) -> Result<(IndexEntry, u64), StorageError> {
        let snapshot = self.snapshot.read().map_err(|_| StorageError::State)?;
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.id == file_id)
            .filter(|entry| entry.kind != "folder" && !entry.invalid)
            .ok_or(StorageError::EntryNotFound)?;
        Ok((
            entry.clone(),
            snapshot.source_revisions.get(file_id).copied().unwrap_or(0),
        ))
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
        self.update_index_with(|entries, _groups| mutation(entries))
    }

    pub(crate) fn record_preview_outcome(
        &self,
        file_id: &str,
        status: &str,
        source_revision: u64,
        opened_at: Option<i64>,
        validate_source: impl FnOnce() -> bool,
    ) -> Result<MutationResult<Option<IndexEntry>>, StorageError> {
        self.update_index_internal(
            Some((file_id, source_revision)),
            None,
            |entries, _groups| {
                if !entries
                    .iter()
                    .any(|entry| entry.id == file_id && !entry.invalid)
                    || !validate_source()
                {
                    return Err(StorageError::PreviewRevisionConflict);
                }
                let (changed, entry) = record_preview_outcome(entries, file_id, status, opened_at)?;
                Ok((changed, Some(entry)))
            },
        )
    }

    pub fn update_index_with<F, T>(&self, mutation: F) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>, &mut Vec<Group>) -> Result<(bool, T), StorageError>,
    {
        self.update_index_internal(None, None, mutation)
    }

    pub fn update_index_with_undo<F, T>(
        &self,
        operation: &str,
        mutation: F,
    ) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>, &mut Vec<Group>) -> Result<(bool, T), StorageError>,
    {
        self.update_index_internal(None, Some(operation), mutation)
    }

    fn update_index_internal<F, T>(
        &self,
        expected_source: Option<(&str, u64)>,
        undo_operation: Option<&str>,
        mutation: F,
    ) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>, &mut Vec<Group>) -> Result<(bool, T), StorageError>,
    {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        let current = self.state_snapshot()?;
        if expected_source.is_some_and(|(id, expected)| {
            !current.entries.iter().any(|entry| entry.id == id)
                || current.source_revisions.get(id).copied().unwrap_or(0) != expected
        }) {
            return Err(StorageError::PreviewRevisionConflict);
        }
        let mut next = current.clone();
        let (changed, value) = mutation(&mut next.entries, &mut next.groups)?;
        let revision = if changed {
            let next_revision = current.revision.saturating_add(1);
            if let Some(operation) = undo_operation {
                append_undo_record(
                    &mut next.undo_log,
                    operation,
                    next_revision,
                    &current.entries,
                    &next.entries,
                    &current.groups,
                    &next.groups,
                );
            }
            save_index_document(
                &index_path,
                &next.entries,
                &next.groups,
                &next.undo_log,
                next_revision,
            )?;
            next.revision = next_revision;
            self.replace_state(next.clone())?;
            next_revision
        } else {
            current.revision
        };
        Ok(MutationResult {
            value,
            entries: if changed {
                next.entries
            } else {
                current.entries
            },
            revision,
            changed,
        })
    }

    pub fn undo_last(&self) -> Result<MutationResult<Vec<String>>, StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let index_path = self.index_path()?;
        let current = self.state_snapshot()?;
        let record = current
            .undo_log
            .last()
            .cloned()
            .ok_or(StorageError::UndoUnavailable)?;
        if current.revision != record.revision {
            return Err(StorageError::UndoUnavailable);
        }

        let mut next = current.clone();
        let mut changed_ids = record
            .entries
            .iter()
            .map(|change| change.file_id.clone())
            .collect::<Vec<_>>();
        changed_ids.extend(record.groups.iter().map(|change| change.group_id.clone()));
        let current_entry_positions = current
            .entries
            .iter()
            .enumerate()
            .map(|(position, entry)| (entry.id.clone(), position))
            .collect::<HashMap<_, _>>();
        let current_group_positions = current
            .groups
            .iter()
            .enumerate()
            .map(|(position, group)| (group.id.clone(), position))
            .collect::<HashMap<_, _>>();
        for change in &record.entries {
            let current = current_entry_positions
                .get(&change.file_id)
                .and_then(|position| current.entries.get(*position));
            if current != change.after.as_ref() {
                return Err(StorageError::UndoConflict);
            }
        }
        for change in &record.groups {
            let current = current_group_positions
                .get(&change.group_id)
                .and_then(|position| current.groups.get(*position));
            if current != change.after.as_ref() {
                return Err(StorageError::UndoConflict);
            }
        }

        let removed_entry_ids = record
            .entries
            .iter()
            .filter(|change| change.before.is_none())
            .map(|change| change.file_id.as_str())
            .collect::<HashSet<_>>();
        next.entries
            .retain(|entry| !removed_entry_ids.contains(entry.id.as_str()));
        let removed_group_ids = record
            .groups
            .iter()
            .filter(|change| change.before.is_none())
            .map(|change| change.group_id.as_str())
            .collect::<HashSet<_>>();
        next.groups
            .retain(|group| !removed_group_ids.contains(group.id.as_str()));

        let mut next_entry_positions = next
            .entries
            .iter()
            .enumerate()
            .map(|(position, entry)| (entry.id.clone(), position))
            .collect::<HashMap<_, _>>();
        for change in &record.entries {
            let Some(entry) = change.before.as_ref() else {
                continue;
            };
            if let Some(position) = next_entry_positions.get(&change.file_id).copied() {
                next.entries[position] = entry.clone();
            } else {
                let position = next.entries.len();
                next.entries.push(entry.clone());
                next_entry_positions.insert(change.file_id.clone(), position);
            }
        }

        let mut next_group_positions = next
            .groups
            .iter()
            .enumerate()
            .map(|(position, group)| (group.id.clone(), position))
            .collect::<HashMap<_, _>>();
        for change in &record.groups {
            let Some(group) = change.before.as_ref() else {
                continue;
            };
            if let Some(position) = next_group_positions.get(&change.group_id).copied() {
                next.groups[position] = group.clone();
            } else {
                let position = next.groups.len();
                next.groups.push(group.clone());
                next_group_positions.insert(change.group_id.clone(), position);
            }
        }
        sort_entries(&mut next.entries);
        sort_groups(&mut next.groups);
        next.undo_log.pop();
        let next_revision = current.revision.saturating_add(1);
        save_index_document(
            &index_path,
            &next.entries,
            &next.groups,
            &next.undo_log,
            next_revision,
        )?;
        next.revision = next_revision;
        self.replace_state(next.clone())?;
        Ok(MutationResult {
            value: changed_ids,
            entries: next.entries,
            revision: next_revision,
            changed: true,
        })
    }

    pub fn reset_index_recovery(&self) -> Result<IndexSnapshot, StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        if !self
            .active_file_actions
            .lock()
            .map_err(|_| StorageError::State)?
            .is_empty()
        {
            return Err(StorageError::FileBusy);
        }
        let index_path = self.index_path()?;
        let current = self.state_snapshot()?;
        let mut next = current.clone();
        next.entries.clear();
        next.groups.clear();
        next.undo_log.clear();
        next.recovery = None;
        next.revision = current.revision.saturating_add(1);
        save_index_document(
            &index_path,
            &next.entries,
            &next.groups,
            &next.undo_log,
            next.revision,
        )?;
        self.replace_state(next.clone())?;
        // 空索引先落盘；日志清理失败时保留已保存状态，重启按无对应条目收敛。
        save_pending_operations(&self.pending_operations_path()?, &[])?;
        next.pending_operations.clear();
        self.replace_state(next.clone())?;
        Ok(next.public_snapshot())
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
            index_blocked: false,
            pending_file_ids: Vec::new(),
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
        let current = self.state_snapshot()?;
        let mut next = current.clone();
        let mut resolved_ids = Vec::new();
        if current.recovery.is_some() {
            return Ok(false);
        }
        let active = self
            .active_file_actions
            .lock()
            .map_err(|_| StorageError::State)?;
        for operation in &current.pending_operations {
            if active.contains(&operation.file_id) {
                continue;
            }
            let entry = next
                .entries
                .iter()
                .find(|entry| entry.id == operation.file_id);
            match pending_operations::decide(operation, entry) {
                pending_operations::RecoveryDecision::Keep => {}
                pending_operations::RecoveryDecision::Resolve => {
                    resolved_ids.push(operation.file_id.clone())
                }
                pending_operations::RecoveryDecision::RemoveEntry => {
                    next.entries.retain(|entry| entry.id != operation.file_id);
                    resolved_ids.push(operation.file_id.clone());
                }
            }
        }
        drop(active);
        let changed = next.entries != current.entries;
        if changed {
            next.revision = current.revision.saturating_add(1);
            save_index_document(
                &index_path,
                &next.entries,
                &next.groups,
                &next.undo_log,
                next.revision,
            )?;
        }
        if !resolved_ids.is_empty() {
            // 索引已提交时先发布。日志清理失败可重复恢复，不反写旧索引。
            if changed {
                self.replace_state(next.clone())?;
            }
            let resolved_id_set = resolved_ids
                .iter()
                .map(String::as_str)
                .collect::<HashSet<_>>();
            next.pending_operations
                .retain(|operation| !resolved_id_set.contains(operation.file_id.as_str()));
            let pending_path = self.pending_operations_path()?;
            save_pending_operations(&pending_path, &next.pending_operations)?;
        }
        if changed || !resolved_ids.is_empty() {
            self.replace_state(next)?;
        }
        Ok(changed || !resolved_ids.is_empty())
    }

    pub fn prepare_delete(&self, file_id: &str, path: &Path) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let mut next = self.state_snapshot()?;
        let entry = next
            .entries
            .iter()
            .find(|entry| {
                entry.id == file_id
                    && crate::filesystem::same_path(&entry.path, &path.to_string_lossy())
            })
            .cloned()
            .ok_or(StorageError::EntryNotFound)?;
        if next
            .pending_operations
            .iter()
            .any(|operation| operation.file_id == entry.id)
        {
            return Err(StorageError::Recovery);
        }
        let (_, metadata) = crate::filesystem::operations::validate_indexed_file(&entry)
            .map_err(|_| StorageError::SourceChanged)?;
        let source = pending_operations::SourceSnapshot::capture(&entry, &metadata)?;
        next.pending_operations.push(PendingOperation {
            file_id: entry.id,
            operation: "delete-original".to_string(),
            path: path.to_string_lossy().into_owned(),
            state: "prepared".to_string(),
            created_at: current_timestamp_millis(),
            source: Some(source),
        });
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &next.pending_operations)?;
        self.replace_state(next)?;
        Ok(())
    }

    pub fn mark_delete_complete(&self, file_id: &str) -> Result<(), StorageError> {
        self.update_pending_delete(file_id, "physical-complete")
    }

    pub fn clear_pending_delete(&self, file_id: &str) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let mut next = self.state_snapshot()?;
        next.pending_operations
            .retain(|operation| operation.file_id != file_id);
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &next.pending_operations)?;
        self.replace_state(next)?;
        Ok(())
    }

    fn update_pending_delete(&self, file_id: &str, next_state: &str) -> Result<(), StorageError> {
        let _guard = self.mutation_lock.lock().map_err(|_| StorageError::State)?;
        let mut next = self.state_snapshot()?;
        let Some(operation) = next
            .pending_operations
            .iter_mut()
            .find(|operation| operation.file_id == file_id)
        else {
            return Err(StorageError::Recovery);
        };
        operation.state = next_state.to_string();
        let pending_path = self.pending_operations_path()?;
        save_pending_operations(&pending_path, &next.pending_operations)?;
        self.replace_state(next)?;
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

#[cfg(test)]
pub fn load_entries(path: &Path) -> Result<Vec<IndexEntry>, StorageError> {
    let (entries, _, _, _) = load_index_document(path)?;
    Ok(entries)
}

fn load_index_document(path: &Path) -> Result<IndexDocumentParts, StorageError> {
    let (entries, groups, undo_log, revision, needs_save) = read_index_document(path)?;
    if needs_save {
        if !backup_file(path, AppDataFile::Index) {
            return Err(StorageError::Write);
        }
        save_index_document(path, &entries, &groups, &undo_log, revision)?;
    }
    Ok((entries, groups, undo_log, revision))
}

fn read_index_document(path: &Path) -> Result<ReadIndexDocument, StorageError> {
    let Some(bytes) = app_data::read(path, AppDataFile::Index).map_err(map_app_data_read_error)?
    else {
        return Ok((Vec::new(), Vec::new(), Vec::new(), 0, false));
    };
    let document =
        serde_json::from_slice::<IndexDocument>(&bytes).map_err(|_| StorageError::Corrupt)?;
    let mut entries = document.entries;
    let mut groups = document.groups;
    let mut undo_log = document.undo_log;
    let revision = document.revision;
    let needs_save = match document.version {
        INDEX_FORMAT_VERSION => {
            let entries_changed = normalize_entries(&mut entries, &groups)?;
            let groups_changed = normalize_groups(&mut groups)?;
            let undo_changed = normalize_undo_log(&mut undo_log);
            entries_changed || groups_changed || undo_changed
        }
        LEGACY_INDEX_FORMAT_VERSION | 2 | 3 | PREVIOUS_INDEX_FORMAT_VERSION => {
            normalize_entries(&mut entries, &groups)?;
            normalize_groups(&mut groups)?;
            normalize_undo_log(&mut undo_log);
            true
        }
        _ => return Err(StorageError::UnsupportedVersion),
    };
    validate_groups(&groups)?;
    validate_entries(&entries, &groups)?;
    validate_undo_log(&undo_log, &entries, &groups)?;
    if revision > i64::MAX as u64 {
        return Err(StorageError::Corrupt);
    }
    Ok((entries, groups, undo_log, revision, needs_save))
}

#[cfg(test)]
pub fn save_entries(path: &Path, entries: &[IndexEntry]) -> Result<(), StorageError> {
    save_index_document(path, entries, &[], &[], 0)
}

fn save_index_document(
    path: &Path,
    entries: &[IndexEntry],
    groups: &[Group],
    undo_log: &[UndoRecord],
    revision: u64,
) -> Result<(), StorageError> {
    validate_groups(groups)?;
    validate_entries(entries, groups)?;
    validate_undo_log(undo_log, entries, groups)?;
    let document = IndexDocument {
        version: INDEX_FORMAT_VERSION,
        revision,
        entries: entries.to_vec(),
        groups: groups.to_vec(),
        undo_log: undo_log.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| StorageError::Write)?;
    app_data::write(path, AppDataFile::Index, &encoded).map_err(|_| StorageError::Write)
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
    let mut path_positions = HashMap::with_capacity(entries.len());
    for (position, entry) in entries.iter().enumerate() {
        path_positions
            .entry(crate::filesystem::path_identity(&entry.path))
            .or_insert(position);
    }
    let mut incoming = incoming.into_iter();
    for input_index in 0..crate::filesystem::MAX_INDEX_ENTRIES {
        let Some(mut incoming) = incoming.next() else {
            break;
        };
        let path_key = crate::filesystem::path_identity(&incoming.path);
        let existing_position = path_positions.get(&path_key).copied();
        if let Some(existing_position) = existing_position {
            let existing = &mut entries[existing_position];
            let id = existing.id.clone();
            let favorite = existing.favorite;
            let preview_status = existing.preview_status.clone();
            let added_at = existing.added_at;
            let last_recorded_at = existing.last_recorded_at;
            let last_opened_at = existing.last_opened_at;
            let tags = existing.tags.clone();
            let group_id = existing.group_id.clone();
            *existing = incoming;
            existing.id = id;
            existing.favorite = favorite;
            existing.preview_status = preview_status;
            existing.added_at = added_at;
            existing.tags = tags;
            existing.group_id = group_id;
            existing.last_recorded_at = match mode {
                IndexMergeMode::RegularImport => last_recorded_at,
                IndexMergeMode::FloatingRecord { base_recorded_at } => {
                    stats.recorded_count += 1;
                    Some(recorded_timestamp(base_recorded_at, input_index))
                }
            };
            existing.last_opened_at = last_opened_at;
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
        let position = entries.len();
        entries.push(incoming);
        path_positions.insert(path_key, position);
    }
    if incoming.next().is_some() {
        stats.truncated = true;
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

pub fn set_last_opened(
    entries: &mut [IndexEntry],
    file_id: &str,
    opened_at: i64,
) -> Result<bool, StorageError> {
    if file_id.trim().is_empty() || !(1..=MAX_TIMESTAMP_MILLIS).contains(&opened_at) {
        return Err(StorageError::InvalidId);
    }
    let entry = find_entry_mut(entries, file_id)?;
    if entry.invalid || entry.kind == "folder" {
        return Ok(false);
    }
    if entry
        .last_opened_at
        .is_some_and(|current| current >= opened_at)
    {
        return Ok(false);
    }
    entry.last_opened_at = Some(opened_at);
    Ok(true)
}

pub fn record_preview_outcome(
    entries: &mut [IndexEntry],
    file_id: &str,
    status: &str,
    opened_at: Option<i64>,
) -> Result<(bool, IndexEntry), StorageError> {
    if !is_preview_outcome_status(status) {
        return Err(StorageError::InvalidPreviewStatus);
    }
    let entry = find_entry_mut(entries, file_id)?;
    if entry.kind == "folder" {
        return Ok((false, entry.clone()));
    }
    let mut changed = false;
    if entry.preview_status != status {
        entry.preview_status = status.to_string();
        changed = true;
    }
    if status == "ready" {
        let opened_at = opened_at
            .filter(|value| (1..=MAX_TIMESTAMP_MILLIS).contains(value))
            .ok_or(StorageError::InvalidPreviewStatus)?;
        if !entry.invalid
            && entry
                .last_opened_at
                .is_none_or(|current| current < opened_at)
        {
            entry.last_opened_at = Some(opened_at);
            changed = true;
        }
    }
    Ok((changed, entry.clone()))
}

fn is_preview_outcome_status(status: &str) -> bool {
    matches!(
        status,
        "ready"
            | "unsupported"
            | "missing"
            | "permission-denied"
            | "too-large"
            | "converter-missing"
            | "parse-error"
            | "timed-out"
            | "cancelled"
    )
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

pub fn normalize_tags(tags: &[String]) -> Result<Vec<String>, StorageError> {
    let mut normalized = Vec::with_capacity(tags.len());
    for tag in tags {
        let value = tag.trim();
        if value.is_empty()
            || value.chars().count() > MAX_TAG_CHARS
            || value.chars().any(char::is_control)
        {
            return Err(StorageError::InvalidTag);
        }
        if normalized
            .iter()
            .any(|current: &String| current.eq_ignore_ascii_case(value))
        {
            continue;
        }
        normalized.push(value.to_string());
    }
    if normalized.len() > MAX_TAGS_PER_ENTRY {
        return Err(StorageError::InvalidTag);
    }
    Ok(normalized)
}

pub fn validate_group_name(name: &str) -> Result<String, StorageError> {
    let normalized = name.trim();
    if normalized.is_empty()
        || normalized.chars().count() > MAX_GROUP_NAME_CHARS
        || normalized.chars().any(char::is_control)
    {
        return Err(StorageError::InvalidGroupName);
    }
    Ok(normalized.to_string())
}

pub fn create_group(groups: &mut Vec<Group>, name: &str) -> Result<Group, StorageError> {
    if groups.len() >= MAX_GROUPS {
        return Err(StorageError::InvalidGroupName);
    }
    let normalized = validate_group_name(name)?;
    if groups
        .iter()
        .any(|group| group.name.eq_ignore_ascii_case(&normalized))
    {
        return Err(StorageError::DuplicateGroup);
    }
    let group = Group {
        id: format!("group-{}", Uuid::new_v4().simple()),
        name: normalized,
    };
    groups.push(group.clone());
    sort_groups(groups);
    Ok(group)
}

pub fn rename_group(
    groups: &mut [Group],
    group_id: &str,
    name: &str,
) -> Result<(bool, Group), StorageError> {
    if group_id.trim().is_empty() {
        return Err(StorageError::InvalidId);
    }
    let normalized = validate_group_name(name)?;
    if groups
        .iter()
        .any(|group| group.id != group_id && group.name.eq_ignore_ascii_case(&normalized))
    {
        return Err(StorageError::DuplicateGroup);
    }
    let group = groups
        .iter_mut()
        .find(|group| group.id == group_id)
        .ok_or(StorageError::GroupNotFound)?;
    if group.name == normalized {
        return Ok((false, group.clone()));
    }
    group.name = normalized;
    let result = group.clone();
    sort_groups(groups);
    Ok((true, result))
}

pub fn delete_group(
    entries: &mut [IndexEntry],
    groups: &mut Vec<Group>,
    group_id: &str,
) -> Result<(Group, Vec<String>), StorageError> {
    if group_id.trim().is_empty() {
        return Err(StorageError::InvalidId);
    }
    let position = groups
        .iter()
        .position(|group| group.id == group_id)
        .ok_or(StorageError::GroupNotFound)?;
    let removed = groups.remove(position);
    let mut changed_ids = Vec::new();
    for entry in entries
        .iter_mut()
        .filter(|entry| entry.group_id.as_deref() == Some(group_id))
    {
        entry.group_id = None;
        changed_ids.push(entry.id.clone());
    }
    Ok((removed, changed_ids))
}

pub fn set_entry_tags(
    entries: &mut [IndexEntry],
    file_id: &str,
    tags: &[String],
) -> Result<bool, StorageError> {
    let tags = normalize_tags(tags)?;
    let entry = find_entry_mut(entries, file_id)?;
    if entry.tags == tags {
        return Ok(false);
    }
    entry.tags = tags;
    Ok(true)
}

pub fn set_entry_group(
    entries: &mut [IndexEntry],
    groups: &[Group],
    file_id: &str,
    group_id: Option<&str>,
) -> Result<bool, StorageError> {
    if let Some(group_id) = group_id {
        if group_id.trim().is_empty() {
            return Err(StorageError::InvalidId);
        }
        if !groups.iter().any(|group| group.id == group_id) {
            return Err(StorageError::GroupNotFound);
        }
    }
    let entry = find_entry_mut(entries, file_id)?;
    if entry.group_id.as_deref() == group_id {
        return Ok(false);
    }
    entry.group_id = group_id.map(str::to_string);
    Ok(true)
}

fn find_entry_mut<'a>(
    entries: &'a mut [IndexEntry],
    file_id: &str,
) -> Result<&'a mut IndexEntry, StorageError> {
    if file_id.trim().is_empty() {
        return Err(StorageError::InvalidId);
    }
    entries
        .iter_mut()
        .find(|entry| entry.id == file_id)
        .ok_or(StorageError::EntryNotFound)
}

fn sort_groups(groups: &mut [Group]) {
    groups.sort_by(|left, right| {
        left.name
            .to_lowercase()
            .cmp(&right.name.to_lowercase())
            .then_with(|| left.id.cmp(&right.id))
    });
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

fn normalize_entries(
    entries: &mut Vec<IndexEntry>,
    groups: &[Group],
) -> Result<bool, StorageError> {
    let mut changed = normalize_added_at(entries);
    for entry in entries.iter_mut() {
        if entry.preview_status == "loading" {
            entry.preview_status = "idle".to_string();
            changed = true;
        }
        if entry.last_recorded_at.is_some_and(|value| value <= 0) {
            entry.last_recorded_at = None;
            changed = true;
        }
        if entry.last_opened_at.is_some_and(|value| value <= 0) {
            entry.last_opened_at = None;
            changed = true;
        }
        if entry.invalid && entry.status != "路径失效" {
            entry.status = "路径失效".to_string();
            changed = true;
        } else if !entry.invalid && entry.status == "路径失效" {
            entry.invalid = true;
            changed = true;
        }
        let normalized_tags = normalize_tags(&entry.tags)?;
        if entry.tags != normalized_tags {
            entry.tags = normalized_tags;
            changed = true;
        }
        if entry
            .group_id
            .as_ref()
            .is_some_and(|group_id| !groups.iter().any(|group| &group.id == group_id))
        {
            entry.group_id = None;
            changed = true;
        }
    }
    changed |= deduplicate_entries(entries);
    validate_entries(entries, groups)?;
    Ok(changed)
}

fn normalize_groups(groups: &mut Vec<Group>) -> Result<bool, StorageError> {
    let mut changed = false;
    for group in groups.iter_mut() {
        let normalized = validate_group_name(&group.name)?;
        if group.name != normalized {
            group.name = normalized;
            changed = true;
        }
    }
    let before = groups.to_vec();
    sort_groups(groups);
    if before != *groups {
        changed = true;
    }
    validate_groups(groups)?;
    Ok(changed)
}

fn normalize_undo_log(records: &mut [UndoRecord]) -> bool {
    let mut changed = false;
    for record in records {
        for change in &mut record.entries {
            for entry in [&mut change.before, &mut change.after] {
                if entry
                    .as_ref()
                    .is_some_and(|value| value.preview_status == "loading")
                {
                    if let Some(value) = entry.as_mut() {
                        value.preview_status = "idle".to_string();
                        changed = true;
                    }
                }
            }
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

fn deduplicate_entries(entries: &mut Vec<IndexEntry>) -> bool {
    let original = entries.clone();
    let mut deduplicated = Vec::with_capacity(entries.len());
    let mut id_positions: HashMap<String, usize> = HashMap::with_capacity(entries.len());
    let mut path_positions: HashMap<String, usize> = HashMap::with_capacity(entries.len());
    for entry in original {
        let path_key = crate::filesystem::path_identity(&entry.path);
        let duplicate_index = match (
            id_positions.get(&entry.id).copied(),
            path_positions.get(&path_key).copied(),
        ) {
            (Some(id_position), Some(path_position)) => Some(id_position.min(path_position)),
            (Some(position), None) | (None, Some(position)) => Some(position),
            (None, None) => None,
        };
        if let Some(index) = duplicate_index {
            merge_duplicate_metadata(&mut deduplicated[index], &entry);
        } else {
            let position = deduplicated.len();
            id_positions.insert(entry.id.clone(), position);
            path_positions.insert(path_key, position);
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
    current.last_opened_at = match (current.last_opened_at, duplicate.last_opened_at) {
        (Some(left), Some(right)) => Some(left.max(right)),
        (None, value) => value,
        (value, None) => value,
    };
    if current.preview_status == "idle" && duplicate.preview_status != "idle" {
        current.preview_status = duplicate.preview_status.clone();
    }
    for tag in &duplicate.tags {
        if !current
            .tags
            .iter()
            .any(|current_tag| current_tag.eq_ignore_ascii_case(tag))
            && current.tags.len() < MAX_TAGS_PER_ENTRY
        {
            current.tags.push(tag.clone());
        }
    }
    if current.group_id.is_none() {
        current.group_id = duplicate.group_id.clone();
    }
    if duplicate.invalid {
        current.invalid = true;
        current.status = "路径失效".to_string();
    }
}

fn validate_groups(groups: &[Group]) -> Result<(), StorageError> {
    if groups.len() > MAX_GROUPS {
        return Err(StorageError::Corrupt);
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for group in groups {
        if !is_valid_opaque_id(&group.id)
            || !ids.insert(group.id.clone())
            || validate_group_name(&group.name).is_err()
            || !names.insert(group.name.to_lowercase())
        {
            return Err(StorageError::Corrupt);
        }
    }
    Ok(())
}

fn validate_entries(entries: &[IndexEntry], groups: &[Group]) -> Result<(), StorageError> {
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
            || entry.path.len() > crate::filesystem::recursive_import::MAX_PATH_BYTES
            || !paths.insert(crate::filesystem::path_identity(&entry.path))
            || entry.name.trim().is_empty()
            || path_name != entry.name
            || entry.size > MAX_INDEXED_SIZE_BYTES
            || entry.modified_at < 0
            || entry.added_at < 0
            || entry
                .last_recorded_at
                .is_some_and(|value| !(1..=MAX_TIMESTAMP_MILLIS).contains(&value))
            || entry
                .last_opened_at
                .is_some_and(|value| !(1..=MAX_TIMESTAMP_MILLIS).contains(&value))
            || entry.modified_at > MAX_TIMESTAMP_SECONDS
            || entry.added_at > MAX_TIMESTAMP_SECONDS
            || normalize_tags(&entry.tags).map_or(true, |tags| tags != entry.tags)
            || entry
                .group_id
                .as_ref()
                .is_some_and(|group_id| !groups.iter().any(|group| &group.id == group_id))
        {
            return Err(StorageError::Corrupt);
        }
        if !matches!(entry.status.as_str(), "已登记" | "路径失效")
            || entry.invalid != (entry.status == "路径失效")
            || !matches!(
                entry.preview_status.as_str(),
                "idle"
                    | "ready"
                    | "unsupported"
                    | "missing"
                    | "permission-denied"
                    | "too-large"
                    | "converter-missing"
                    | "parse-error"
                    | "timed-out"
                    | "cancelled"
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

fn is_valid_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.contains("..")
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn validate_undo_log(
    records: &[UndoRecord],
    _entries: &[IndexEntry],
    _groups: &[Group],
) -> Result<(), StorageError> {
    if records.len() > MAX_UNDO_RECORDS {
        return Err(StorageError::Corrupt);
    }
    for record in records {
        if !is_valid_opaque_id(&record.id)
            || record.operation.trim().is_empty()
            || record.revision == 0
            || record.revision > i64::MAX as u64
            || record.created_at <= 0
            || record.entries.iter().any(|change| {
                !is_valid_opaque_id(&change.file_id)
                    || change.before.is_none() && change.after.is_none()
                    || change.before.as_ref().is_some_and(|entry| {
                        entry.id != change.file_id || validate_entry_shape(entry).is_err()
                    })
                    || change.after.as_ref().is_some_and(|entry| {
                        entry.id != change.file_id || validate_entry_shape(entry).is_err()
                    })
            })
            || record.groups.iter().any(|change| {
                !is_valid_opaque_id(&change.group_id)
                    || change.before.is_none() && change.after.is_none()
                    || change.before.as_ref().is_some_and(|group| {
                        group.id != change.group_id || validate_group_name(&group.name).is_err()
                    })
                    || change.after.as_ref().is_some_and(|group| {
                        group.id != change.group_id || validate_group_name(&group.name).is_err()
                    })
            })
        {
            return Err(StorageError::Corrupt);
        }
    }
    Ok(())
}

fn validate_entry_shape(entry: &IndexEntry) -> Result<(), StorageError> {
    let path_name = Path::new(&entry.path)
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or_default();
    if !is_valid_opaque_id(&entry.id)
        || entry.path.trim().is_empty()
        || entry.path.len() > crate::filesystem::recursive_import::MAX_PATH_BYTES
        || entry.name.trim().is_empty()
        || path_name != entry.name
        || entry.size > MAX_INDEXED_SIZE_BYTES
        || entry.modified_at < 0
        || entry.added_at < 0
        || entry.modified_at > MAX_TIMESTAMP_SECONDS
        || entry.added_at > MAX_TIMESTAMP_SECONDS
        || entry
            .last_recorded_at
            .is_some_and(|value| !(1..=MAX_TIMESTAMP_MILLIS).contains(&value))
        || entry
            .last_opened_at
            .is_some_and(|value| !(1..=MAX_TIMESTAMP_MILLIS).contains(&value))
        || normalize_tags(&entry.tags).map_or(true, |tags| tags != entry.tags)
        || !matches!(entry.status.as_str(), "已登记" | "路径失效")
        || entry.invalid != (entry.status == "路径失效")
        || !matches!(
            entry.preview_status.as_str(),
            "idle"
                | "ready"
                | "unsupported"
                | "missing"
                | "permission-denied"
                | "too-large"
                | "converter-missing"
                | "parse-error"
                | "timed-out"
                | "cancelled"
        )
    {
        return Err(StorageError::Corrupt);
    }
    Ok(())
}

fn append_undo_record(
    records: &mut Vec<UndoRecord>,
    operation: &str,
    revision: u64,
    before_entries: &[IndexEntry],
    after_entries: &[IndexEntry],
    before_groups: &[Group],
    after_groups: &[Group],
) {
    let entries = diff_entries(before_entries, after_entries);
    let groups = diff_groups(before_groups, after_groups);
    if entries.is_empty() && groups.is_empty() {
        return;
    }
    records.push(UndoRecord {
        id: format!("undo-{}", Uuid::new_v4().simple()),
        operation: operation.to_string(),
        revision,
        created_at: current_timestamp_millis(),
        entries,
        groups,
    });
    if records.len() > MAX_UNDO_RECORDS {
        let remove_count = records.len() - MAX_UNDO_RECORDS;
        records.drain(0..remove_count);
    }
}

fn diff_entries(before: &[IndexEntry], after: &[IndexEntry]) -> Vec<UndoEntryChange> {
    let after_by_id = after
        .iter()
        .fold(HashMap::with_capacity(after.len()), |mut index, entry| {
            index.entry(entry.id.as_str()).or_insert(entry);
            index
        });
    let before_ids = before
        .iter()
        .map(|entry| entry.id.as_str())
        .collect::<HashSet<_>>();
    let mut changes = Vec::with_capacity(before.len().min(after.len()));
    for entry in before {
        let current = after_by_id.get(entry.id.as_str()).copied();
        if current != Some(entry) {
            changes.push(UndoEntryChange {
                file_id: entry.id.clone(),
                before: Some(entry.clone()),
                after: current.cloned(),
            });
        }
    }
    for entry in after {
        if !before_ids.contains(entry.id.as_str()) {
            changes.push(UndoEntryChange {
                file_id: entry.id.clone(),
                before: None,
                after: Some(entry.clone()),
            });
        }
    }
    changes
}

fn diff_groups(before: &[Group], after: &[Group]) -> Vec<UndoGroupChange> {
    let after_by_id = after
        .iter()
        .fold(HashMap::with_capacity(after.len()), |mut index, group| {
            index.entry(group.id.as_str()).or_insert(group);
            index
        });
    let before_ids = before
        .iter()
        .map(|group| group.id.as_str())
        .collect::<HashSet<_>>();
    let mut changes = Vec::with_capacity(before.len().min(after.len()));
    for group in before {
        let current = after_by_id.get(group.id.as_str()).copied();
        if current != Some(group) {
            changes.push(UndoGroupChange {
                group_id: group.id.clone(),
                before: Some(group.clone()),
                after: current.cloned(),
            });
        }
    }
    for group in after {
        if !before_ids.contains(group.id.as_str()) {
            changes.push(UndoGroupChange {
                group_id: group.id.clone(),
                before: None,
                after: Some(group.clone()),
            });
        }
    }
    changes
}

const MAX_TIMESTAMP_SECONDS: i64 = 4_102_444_800;
const MAX_TIMESTAMP_MILLIS: i64 = MAX_TIMESTAMP_SECONDS.saturating_mul(1_000);
const MAX_INDEXED_SIZE_BYTES: u64 = 1_u64 << 50;

fn load_pending_operations(path: &Path) -> Result<Vec<PendingOperation>, StorageError> {
    pending_operations::load(path)
}

fn save_pending_operations(
    path: &Path,
    operations: &[PendingOperation],
) -> Result<(), StorageError> {
    pending_operations::save(path, operations)
}

fn backup_file(path: &Path, file_kind: AppDataFile) -> bool {
    app_data::backup(path, file_kind)
}

const MAX_PENDING_OPERATIONS: usize = 500;

fn map_app_data_read_error(error: AppDataError) -> StorageError {
    match error {
        AppDataError::TooLarge | AppDataError::Unsafe => StorageError::Corrupt,
        AppDataError::Read | AppDataError::Write | AppDataError::Directory => StorageError::Read,
    }
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
    fn migrates_versioned_index_with_a_backup_without_clearing_entries() {
        for version in [1, 2, 3, 4] {
            let path = unique_temp_path();
            let entry = sample_entry("旧资料.txt", 42);
            let mut legacy_entry = serde_json::to_value(&entry).expect("entry should serialize");
            let legacy_object = legacy_entry
                .as_object_mut()
                .expect("entry should be an object");
            legacy_object.remove("addedAt");
            legacy_object.remove("lastOpenedAt");
            legacy_entry["lastRecordedAt"] = serde_json::json!(9999);
            if version == 4 {
                legacy_entry["lastOpenedAt"] = serde_json::json!(8888);
            }
            let original = serde_json::to_vec(&serde_json::json!({
                "version": version,
                "entries": [legacy_entry]
            }))
            .expect("legacy should serialize");
            fs::write(&path, &original).expect("legacy index should be written");

            let loaded = load_entries(&path).expect("legacy index should migrate");

            assert_eq!(loaded[0].added_at, 42);
            assert_eq!(loaded[0].last_recorded_at, Some(9999));
            assert_eq!(loaded[0].last_opened_at, (version == 4).then_some(8888));
            let migrated: serde_json::Value =
                serde_json::from_slice(&fs::read(&path).expect("migrated index should exist"))
                    .expect("migrated index should be valid JSON");
            assert_eq!(migrated["version"], INDEX_FORMAT_VERSION);
            assert_eq!(migrated["entries"][0]["addedAt"], 42);
            assert_eq!(
                migrated["entries"][0]["lastRecordedAt"],
                serde_json::json!(9999)
            );
            if version == 4 {
                assert_eq!(migrated["entries"][0]["lastOpenedAt"], 8888);
            }
            let backup_matches =
                fs::read_dir(path.parent().expect("temp path should have a parent"))
                    .expect("backup directory should be readable")
                    .flatten()
                    .filter(|item| {
                        item.file_name().to_string_lossy().starts_with(&format!(
                            "{}.recovery-",
                            path.file_name()
                                .expect("temp path should have a name")
                                .to_string_lossy()
                        ))
                    })
                    .collect::<Vec<_>>();
            assert!(!backup_matches.is_empty());
            assert!(backup_matches.iter().any(|item| {
                fs::read(item.path())
                    .map(|bytes| bytes == original)
                    .unwrap_or(false)
            }));
            cleanup_recovery_artifacts(&path);
        }
    }

    #[test]
    fn records_only_successful_file_opens_and_keeps_the_timestamp_monotonic() {
        let mut entries = vec![sample_entry("可打开.txt", 42)];
        assert!(super::set_last_opened(&mut entries, "可打开.txt", 1_000).unwrap());
        assert_eq!(entries[0].last_opened_at, Some(1_000));
        assert!(!super::set_last_opened(&mut entries, "可打开.txt", 999).unwrap());
        assert!(!super::set_last_opened(&mut entries, "可打开.txt", 1_000).unwrap());

        entries[0].invalid = true;
        assert!(!super::set_last_opened(&mut entries, "可打开.txt", 2_000).unwrap());
        entries[0].invalid = false;
        entries[0].kind = "folder".to_string();
        assert!(!super::set_last_opened(&mut entries, "可打开.txt", 2_000).unwrap());
    }

    #[test]
    fn records_preview_status_and_last_opened_at_as_one_entry_mutation() {
        let mut entries = vec![sample_entry("预览资料.txt", 42)];
        let (changed, entry) =
            super::record_preview_outcome(&mut entries, "预览资料.txt", "ready", Some(2_000))
                .expect("preview outcome should be recorded");
        assert!(changed);
        assert_eq!(entry.preview_status, "ready");
        assert_eq!(entry.last_opened_at, Some(2_000));

        let (changed, _) =
            super::record_preview_outcome(&mut entries, "预览资料.txt", "ready", Some(2_000))
                .expect("duplicate preview outcome should be accepted");
        assert!(!changed);
        assert!(matches!(
            super::record_preview_outcome(&mut entries, "预览资料.txt", "loading", None),
            Err(StorageError::InvalidPreviewStatus)
        ));
        let (changed, entry) =
            super::record_preview_outcome(&mut entries, "预览资料.txt", "cancelled", None)
                .expect("cancelled preview outcome should be recorded");
        assert!(changed);
        assert_eq!(entry.preview_status, "cancelled");
        assert_eq!(entry.last_opened_at, Some(2_000));
    }

    #[test]
    fn rejects_stale_preview_outcomes_without_changing_the_index() {
        let index_path = unique_temp_path();
        let state = AppState::default();
        state
            .initialize(index_path.clone())
            .expect("state should initialize");
        let entry = sample_entry("过期预览.txt", 42);
        state
            .update_entries_with(|entries| {
                entries.push(entry.clone());
                Ok((true, ()))
            })
            .expect("entry should be saved");
        let outcome = state
            .record_preview_outcome("过期预览.txt", "ready", 1, Some(2_000), || true)
            .expect("preview outcome should be saved");
        assert_eq!(outcome.revision, 2);
        assert_eq!(outcome.value.as_ref().unwrap().preview_status, "ready");
        state
            .update_entries_with(|entries| {
                entries[0].path = "C:\\资料\\relocated.txt".to_string();
                entries[0].name = "relocated.txt".to_string();
                Ok((true, ()))
            })
            .expect("source should change");
        assert!(matches!(
            state.record_preview_outcome("过期预览.txt", "parse-error", 1, None, || true),
            Err(StorageError::PreviewRevisionConflict)
        ));
        let snapshot = state.snapshot().expect("snapshot should remain readable");
        assert_eq!(snapshot.revision, 3);
        assert_eq!(snapshot.entries[0].preview_status, "ready");
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn normalizes_an_interrupted_loading_preview_to_idle() {
        let path = unique_temp_path();
        let mut entry = sample_entry("中断预览.txt", 42);
        entry.preview_status = "loading".to_string();
        let document = serde_json::json!({
            "version": INDEX_FORMAT_VERSION,
            "entries": [entry]
        });
        fs::write(
            &path,
            serde_json::to_vec(&document).expect("index should serialize"),
        )
        .expect("index should be written");

        let loaded = load_entries(&path).expect("loading state should recover");
        assert_eq!(loaded[0].preview_status, "idle");
        let persisted: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("index should persist"))
                .expect("persisted index should be valid");
        assert_eq!(persisted["entries"][0]["previewStatus"], "idle");
        cleanup_recovery_artifacts(&path);
    }

    #[test]
    fn floating_merge_preserves_user_fields_and_orders_millisecond_records() {
        let mut existing = sample_entry("资料.txt", 20);
        existing.favorite = true;
        existing.added_at = 11;
        existing.preview_status = "ready".to_string();
        existing.last_recorded_at = Some(100);
        existing.last_opened_at = Some(700);
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
        assert_eq!(entries[0].last_opened_at, Some(700));

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
    fn handles_twenty_thousand_entry_diff_and_merge_with_bounded_lookups() {
        let mut before = (0..20_000)
            .map(|index| sample_entry(&format!("批量-{index}.txt"), index as i64))
            .collect::<Vec<_>>();
        let mut after = before.clone();
        for entry in after.iter_mut().take(500) {
            entry.favorite = true;
            entry.size = 2;
        }

        let changes = super::diff_entries(&before, &after);
        assert_eq!(changes.len(), 500);
        assert!(changes.iter().all(|change| change.after.is_some()));

        let incoming = after.into_iter().map(|mut entry| {
            entry.modified_at = entry.modified_at.saturating_add(1);
            entry
        });
        let stats = merge_index_entries(&mut before, incoming, IndexMergeMode::RegularImport);
        assert_eq!(stats.added_count, 0);
        assert_eq!(stats.refreshed_count, 20_000);
        assert_eq!(stats.accepted_count, 20_000);
        assert_eq!(before.len(), 20_000);
        assert_eq!(before.iter().filter(|entry| entry.size == 2).count(), 500);
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
        let before = state.snapshot().expect("state should be readable");
        fs::remove_dir_all(&root).expect("test directory should be removable");

        let result = state.update_entries(|entries| {
            entries.push(sample_entry("不会写入.txt", 1));
            Ok(true)
        });

        assert!(matches!(result, Err(StorageError::Write)));
        assert_eq!(
            state.snapshot().expect("state should remain readable"),
            before
        );
    }

    #[test]
    fn returns_entries_groups_undo_and_revision_from_one_commit() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("同点快照.txt");
        fs::write(&source_path, "内容").expect("source should be written");
        let entry = crate::filesystem::index_selected_path(&source_path.to_string_lossy())
            .expect("source should be indexable");
        let state = AppState::default();
        state
            .initialize(index_path.clone())
            .expect("state should initialize");

        let initial = state.snapshot().expect("initial snapshot should load");
        assert_eq!(initial.revision, 0);
        assert!(initial.entries.is_empty());
        assert!(initial.groups.is_empty());
        assert!(initial.undo.is_none());

        state
            .update_entries(|entries| {
                entries.push(entry.clone());
                Ok(true)
            })
            .expect("entry should be saved");
        let after_entry = state.snapshot().expect("entry snapshot should load");
        assert_eq!(after_entry.revision, 1);
        assert_eq!(after_entry.entries, vec![entry]);
        assert!(after_entry.groups.is_empty());
        assert!(after_entry.undo.is_none());

        state
            .update_index_with_undo("group-create", |_entries, groups| {
                let group = super::create_group(groups, "项目").expect("group should be valid");
                Ok((true, group))
            })
            .expect("group should be saved");
        let committed = state.snapshot().expect("committed snapshot should load");
        assert_eq!(committed.revision, 2);
        assert_eq!(committed.entries, after_entry.entries);
        assert_eq!(committed.groups.len(), 1);
        assert_eq!(committed.undo.as_ref().map(|undo| undo.count), Some(1));

        let persisted: serde_json::Value = serde_json::from_slice(
            &fs::read(&index_path).expect("persisted index should be readable"),
        )
        .expect("persisted index should be valid JSON");
        assert_eq!(persisted["revision"], 2);
        assert_eq!(persisted["entries"].as_array().map(Vec::len), Some(1));
        assert_eq!(persisted["groups"].as_array().map(Vec::len), Some(1));
        assert_eq!(persisted["undoLog"].as_array().map(Vec::len), Some(1));

        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn failed_group_commit_keeps_the_complete_previous_snapshot() {
        let root = unique_temp_path().with_extension("");
        fs::create_dir_all(&root).expect("test directory should be created");
        let index_path = root.join("index.json");
        let state = AppState::default();
        state
            .initialize(index_path)
            .expect("state should initialize");
        state
            .update_index_with_undo("group-create", |_entries, groups| {
                let group = super::create_group(groups, "原分组").expect("group should be valid");
                Ok((true, group))
            })
            .expect("group should be saved");
        let before = state.snapshot().expect("state should be readable");
        fs::remove_dir_all(&root).expect("test directory should be removable");

        let failed = state.update_index_with_undo("group-rename", |_entries, groups| {
            groups[0].name = "新分组".to_string();
            Ok((true, ()))
        });

        assert!(matches!(failed, Err(StorageError::Write)));
        assert_eq!(
            state.snapshot().expect("state should remain readable"),
            before
        );
    }

    #[test]
    fn favorite_update_preserves_the_entry_identity_and_user_metadata() {
        let mut entry = sample_entry("收藏资料.md", 12);
        entry.added_at = 7;
        entry.last_recorded_at = Some(99);
        entry.last_opened_at = Some(199);
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
        assert_eq!(entries[0].last_opened_at, original.last_opened_at);
        assert_eq!(entries[0].preview_status, original.preview_status);
    }

    #[test]
    fn validates_and_clears_group_metadata_without_touching_entry_identity() {
        let mut groups = Vec::new();
        let group = super::create_group(&mut groups, "项目 A").expect("group should be created");
        let mut entry = sample_entry("带标签.txt", 12);
        let original_id = entry.id.clone();
        assert!(super::set_entry_tags(
            std::slice::from_mut(&mut entry),
            &original_id,
            &["重点".to_string(), "工作".to_string()]
        )
        .expect("tags should be updated"));
        assert!(super::set_entry_group(
            std::slice::from_mut(&mut entry),
            &groups,
            &original_id,
            Some(&group.id)
        )
        .expect("group should be assigned"));
        assert_eq!(entry.tags, vec!["重点".to_string(), "工作".to_string()]);
        assert_eq!(entry.group_id.as_deref(), Some(group.id.as_str()));

        let (removed, changed_ids) =
            super::delete_group(std::slice::from_mut(&mut entry), &mut groups, &group.id)
                .expect("group should be deleted");
        assert_eq!(removed, group);
        assert_eq!(changed_ids, vec![original_id]);
        assert!(entry.group_id.is_none());
        assert_eq!(entry.tags, vec!["重点".to_string(), "工作".to_string()]);
    }

    #[test]
    fn migrates_missing_group_fields_to_empty_metadata() {
        let path = unique_temp_path();
        let entry = sample_entry("无标签.txt", 42);
        let legacy = serde_json::json!({ "version": 3, "entries": [entry] });
        fs::write(
            &path,
            serde_json::to_vec(&legacy).expect("legacy should serialize"),
        )
        .expect("legacy index should be written");
        let loaded = load_entries(&path).expect("legacy index should migrate");
        assert!(loaded[0].tags.is_empty());
        assert!(loaded[0].group_id.is_none());
        let migrated: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("migrated index should exist"))
                .expect("migrated index should be valid JSON");
        assert_eq!(migrated["version"], INDEX_FORMAT_VERSION);
        assert_eq!(migrated["groups"], serde_json::json!([]));
        let _ = fs::remove_file(path);
    }

    #[test]
    fn persists_undo_for_reversible_changes_and_rejects_stale_revisions() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("撤销资料.txt");
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
        let changed = state
            .update_index_with_undo("favorite", |entries, _groups| {
                let changed = super::set_favorite(entries, &entry.id, true)?;
                Ok((changed, ()))
            })
            .expect("favorite should be saved with undo");
        assert_eq!(changed.revision, 2);
        assert!(state
            .snapshot()
            .expect("snapshot should load")
            .undo
            .is_some());

        let undone = state.undo_last().expect("favorite should be undoable");
        assert_eq!(undone.value, vec![entry.id.clone()]);
        assert!(!state.snapshot().expect("snapshot should load").entries[0].favorite);
        assert!(state
            .snapshot()
            .expect("snapshot should load")
            .undo
            .is_none());
        assert!(matches!(
            state.undo_last(),
            Err(StorageError::UndoUnavailable)
        ));

        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn does_not_undo_after_a_later_index_revision() {
        let index_path = unique_temp_path();
        let source_path = index_path.with_file_name("过期撤销.txt");
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
        state
            .update_index_with_undo("tags", |entries, _groups| {
                let changed = super::set_entry_tags(entries, &entry.id, &["稍后".to_string()])?;
                Ok((changed, ()))
            })
            .expect("tags should be saved with undo");
        state
            .update_entries(|entries| {
                entries[0].preview_status = "ready".to_string();
                Ok(true)
            })
            .expect("later index change should be saved");
        assert!(matches!(
            state.undo_last(),
            Err(StorageError::UndoUnavailable)
        ));

        let _ = fs::remove_file(source_path);
        let _ = fs::remove_file(index_path);
    }

    #[test]
    fn deduplicates_ids_and_paths_deterministically_while_preserving_user_fields() {
        let path = unique_temp_path();
        let first = sample_entry("重复.txt", 10);
        let mut duplicate = first.clone();
        duplicate.favorite = true;
        duplicate.last_recorded_at = Some(99);
        duplicate.last_opened_at = Some(199);
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
        assert_eq!(loaded[0].last_opened_at, Some(199));
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
            .entries
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
            .entries
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
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
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
