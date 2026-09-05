//! 文件操作在锁内合并当前用户元数据；物理副作用在索引写锁之外执行。

use std::{collections::HashSet, sync::Mutex};

use crate::filesystem::{self, operations, IndexEntry};

use super::{AppState, MutationResult, StorageError};

#[derive(Debug, thiserror::Error)]
pub(crate) enum FileActionError {
    #[error(transparent)]
    Storage(#[from] StorageError),
    #[error(transparent)]
    Operation(#[from] operations::FileOperationError),
    #[error("所选路径不可访问或包含不安全的路径，请重新选择")]
    InvalidPath,
    #[error("文件已重命名，但索引未同步且无法回滚，请刷新后重新定位资料")]
    Partial,
}

pub(crate) struct FileActionGuard<'a> {
    active: &'a Mutex<HashSet<String>>,
    id: String,
}

impl Drop for FileActionGuard<'_> {
    fn drop(&mut self) {
        if let Ok(mut active) = self.active.lock() {
            active.remove(&self.id);
        }
    }
}

impl AppState {
    pub(crate) fn begin_file_action(&self, id: &str) -> Result<FileActionGuard<'_>, StorageError> {
        if id.trim().is_empty() {
            return Err(StorageError::InvalidId);
        }
        let mut active = self
            .active_file_actions
            .lock()
            .map_err(|_| StorageError::State)?;
        if !active.insert(id.to_string()) {
            return Err(StorageError::FileBusy);
        }
        Ok(FileActionGuard {
            active: &self.active_file_actions,
            id: id.to_string(),
        })
    }

    pub(crate) fn file_action_source(&self, id: &str) -> Result<(IndexEntry, u64), StorageError> {
        let snapshot = self.snapshot.read().map_err(|_| StorageError::State)?;
        let entry = snapshot
            .entries
            .iter()
            .find(|entry| entry.id == id)
            .ok_or(StorageError::EntryNotFound)?;
        Ok((
            entry.clone(),
            snapshot.source_revisions.get(id).copied().unwrap_or(0),
        ))
    }
}

pub(crate) fn reposition(
    state: &AppState,
    id: &str,
    new_path: &str,
) -> Result<MutationResult<Option<IndexEntry>>, FileActionError> {
    let _guard = state.begin_file_action(id)?;
    let (source, revision) = state.file_action_source(id)?;
    if !source.invalid {
        return Err(StorageError::RepositionNotNeeded.into());
    }
    let replacement =
        filesystem::index_selected_path(new_path).map_err(|_| FileActionError::InvalidPath)?;
    if (source.kind == "folder") != (replacement.kind == "folder") {
        return Err(StorageError::RepositionKindMismatch.into());
    }
    let (_, metadata) = operations::validate_indexed_entry(&replacement)?;
    Ok(
        state.update_index_internal(Some((id, revision)), None, |entries, _| {
            let current = entries
                .iter()
                .find(|entry| entry.id == id)
                .ok_or(StorageError::EntryNotFound)?;
            if !current.invalid
                || !filesystem::same_path(&current.path, &source.path)
                || operations::validate_indexed_entry(current).is_ok()
            {
                return Err(StorageError::RepositionNotNeeded);
            }
            operations::revalidate_indexed_entry(&replacement, &metadata)
                .map_err(|_| StorageError::SourceChanged)?;
            merge_source_metadata(entries, &source, &replacement)
        })?,
    )
}

pub(crate) fn rename(
    state: &AppState,
    id: &str,
    new_name: &str,
) -> Result<MutationResult<Option<IndexEntry>>, FileActionError> {
    rename_with_checkpoint(state, id, new_name, || {})
}

fn rename_with_checkpoint(
    state: &AppState,
    id: &str,
    new_name: &str,
    after_rename: impl FnOnce(),
) -> Result<MutationResult<Option<IndexEntry>>, FileActionError> {
    let _guard = state.begin_file_action(id)?;
    let (entry, revision) = state.file_action_source(id)?;
    let (source, metadata) = operations::validate_indexed_file(&entry)?;
    let target = operations::validate_new_name(&source, new_name)?;
    operations::rename_file(&source, &target, &metadata)?;
    after_rename();
    let outcome = (|| {
        let replacement = filesystem::index_selected_path(&target.to_string_lossy())
            .map_err(|_| FileActionError::InvalidPath)?;
        Ok(
            state.update_index_internal(Some((id, revision)), None, |entries, _| {
                operations::revalidate_indexed_file(&replacement, &metadata)
                    .map_err(|_| StorageError::SourceChanged)?;
                merge_source_metadata(entries, &entry, &replacement)
            })?,
        )
    })();
    match outcome {
        Ok(value) => Ok(value),
        Err(error) if operations::restore_renamed_file(&target, &source, &metadata) => Err(error),
        Err(_) => Err(FileActionError::Partial),
    }
}

fn merge_source_metadata(
    entries: &mut [IndexEntry],
    source: &IndexEntry,
    replacement: &IndexEntry,
) -> Result<(bool, Option<IndexEntry>), StorageError> {
    if entries
        .iter()
        .any(|entry| entry.id != source.id && filesystem::same_path(&entry.path, &replacement.path))
    {
        return Err(StorageError::DuplicateEntry);
    }
    let current = entries
        .iter_mut()
        .find(|entry| entry.id == source.id)
        .filter(|entry| {
            filesystem::same_path(&entry.path, &source.path) && entry.added_at == source.added_at
        })
        .ok_or(StorageError::SourceChanged)?;
    filesystem::apply_refreshed_metadata(current, replacement);
    current.path = replacement.path.clone();
    let result = current.clone();
    super::sort_entries(entries);
    Ok((true, Some(result)))
}

#[cfg(test)]
#[path = "file_actions_tests.rs"]
mod tests;
