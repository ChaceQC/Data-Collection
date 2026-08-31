use crate::filesystem::{self, IndexEntry};

use super::{
    AppState, Group, IndexMergeMode, IndexSnapshot, MergeStats, MutationResult, StorageError,
};

pub struct IndexRepository<'a> {
    state: &'a AppState,
}

#[derive(Debug)]
pub struct IndexLoadResult {
    pub snapshot: IndexSnapshot,
    pub changed: bool,
    pub changed_ids: Vec<String>,
    pub recovered_count: usize,
}

impl<'a> IndexRepository<'a> {
    pub fn new(state: &'a AppState) -> Self {
        Self { state }
    }

    pub fn snapshot(&self) -> Result<Vec<IndexEntry>, StorageError> {
        self.state.snapshot()
    }

    pub fn snapshot_with_revision(&self) -> Result<IndexSnapshot, StorageError> {
        self.state.snapshot_with_revision()
    }

    pub fn recovery_status(&self) -> Result<Option<super::IndexRecoveryStatus>, StorageError> {
        self.state.recovery_status()
    }

    pub fn update_entries_with<F, T>(&self, mutation: F) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>) -> Result<(bool, T), StorageError>,
    {
        self.state.update_entries_with(mutation)
    }

    pub fn update_index_with_undo<F, T>(
        &self,
        operation: &str,
        mutation: F,
    ) -> Result<MutationResult<T>, StorageError>
    where
        F: FnOnce(&mut Vec<IndexEntry>, &mut Vec<Group>) -> Result<(bool, T), StorageError>,
    {
        self.state.update_index_with_undo(operation, mutation)
    }

    pub fn undo_last(&self) -> Result<MutationResult<Vec<String>>, StorageError> {
        self.state.undo_last()
    }

    pub fn merge_entries(
        &self,
        incoming: Vec<IndexEntry>,
        mode: IndexMergeMode,
    ) -> Result<MutationResult<MergeStats>, StorageError> {
        self.update_entries_with(|entries| {
            let stats = super::merge_index_entries(entries, incoming, mode);
            Ok((stats.accepted_count > 0, stats))
        })
    }

    pub fn apply_refresh(
        &self,
        checked: Vec<IndexEntry>,
    ) -> Result<MutationResult<Vec<String>>, StorageError> {
        self.update_entries_with(|entries| {
            let mut changed_ids = Vec::new();
            for refreshed in checked {
                let Some(current) = entries.iter_mut().find(|entry| {
                    entry.id == refreshed.id && filesystem::same_path(&entry.path, &refreshed.path)
                }) else {
                    continue;
                };
                if filesystem::apply_refreshed_metadata(current, &refreshed) {
                    changed_ids.push(current.id.clone());
                }
            }
            let changed = !changed_ids.is_empty();
            if changed {
                super::sort_entries(entries);
            }
            Ok((changed, changed_ids))
        })
    }

    pub fn load_and_refresh(&self) -> Result<IndexLoadResult, StorageError> {
        let recovered_count = usize::from(self.state.reconcile_pending_operations()?);
        let outcome = self.update_entries_with(|entries| {
            let mut changed_ids = Vec::new();
            let mut changed = false;
            for entry in entries.iter_mut() {
                if filesystem::refresh_entry(entry) {
                    changed = true;
                    changed_ids.push(entry.id.clone());
                }
            }
            let before_sort = entries
                .iter()
                .map(|entry| entry.id.clone())
                .collect::<Vec<_>>();
            super::sort_entries(entries);
            let sorted_changed = before_sort
                != entries
                    .iter()
                    .map(|entry| entry.id.clone())
                    .collect::<Vec<_>>();
            if sorted_changed {
                changed = true;
                let additional_ids = entries
                    .iter()
                    .map(|entry| entry.id.clone())
                    .filter(|id| !changed_ids.contains(id))
                    .collect::<Vec<_>>();
                changed_ids.extend(additional_ids);
            }
            Ok((changed, changed_ids))
        })?;
        Ok(IndexLoadResult {
            snapshot: self.snapshot_with_revision()?,
            changed: outcome.changed,
            changed_ids: outcome.value,
            recovered_count,
        })
    }

    pub fn reset_index_recovery(&self) -> Result<IndexSnapshot, StorageError> {
        self.state.reset_index_recovery()
    }

    pub fn export_recovery_diagnostic(
        &self,
        destination: &std::path::Path,
    ) -> Result<(), StorageError> {
        self.state.export_recovery_diagnostic(destination)
    }

    pub fn reconcile_pending_operations(&self) -> Result<bool, StorageError> {
        self.state.reconcile_pending_operations()
    }

    pub fn prepare_delete(
        &self,
        file_id: &str,
        path: &std::path::Path,
    ) -> Result<(), StorageError> {
        self.state.prepare_delete(file_id, path)
    }

    pub fn mark_delete_complete(&self, file_id: &str) -> Result<(), StorageError> {
        self.state.mark_delete_complete(file_id)
    }

    pub fn clear_pending_delete(&self, file_id: &str) -> Result<(), StorageError> {
        self.state.clear_pending_delete(file_id)
    }
}
