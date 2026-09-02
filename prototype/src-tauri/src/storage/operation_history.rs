use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::filesystem;

pub const OPERATION_HISTORY_FORMAT_VERSION: u32 = 1;
pub const MAX_OPERATION_RECORDS: usize = 100;
const MAX_OPERATION_RESULTS: usize = 500;
const MAX_OPERATION_COUNT: usize = 20_000;
const MAX_OPERATION_REASON_CHARS: usize = 180;
const MAX_OPERATION_MESSAGE_CHARS: usize = 180;
const MAX_OPERATION_KIND_CHARS: usize = 64;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRequest {
    #[serde(default)]
    pub favorite: Option<bool>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub add: Option<bool>,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationItemRecord {
    pub id: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationRecord {
    pub id: String,
    pub operation: String,
    pub status: String,
    pub started_at: i64,
    pub finished_at: Option<i64>,
    pub total_count: usize,
    pub added_count: usize,
    pub updated_count: usize,
    #[serde(default)]
    pub invalid_count: usize,
    #[serde(default)]
    pub recovered_count: usize,
    pub success_count: usize,
    pub skipped_count: usize,
    pub failed_count: usize,
    pub results: Vec<OperationItemRecord>,
    pub retryable_ids: Vec<String>,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
    pub cancelled: bool,
    pub timed_out: bool,
    pub message: Option<String>,
    pub request: Option<OperationRequest>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OperationHistorySnapshot {
    pub records: Vec<OperationRecord>,
    pub warning: Option<String>,
}

#[derive(Debug, Error)]
pub enum OperationHistoryError {
    #[error("操作历史目录不可用")]
    DataDirectory,
    #[error("操作历史文件无法读取")]
    Read,
    #[error("操作历史文件无法写入")]
    Write,
    #[error("操作历史状态不可用")]
    State,
    #[error("操作历史文件格式损坏")]
    Corrupt,
    #[error("操作历史文件版本不受支持")]
    UnsupportedVersion,
    #[error("操作历史记录无效")]
    InvalidRecord,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct OperationHistoryDocument {
    version: u32,
    records: Vec<OperationRecord>,
}

#[derive(Debug, Default)]
pub struct OperationHistoryState {
    history_path: Mutex<Option<PathBuf>>,
    records: Mutex<Vec<OperationRecord>>,
    warning: Mutex<Option<String>>,
    mutation_lock: Mutex<()>,
}

impl OperationHistoryState {
    pub fn initialize(
        &self,
        history_path: PathBuf,
    ) -> Result<Option<String>, OperationHistoryError> {
        let parent = history_path
            .parent()
            .ok_or(OperationHistoryError::DataDirectory)?;
        fs::create_dir_all(parent).map_err(|_| OperationHistoryError::DataDirectory)?;

        let mut warning = None;
        let records = if history_path.exists() {
            match read_history(&history_path) {
                Ok(records) => records,
                Err(
                    OperationHistoryError::Corrupt
                    | OperationHistoryError::UnsupportedVersion
                    | OperationHistoryError::InvalidRecord,
                ) => {
                    let backup_created = backup_history_file(&history_path);
                    let repaired = save_history(&history_path, &[]).is_ok();
                    warning = Some(if repaired {
                        if backup_created {
                            "操作历史文件损坏，已备份并使用空历史".to_string()
                        } else {
                            "操作历史文件损坏，已使用空历史".to_string()
                        }
                    } else {
                        "操作历史文件损坏，已使用空历史；修复文件未写入".to_string()
                    });
                    Vec::new()
                }
                Err(_) => {
                    warning = Some("操作历史文件无法读取，已使用空历史".to_string());
                    Vec::new()
                }
            }
        } else {
            if save_history(&history_path, &[]).is_err() {
                warning = Some("操作历史文件无法写入，当前只保留会话内结果".to_string());
            }
            Vec::new()
        };

        *self
            .history_path
            .lock()
            .map_err(|_| OperationHistoryError::State)? = Some(history_path);
        *self
            .records
            .lock()
            .map_err(|_| OperationHistoryError::State)? = records;
        *self
            .warning
            .lock()
            .map_err(|_| OperationHistoryError::State)? = warning.clone();
        Ok(warning)
    }

    pub fn snapshot(&self) -> Result<OperationHistorySnapshot, OperationHistoryError> {
        let records = self
            .records
            .lock()
            .map_err(|_| OperationHistoryError::State)?
            .clone();
        let warning = self
            .warning
            .lock()
            .map_err(|_| OperationHistoryError::State)?
            .clone();
        Ok(OperationHistorySnapshot { records, warning })
    }

    pub fn upsert(
        &self,
        record: OperationRecord,
    ) -> Result<OperationRecord, OperationHistoryError> {
        validate_record(&record)?;
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| OperationHistoryError::State)?;
        let path = self
            .history_path
            .lock()
            .map_err(|_| OperationHistoryError::State)?
            .clone()
            .ok_or(OperationHistoryError::DataDirectory)?;
        let mut records = self
            .records
            .lock()
            .map_err(|_| OperationHistoryError::State)?
            .clone();
        if let Some(current) = records.iter_mut().find(|current| current.id == record.id) {
            *current = record.clone();
        } else {
            records.insert(0, record.clone());
        }
        records.sort_by(|left, right| {
            right
                .started_at
                .cmp(&left.started_at)
                .then_with(|| left.id.cmp(&right.id))
        });
        records.truncate(MAX_OPERATION_RECORDS);
        save_history(&path, &records)?;
        *self
            .records
            .lock()
            .map_err(|_| OperationHistoryError::State)? = records;
        *self
            .warning
            .lock()
            .map_err(|_| OperationHistoryError::State)? = None;
        Ok(record)
    }

    pub fn clear(&self) -> Result<(), OperationHistoryError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| OperationHistoryError::State)?;
        let path = self
            .history_path
            .lock()
            .map_err(|_| OperationHistoryError::State)?
            .clone()
            .ok_or(OperationHistoryError::DataDirectory)?;
        save_history(&path, &[])?;
        *self
            .records
            .lock()
            .map_err(|_| OperationHistoryError::State)? = Vec::new();
        *self
            .warning
            .lock()
            .map_err(|_| OperationHistoryError::State)? = None;
        Ok(())
    }
}

fn read_history(path: &Path) -> Result<Vec<OperationRecord>, OperationHistoryError> {
    let metadata = fs::symlink_metadata(path).map_err(|_| OperationHistoryError::Read)?;
    if filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(OperationHistoryError::Corrupt);
    }
    let bytes = fs::read(path).map_err(|_| OperationHistoryError::Read)?;
    let document = serde_json::from_slice::<OperationHistoryDocument>(&bytes)
        .map_err(|_| OperationHistoryError::Corrupt)?;
    if document.version != OPERATION_HISTORY_FORMAT_VERSION {
        return Err(OperationHistoryError::UnsupportedVersion);
    }
    if document.records.len() > MAX_OPERATION_RECORDS {
        return Err(OperationHistoryError::Corrupt);
    }
    for record in &document.records {
        validate_record(record)?;
    }
    Ok(document.records)
}

