//! 删除日志 v2：先记录意图，再保存物理结果；索引持久化后才清理日志。

use super::{app_data, AppDataFile, PendingDocument, PendingOperation, StorageError};
use crate::filesystem::{self, operations, IndexEntry};
use serde::{Deserialize, Serialize};
use std::{fs, io, path::Path, time::UNIX_EPOCH};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct SourceSnapshot {
    added_at: i64,
    indexed_size: u64,
    indexed_modified_at: i64,
    size: u64,
    modified_nanos: u64,
    created_nanos: Option<u64>,
}

impl SourceSnapshot {
    pub(crate) fn capture(
        entry: &IndexEntry,
        metadata: &fs::Metadata,
    ) -> Result<Self, StorageError> {
        let nanos = |time: std::time::SystemTime| {
            time.duration_since(UNIX_EPOCH)
                .ok()
                .and_then(|value| u64::try_from(value.as_nanos()).ok())
        };
        Ok(Self {
            added_at: entry.added_at,
            indexed_size: entry.size,
            indexed_modified_at: entry.modified_at,
            size: metadata.len(),
            modified_nanos: metadata
                .modified()
                .ok()
                .and_then(nanos)
                .ok_or(StorageError::SourceChanged)?,
            created_nanos: metadata.created().ok().and_then(nanos),
        })
    }

    fn matches(&self, other: &Self) -> bool {
        self.size == other.size
            && self.modified_nanos == other.modified_nanos
            && self.created_nanos == other.created_nanos
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum RecoveryDecision {
    Keep,
    Resolve,
    RemoveEntry,
}

pub(crate) fn decide(operation: &PendingOperation, entry: Option<&IndexEntry>) -> RecoveryDecision {
    let Some(entry) = entry else {
        return RecoveryDecision::Resolve;
    };
    if !filesystem::same_path(&entry.path, &operation.path)
        || operation
            .source
            .as_ref()
            .is_some_and(|source| source.added_at != entry.added_at)
    {
        return RecoveryDecision::Resolve;
    }
    // v1 没有来源快照，迁移后仍保留待核对，不推断旧操作是否成功。
    let Some(source) = &operation.source else {
        return RecoveryDecision::Keep;
    };
    match fs::symlink_metadata(&operation.path) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            if operation.state == "physical-complete"
                && entry.size == source.indexed_size
                && entry.modified_at == source.indexed_modified_at
            {
                RecoveryDecision::RemoveEntry
            } else {
                RecoveryDecision::Keep
            }
        }
        Ok(_) if operation.state == "prepared" => {
            let unchanged = operations::validate_indexed_file(entry)
                .ok()
                .and_then(|(_, metadata)| SourceSnapshot::capture(entry, &metadata).ok())
                .is_some_and(|current| source.matches(&current));
            if unchanged {
                RecoveryDecision::Resolve
            } else {
                RecoveryDecision::Keep
            }
        }
        _ => RecoveryDecision::Keep,
    }
}

pub(crate) fn load(path: &Path) -> Result<Vec<PendingOperation>, StorageError> {
    let Some(bytes) = app_data::read(path, AppDataFile::PendingOperations)
        .map_err(super::map_app_data_read_error)?
    else {
        return Ok(Vec::new());
    };
    let mut document: PendingDocument =
        serde_json::from_slice(&bytes).map_err(|_| StorageError::Corrupt)?;
    if !matches!(document.version, 1 | 2) {
        return Err(StorageError::UnsupportedVersion);
    }
    if !valid(&document.operations) {
        return Err(StorageError::Corrupt);
    }
    if document.version == 1 {
        for operation in &mut document.operations {
            operation.source = None;
        }
        if !app_data::backup(path, AppDataFile::PendingOperations) {
            return Err(StorageError::Write);
        }
        save(path, &document.operations)?;
    }
    Ok(document.operations)
}

pub(crate) fn save(path: &Path, operations: &[PendingOperation]) -> Result<(), StorageError> {
    if !valid(operations) {
        return Err(StorageError::Write);
    }
    if operations.is_empty() {
        return app_data::remove(path).map_err(|_| StorageError::Write);
    }
    let document = PendingDocument {
        version: 2,
        operations: operations.to_vec(),
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| StorageError::Write)?;
    app_data::write(path, AppDataFile::PendingOperations, &encoded).map_err(|_| StorageError::Write)
}

fn valid(operations: &[PendingOperation]) -> bool {
    let mut ids = std::collections::HashSet::new();
    operations.len() <= super::MAX_PENDING_OPERATIONS
        && operations.iter().all(|operation| {
            super::is_valid_opaque_id(&operation.file_id)
                && ids.insert(&operation.file_id)
                && operation.operation == "delete-original"
                && matches!(operation.state.as_str(), "prepared" | "physical-complete")
                && !operation.path.trim().is_empty()
                && operation.path.len() <= filesystem::recursive_import::MAX_PATH_BYTES
                && (1..=super::MAX_TIMESTAMP_MILLIS).contains(&operation.created_at)
                && operation.source.as_ref().is_none_or(|source| {
                    (0..=super::MAX_TIMESTAMP_SECONDS).contains(&source.added_at)
                        && source.size <= super::MAX_INDEXED_SIZE_BYTES
                        && source.modified_nanos > 0
                })
        })
}

#[cfg(test)]
#[path = "pending_operations_tests.rs"]
mod tests;
