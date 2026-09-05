//! 索引领域 mutation 的窄边界。

#![allow(dead_code)]

use crate::filesystem::IndexEntry;

use super::{Group, IndexMergeMode, MergeStats, StorageError};

pub(crate) fn merge(
    entries: &mut Vec<IndexEntry>,
    incoming: Vec<IndexEntry>,
    mode: IndexMergeMode,
) -> MergeStats {
    super::merge_index_entries(entries, incoming, mode)
}

pub(crate) fn set_favorite(
    entries: &mut [IndexEntry],
    file_id: &str,
    favorite: bool,
) -> Result<bool, StorageError> {
    super::set_favorite(entries, file_id, favorite)
}

pub(crate) fn set_tags(
    entries: &mut [IndexEntry],
    file_id: &str,
    tags: &[String],
) -> Result<bool, StorageError> {
    super::set_entry_tags(entries, file_id, tags)
}

pub(crate) fn set_group(
    entries: &mut [IndexEntry],
    groups: &[Group],
    file_id: &str,
    group_id: Option<&str>,
) -> Result<bool, StorageError> {
    super::set_entry_group(entries, groups, file_id, group_id)
}
