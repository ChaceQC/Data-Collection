use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex, RwLock,
    },
    time::UNIX_EPOCH,
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{filesystem, preview};

use super::{
    app_data::{self, AppDataError, AppDataFile},
    content_limits::{validate_entry, validate_text, MAX_CONTENT_INDEX_FILE_BYTES},
    content_query::{ContentQueryPool, ContentQueryTicket},
    content_search::{self, ContentSearchResult},
};

pub use super::content_limits::{
    MAX_CONTENT_FILE_BYTES, MAX_CONTENT_INDEX_BYTES, MAX_CONTENT_INDEX_ENTRIES,
};
pub const MAX_CONTENT_QUERY_CHARS: usize = 256;

#[path = "content_persistence.rs"]
mod persistence;
#[cfg(test)]
#[path = "content_regression_tests.rs"]
mod regression_tests;
#[path = "content_sync.rs"]
mod sync;
#[cfg(test)]
#[path = "content_index_tests.rs"]
mod tests;

use persistence::{backup_file, load_document, save_document};
#[path = "content_queue.rs"]
mod queue;
#[path = "content_types.rs"]
mod types;
use queue::ContentSyncQueue;
pub(crate) use types::ContentDocument;
pub use types::{ContentIndexError, ContentIndexStatus, ContentSearchSnapshot, ContentSyncResult};

pub(crate) type ContentDocuments = HashMap<String, Arc<ContentDocument>>;

#[derive(Clone, Debug)]
pub struct ContentIndexState {
    path: Arc<Mutex<Option<PathBuf>>>,
    snapshot: Arc<RwLock<Arc<ContentIndexSnapshot>>>,
    mutation_lock: Arc<Mutex<()>>,
    sync_queue: Arc<Mutex<ContentSyncQueue>>,
    mutation_epoch: Arc<AtomicU64>,
    pub queries: ContentQueryPool,
}

#[derive(Clone, Debug, Default)]
struct ContentIndexSnapshot {
    documents: Arc<ContentDocuments>,
    status: ContentIndexStatus,
}

impl Default for ContentIndexState {
    fn default() -> Self {
        Self {
            path: Arc::new(Mutex::new(None)),
            snapshot: Arc::new(RwLock::new(Arc::new(ContentIndexSnapshot::default()))),
            mutation_lock: Arc::new(Mutex::new(())),
            sync_queue: Arc::new(Mutex::new(ContentSyncQueue::default())),
            mutation_epoch: Arc::new(AtomicU64::new(0)),
            queries: ContentQueryPool::default(),
        }
    }
}

impl ContentIndexState {
    pub fn initialize(&self, path: PathBuf) {
        let (documents, status) = if app_data::ensure_parent(&path).is_err() {
            (
                HashMap::new(),
                make_status(
                    "unavailable",
                    0,
                    &HashMap::new(),
                    0,
                    Some("正文索引目录不可用".to_string()),
                ),
            )
        } else {
            match load_document(&path) {
                Ok(Some(document)) => {
                    let documents = document
                        .documents
                        .into_iter()
                        .map(|item| (item.file_id.clone(), Arc::new(item)))
                        .collect::<HashMap<_, _>>();
                    let status = make_status(
                        "ready",
                        document.source_revision,
                        &documents,
                        document.failed_count,
                        document.last_error,
                    );
                    (documents, status)
                }
                Ok(None) => (
                    HashMap::new(),
                    make_status("ready", 0, &HashMap::new(), 0, None),
                ),
                Err(
                    _error @ (ContentIndexError::Corrupt | ContentIndexError::UnsupportedVersion),
                ) => {
                    let backup_created = backup_file(&path);
                    let message = if backup_created {
                        "正文索引损坏，原文件已保留备份，请重建正文索引"
                    } else {
                        "正文索引损坏，请重建正文索引"
                    };
                    (
                        HashMap::new(),
                        make_status("recovery", 0, &HashMap::new(), 0, Some(message.to_string())),
                    )
                }
                Err(error) => (
                    HashMap::new(),
                    make_status(
                        "unavailable",
                        0,
                        &HashMap::new(),
                        0,
                        Some(error.to_string()),
                    ),
                ),
            }
        };
        if let Ok(mut target) = self.path.lock() {
            *target = Some(path);
        }
        if let Ok(mut target) = self.snapshot.write() {
            *target = Arc::new(ContentIndexSnapshot {
                documents: Arc::new(documents),
                status,
            });
        }
    }

