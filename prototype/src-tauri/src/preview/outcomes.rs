use super::PreviewCancellation;
use crate::{
    filesystem,
    storage::{AppState, MutationResult, StorageError},
};
use std::{
    collections::HashMap,
    fs::Metadata,
    path::PathBuf,
    sync::Mutex,
    time::{Duration, Instant},
};

const MAX_OUTCOMES: usize = 64;
const OUTCOME_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Debug)]
struct Outcome {
    file_id: String,
    source_revision: u64,
    path: PathBuf,
    metadata: Metadata,
    task_id: String,
    cancellation: PreviewCancellation,
    preview_id: Option<String>,
    created_at: Instant,
    opened_at: Option<i64>,
}

#[derive(Debug, Default)]
pub(crate) struct PreviewOutcomes(Mutex<HashMap<String, Outcome>>);

#[cfg(test)]
#[path = "outcomes_tests.rs"]
mod tests;

impl PreviewOutcomes {
    pub(crate) fn begin(
        &self,
        index: &AppState,
        file_id: &str,
        task_id: &str,
        cancellation: &PreviewCancellation,
    ) -> Result<(String, PathBuf), StorageError> {
        let (entry, source_revision) = index.preview_source(file_id)?;
        let (path, metadata) = filesystem::validate_preview_file(&entry.path)
            .map_err(|_| StorageError::PreviewRevisionConflict)?;
        let mut outcomes = self.0.lock().map_err(|_| StorageError::State)?;
        outcomes.retain(|_, outcome| {
            outcome.created_at.elapsed() < OUTCOME_TTL
                && !outcome.cancellation.is_cancelled()
                && outcome.file_id != file_id
        });
        if outcomes.len() >= MAX_OUTCOMES {
            return Err(StorageError::State);
        }
        let token = format!("outcome-{}", uuid::Uuid::new_v4().simple());
        outcomes.insert(
            token.clone(),
            Outcome {
                file_id: file_id.to_string(),
                source_revision,
                path: path.clone(),
                metadata,
                task_id: task_id.to_string(),
                cancellation: cancellation.clone(),
                preview_id: None,
                created_at: Instant::now(),
                opened_at: None,
            },
        );
        Ok((token, path))
    }

    pub(crate) fn attach(&self, token: &str, preview_id: &str) -> bool {
        let Ok(mut outcomes) = self.0.lock() else {
            return false;
        };
        let Some(outcome) = outcomes.get_mut(token) else {
            return false;
        };
        if outcome.cancellation.is_cancelled() || outcome.created_at.elapsed() >= OUTCOME_TTL {
            return false;
        }
        outcome.preview_id = Some(preview_id.to_string());
        true
    }

    pub(crate) fn record(
        &self,
        index: &AppState,
        file_id: &str,
        token: &str,
        status: &str,
    ) -> Result<MutationResult<Option<filesystem::IndexEntry>>, StorageError> {
        let mut outcomes = self.0.lock().map_err(|_| StorageError::State)?;
        let outcome = outcomes
            .get_mut(token)
            .ok_or(StorageError::PreviewRevisionConflict)?;
        if outcome.file_id != file_id
            || outcome.cancellation.is_cancelled()
            || outcome.preview_id.is_none()
            || outcome.created_at.elapsed() >= OUTCOME_TTL
        {
            return Err(StorageError::PreviewRevisionConflict);
        }
        // 同一凭证的 ready 重试幂等；写入失败时保留凭证和原时间供有限重试。
        let opened_at = if status == "ready" {
            Some(
                *outcome
                    .opened_at
                    .get_or_insert_with(crate::storage::current_timestamp_millis),
            )
        } else {
            None
        };
        index.record_preview_outcome(file_id, status, outcome.source_revision, opened_at, || {
            filesystem::validate_preview_file(&outcome.path.to_string_lossy()).is_ok_and(
                |(path, metadata)| {
                    path == outcome.path
                        && filesystem::same_file_snapshot(&outcome.metadata, &metadata)
                },
            )
        })
    }

    pub(crate) fn dispose(&self, preview_id: &str) {
        if let Ok(mut outcomes) = self.0.lock() {
            outcomes.retain(|_, outcome| outcome.preview_id.as_deref() != Some(preview_id));
        }
    }

    pub(crate) fn cancel(&self, task_id: &str) {
        if let Ok(mut outcomes) = self.0.lock() {
            outcomes.retain(|_, outcome| outcome.task_id != task_id);
        }
    }

    pub(crate) fn clear(&self) {
        if let Ok(mut outcomes) = self.0.lock() {
            outcomes.clear();
        }
    }
}