fn save_history(path: &Path, records: &[OperationRecord]) -> Result<(), OperationHistoryError> {
    if records.len() > MAX_OPERATION_RECORDS {
        return Err(OperationHistoryError::InvalidRecord);
    }
    for record in records {
        validate_record(record)?;
    }
    let document = OperationHistoryDocument {
        version: OPERATION_HISTORY_FORMAT_VERSION,
        records: records.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| OperationHistoryError::Write)?;
    let mut file = AtomicWriteFile::open(path).map_err(|_| OperationHistoryError::Write)?;
    file.as_file_mut()
        .write_all(&encoded)
        .map_err(|_| OperationHistoryError::Write)?;
    file.commit().map_err(|_| OperationHistoryError::Write)
}

fn validate_record(record: &OperationRecord) -> Result<(), OperationHistoryError> {
    if !is_valid_id(&record.id)
        || record.operation.is_empty()
        || record.operation.chars().count() > MAX_OPERATION_KIND_CHARS
        || record.operation.chars().any(char::is_control)
        || !matches!(
            record.status.as_str(),
            "in-progress" | "success" | "partial-success" | "failed" | "cancelled" | "timed-out"
        )
        || record.started_at < 0
        || record
            .finished_at
            .is_some_and(|value| value < record.started_at)
        || record.total_count > MAX_OPERATION_COUNT
        || record.added_count > record.total_count
        || record.updated_count > record.total_count
        || record.invalid_count > record.total_count
        || record.recovered_count > record.total_count.saturating_add(1)
        || record.success_count > record.total_count
        || record.skipped_count > record.total_count
        || record.failed_count > record.total_count
        || record.results.len() > MAX_OPERATION_RESULTS
        || record.retryable_ids.len() > MAX_OPERATION_RESULTS
        || record.skipped_reasons.len() > 32
    {
        return Err(OperationHistoryError::InvalidRecord);
    }

    for item in &record.results {
        if !is_valid_id(&item.id)
            || !matches!(item.status.as_str(), "success" | "skipped" | "failed")
        {
            return Err(OperationHistoryError::InvalidRecord);
        }
        if let Some(reason) = item.reason.as_deref() {
            validate_text(reason, MAX_OPERATION_REASON_CHARS)?;
        }
    }
    for id in &record.retryable_ids {
        if !is_valid_id(id) {
            return Err(OperationHistoryError::InvalidRecord);
        }
    }
    for reason in &record.skipped_reasons {
        validate_text(reason, MAX_OPERATION_REASON_CHARS)?;
    }
    if let Some(message) = record.message.as_deref() {
        validate_text(message, MAX_OPERATION_MESSAGE_CHARS)?;
    }
    if let Some(request) = record.request.as_ref() {
        if request.tags.len() > 32
            || request.tags.iter().any(|tag| {
                tag.is_empty() || tag.chars().count() > 32 || tag.chars().any(char::is_control)
            })
            || request
                .group_id
                .as_deref()
                .is_some_and(|id| !is_valid_id(id))
        {
            return Err(OperationHistoryError::InvalidRecord);
        }
    }
    Ok(())
}