    pub fn status(&self) -> Result<ContentIndexStatus, ContentIndexError> {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.status.clone())
            .map_err(|_| ContentIndexError::Unavailable)
    }

    #[cfg(test)]
    pub fn search_snapshot(
        &self,
        query: &str,
        use_regex: bool,
    ) -> Result<ContentSearchSnapshot, ContentIndexError> {
        self.search_with_check(query, use_regex, &|| Ok(()))
    }

    pub fn run_query(
        &self,
        query: &str,
        use_regex: bool,
        ticket: &ContentQueryTicket,
    ) -> Result<ContentSearchSnapshot, ContentIndexError> {
        let _scan = ticket.acquire_scan()?;
        self.search_with_check(query, use_regex, &|| ticket.check())
    }

    fn search_with_check(
        &self,
        query: &str,
        use_regex: bool,
        check: &dyn Fn() -> Result<(), ContentIndexError>,
    ) -> Result<ContentSearchSnapshot, ContentIndexError> {
        let snapshot = self
            .snapshot
            .read()
            .map_err(|_| ContentIndexError::Unavailable)?
            .clone();
        if snapshot.status.state == "recovery" {
            return Err(ContentIndexError::RecoveryRequired);
        }
        if snapshot.status.state == "unavailable" {
            return Err(ContentIndexError::Unavailable);
        }
        let results = content_search::search_checked(&snapshot.documents, query, use_regex, check)?;
        check()?;
        if self.status()?.cache_revision != snapshot.status.cache_revision {
            return Err(ContentIndexError::Stale);
        }
        Ok(ContentSearchSnapshot {
            status: snapshot.status.clone(),
            results,
        })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn sync_entries(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(
            entries,
            source_revision,
            false,
            self.mutation_epoch.load(Ordering::Acquire),
            &|| false,
        )
    }

    pub(crate) fn sync_entries_with_stop(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        epoch: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(entries, source_revision, false, epoch, should_stop)
    }

    #[cfg(test)]
    pub fn rebuild(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        let epoch = self.begin_change()?;
        self.rebuild_at(entries, source_revision, epoch, should_stop)
    }

    pub fn rebuild_at(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        epoch: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(entries, source_revision, true, epoch, should_stop)
    }

    pub fn begin_change(&self) -> Result<u64, ContentIndexError> {
        let mut queue = self
            .sync_queue
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let epoch = self.mutation_epoch.fetch_add(1, Ordering::AcqRel) + 1;
        queue.pending = None;
        self.queries.cancel_all();
        Ok(epoch)
    }

    #[cfg(test)]
    pub fn clear(&self, source_revision: u64) -> Result<ContentIndexStatus, ContentIndexError> {
        let epoch = self.begin_change()?;
        self.clear_at(source_revision, epoch)
    }

    pub fn clear_at(
        &self,
        source_revision: u64,
        epoch: u64,
    ) -> Result<ContentIndexStatus, ContentIndexError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let path = self.index_path()?;
        if epoch != self.mutation_epoch.load(Ordering::Acquire) {
            return Err(ContentIndexError::Stale);
        }
        let source_revision = source_revision.max(self.status()?.source_revision);
        if let Ok(mut queue) = self.sync_queue.lock() {
            queue.latest_revision = Some(queue.latest_revision.unwrap_or(0).max(source_revision));
        }
        let documents = HashMap::new();
        save_document(&path, source_revision, &documents, 0, None)?;
        self.replace_snapshot(ContentIndexSnapshot {
            status: make_status("ready", source_revision, &documents, 0, None),
            documents: Arc::new(documents),
        })?;
        self.status()
    }

    pub fn mark_unavailable(&self, message: &str) {
        let Ok(_guard) = self.mutation_lock.lock() else {
            return;
        };
        if let Ok(snapshot) = self.state_snapshot() {
            let mut snapshot = (*snapshot).clone();
            if snapshot.documents.is_empty() {
                snapshot.status.state = "unavailable".to_string();
            } else {
                snapshot.status.state = "ready".to_string();
            }
            snapshot.status.last_error = Some(message.to_string());
            let _ = self.replace_snapshot(snapshot);
        }
    }

    fn index_path(&self) -> Result<PathBuf, ContentIndexError> {
        self.path
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?
            .clone()
            .ok_or(ContentIndexError::Unavailable)
    }

    fn state_snapshot(&self) -> Result<Arc<ContentIndexSnapshot>, ContentIndexError> {
        self.snapshot
            .read()
            .map_err(|_| ContentIndexError::Unavailable)
            .map(|snapshot| snapshot.clone())
    }

    fn replace_snapshot(
        &self,
        mut snapshot: ContentIndexSnapshot,
    ) -> Result<(), ContentIndexError> {
        let mut target = self
            .snapshot
            .write()
            .map_err(|_| ContentIndexError::Unavailable)?;
        snapshot.status.cache_revision = target.status.cache_revision.saturating_add(1);
        self.queries.cancel_all();
        *target = Arc::new(snapshot);
        Ok(())
    }
}

fn make_status(
    state: &str,
    source_revision: u64,
    documents: &ContentDocuments,
    failed_count: usize,
    last_error: Option<String>,
) -> ContentIndexStatus {
    ContentIndexStatus {
        state: state.to_string(),
        indexed_count: documents.len(),
        total_bytes: documents
            .values()
            .map(|document| document.content.len() as u64)
            .sum(),
        failed_count,
        source_revision,
        cache_revision: 0,
        last_error,
    }
}
