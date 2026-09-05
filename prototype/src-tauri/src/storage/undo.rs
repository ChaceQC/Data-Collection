//! 可逆索引 mutation 的领域出口。

#![allow(dead_code)]

use crate::filesystem::IndexEntry;

use super::{Group, StorageError};

pub(crate) fn diff_entries(
    before: &[IndexEntry],
    after: &[IndexEntry],
) -> Vec<(String, Option<IndexEntry>, Option<IndexEntry>)> {
    super::diff_entries(before, after)
        .into_iter()
        .map(|change| (change.file_id, change.before, change.after))
        .collect()
}

pub(crate) fn diff_groups(
    before: &[Group],
    after: &[Group],
) -> Vec<(String, Option<Group>, Option<Group>)> {
    super::diff_groups(before, after)
        .into_iter()
        .map(|change| (change.group_id, change.before, change.after))
        .collect()
}

pub(crate) fn ensure_available(error: StorageError) -> Result<(), StorageError> {
    match error {
        StorageError::UndoUnavailable | StorageError::UndoConflict => Err(error),
        other => Err(other),
    }
}