fn validate_text(value: &str, max_chars: usize) -> Result<(), OperationHistoryError> {
    if value.is_empty() || value.chars().count() > max_chars || value.chars().any(char::is_control)
    {
        return Err(OperationHistoryError::InvalidRecord);
    }
    Ok(())
}

fn is_valid_id(value: &str) -> bool {
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

fn backup_history_file(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return false;
    }
    for attempt in 0..3_u32 {
        let backup = path.with_file_name(format!(
            "{}.recovery-{}.bak",
            path.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("operation-history"),
            attempt
        ));
        if !backup.exists() && fs::copy(path, backup).is_ok() {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::{
        OperationHistoryState, OperationItemRecord, OperationRecord, OperationRequest,
        MAX_OPERATION_RECORDS, OPERATION_HISTORY_FORMAT_VERSION,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    fn record(id: &str, started_at: i64) -> OperationRecord {
        OperationRecord {
            id: id.to_string(),
            operation: "batch-tags".to_string(),
            status: "partial-success".to_string(),
            started_at,
            finished_at: Some(started_at + 1),
            total_count: 2,
            added_count: 0,
            updated_count: 0,
            invalid_count: 0,
            recovered_count: 0,
            success_count: 1,
            skipped_count: 1,
            failed_count: 0,
            results: vec![
                OperationItemRecord {
                    id: "file-1".to_string(),
                    status: "success".to_string(),
                    reason: None,
                },
                OperationItemRecord {
                    id: "file-2".to_string(),
                    status: "skipped".to_string(),
                    reason: Some("标签状态未变化".to_string()),
                },
            ],
            retryable_ids: vec![],
            skipped_reasons: vec!["标签状态未变化".to_string()],
            truncated: false,
            cancelled: false,
            timed_out: false,
            message: None,
            request: Some(OperationRequest {
                favorite: None,
                tags: vec!["重点".to_string()],
                add: Some(true),
                group_id: None,
            }),
        }
    }

    #[test]
    fn persists_and_updates_bounded_operation_records_atomically() {
        let path = unique_path("operation-history.json");
        let state = OperationHistoryState::default();
        state
            .initialize(path.clone())
            .expect("history should initialize");
        state
            .upsert(record("operation-1", 1))
            .expect("record should persist");
        let mut updated = record("operation-1", 1);
        updated.status = "success".to_string();
        updated.skipped_count = 0;
        updated.success_count = 2;
        updated.results[1].status = "success".to_string();
        updated.results[1].reason = None;
        updated.skipped_reasons.clear();
        state.upsert(updated.clone()).expect("record should update");
        assert_eq!(
            state.snapshot().expect("history should load").records,
            vec![updated]
        );
        let document: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).expect("file should exist"))
                .expect("history should be JSON");
        assert_eq!(document["version"], OPERATION_HISTORY_FORMAT_VERSION);
        cleanup(path);
    }

    #[test]
    fn corrupt_history_falls_back_to_empty_history_and_keeps_a_backup() {
        let path = unique_path("operation-history-corrupt.json");
        fs::write(&path, b"not-json").expect("corrupt history should be written");
        let state = OperationHistoryState::default();
        let warning = state
            .initialize(path.clone())
            .expect("history should recover");
        assert!(warning.is_some());
        assert!(state
            .snapshot()
            .expect("history should load")
            .records
            .is_empty());
        assert!(fs::read_dir(path.parent().expect("parent should exist"))
            .expect("parent should be readable")
            .flatten()
            .any(|entry| entry
                .file_name()
                .to_string_lossy()
                .contains("operation-history-corrupt.json.recovery-")));
        cleanup(path);
    }

    #[test]
    fn keeps_only_the_newest_history_records() {
        let path = unique_path("operation-history-limit.json");
        let state = OperationHistoryState::default();
        state
            .initialize(path.clone())
            .expect("history should initialize");
        for index in 0..(MAX_OPERATION_RECORDS + 3) {
            state
                .upsert(record(&format!("operation-{index}"), index as i64 + 1))
                .expect("record should persist");
        }
        let records = state.snapshot().expect("history should load").records;
        assert_eq!(records.len(), MAX_OPERATION_RECORDS);
        assert_eq!(records[0].id, "operation-102");
        assert_eq!(
            records.last().expect("oldest record should exist").id,
            "operation-3"
        );
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
