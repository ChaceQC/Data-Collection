use std::{
    collections::{HashMap, HashSet},
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{Arc, Mutex, RwLock},
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::{filesystem, preview};

use super::content_search::{self, ContentSearchError, ContentSearchResult};

pub const MAX_CONTENT_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_CONTENT_INDEX_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_CONTENT_INDEX_ENTRIES: usize = 20_000;
pub const MAX_CONTENT_QUERY_CHARS: usize = 256;

const CONTENT_INDEX_FORMAT_VERSION: u32 = 1;
const MAX_CONTENT_INDEX_FILE_BYTES: u64 = MAX_CONTENT_INDEX_BYTES + 8 * 1024 * 1024;
const MAX_CONTENT_CHARS: usize = 1_000_000;
const MAX_FAILURE_REASONS: usize = 16;

#[derive(Clone, Debug)]
pub struct ContentIndexState {
    path: Arc<Mutex<Option<PathBuf>>>,
    snapshot: Arc<RwLock<ContentIndexSnapshot>>,
    mutation_lock: Arc<Mutex<()>>,
    sync_queue: Arc<Mutex<ContentSyncQueue>>,
}

#[derive(Clone, Debug, Default)]
struct ContentIndexSnapshot {
    documents: HashMap<String, ContentDocument>,
    status: ContentIndexStatus,
}

impl Default for ContentIndexState {
    fn default() -> Self {
        Self {
            path: Arc::new(Mutex::new(None)),
            snapshot: Arc::new(RwLock::new(ContentIndexSnapshot::default())),
            mutation_lock: Arc::new(Mutex::new(())),
            sync_queue: Arc::new(Mutex::new(ContentSyncQueue::default())),
        }
    }
}

#[derive(Debug, Default)]
struct ContentSyncQueue {
    latest_revision: Option<u64>,
    pending: Option<PendingContentSync>,
    running: bool,
}

#[derive(Debug)]
struct PendingContentSync {
    source_revision: u64,
    entries: Vec<filesystem::IndexEntry>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIndexStatus {
    pub state: String,
    pub indexed_count: usize,
    pub total_bytes: u64,
    pub failed_count: usize,
    pub source_revision: u64,
    pub last_error: Option<String>,
}

impl Default for ContentIndexStatus {
    fn default() -> Self {
        Self {
            state: "unavailable".to_string(),
            indexed_count: 0,
            total_bytes: 0,
            failed_count: 0,
            source_revision: 0,
            last_error: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct ContentDocument {
    pub file_id: String,
    pub path: String,
    pub size: u64,
    #[serde(default)]
    pub modified_at_nanos: u128,
    pub modified_at: i64,
    pub content: String,
}

#[derive(Debug, Error)]
pub enum ContentIndexError {
    #[error("正文索引暂不可用")]
    Unavailable,
    #[error("正文索引需要重建")]
    RecoveryRequired,
    #[error("正文索引无法写入")]
    Write,
    #[error("正文索引无法读取")]
    Read,
    #[error("正文索引格式损坏")]
    Corrupt,
    #[error("正文索引版本不受支持")]
    UnsupportedVersion,
    #[error("搜索表达式无效")]
    InvalidQuery,
    #[error("正文索引任务已过期")]
    Stale,
}

#[derive(Debug, Default)]
pub struct ContentSyncResult {
    pub indexed_count: usize,
    pub updated_count: usize,
    pub removed_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub cancelled: bool,
    pub truncated: bool,
}

#[derive(Debug)]
pub struct ContentSearchSnapshot {
    pub status: ContentIndexStatus,
    pub results: Vec<ContentSearchResult>,
}

#[derive(Debug, Deserialize, Serialize)]
struct ContentIndexDocument {
    version: u32,
    #[serde(default)]
    source_revision: u64,
    #[serde(default)]
    documents: Vec<ContentDocument>,
    #[serde(default)]
    failed_count: usize,
    #[serde(default)]
    last_error: Option<String>,
}

impl ContentIndexState {
    pub(crate) fn enqueue_sync(
        &self,
        source_revision: u64,
        entries: Vec<filesystem::IndexEntry>,
    ) -> bool {
        let Ok(mut queue) = self.sync_queue.lock() else {
            return false;
        };
        if queue
            .latest_revision
            .is_some_and(|latest| source_revision <= latest)
        {
            return false;
        }
        queue.latest_revision = Some(source_revision);
        queue.pending = Some(PendingContentSync {
            source_revision,
            entries,
        });
        if queue.running {
            false
        } else {
            queue.running = true;
            true
        }
    }

    pub(crate) fn take_pending_sync(&self) -> Option<(u64, Vec<filesystem::IndexEntry>)> {
        self.sync_queue.lock().ok().and_then(|mut queue| {
            queue
                .pending
                .take()
                .map(|pending| (pending.source_revision, pending.entries))
        })
    }

    pub(crate) fn has_pending_sync_after(&self, source_revision: u64) -> bool {
        self.sync_queue
            .lock()
            .ok()
            .and_then(|queue| {
                queue
                    .pending
                    .as_ref()
                    .map(|pending| pending.source_revision)
            })
            .is_some_and(|pending_revision| pending_revision > source_revision)
    }

    pub(crate) fn finish_sync_worker(&self) -> bool {
        let Ok(mut queue) = self.sync_queue.lock() else {
            return false;
        };
        if queue.pending.is_some() {
            true
        } else {
            queue.running = false;
            false
        }
    }

    pub fn initialize(&self, path: PathBuf) {
        let (documents, status) = match load_document(&path) {
            Ok(Some(document)) => {
                let documents = document
                    .documents
                    .into_iter()
                    .map(|item| (item.file_id.clone(), item))
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
            Err(_error @ (ContentIndexError::Corrupt | ContentIndexError::UnsupportedVersion)) => {
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
        };
        if let Ok(mut target) = self.path.lock() {
            *target = Some(path);
        }
        if let Ok(mut target) = self.snapshot.write() {
            *target = ContentIndexSnapshot { documents, status };
        }
    }

    pub fn status(&self) -> Result<ContentIndexStatus, ContentIndexError> {
        self.snapshot
            .read()
            .map(|snapshot| snapshot.status.clone())
            .map_err(|_| ContentIndexError::Unavailable)
    }

    pub fn search_snapshot(
        &self,
        query: &str,
        use_regex: bool,
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
        let results =
            content_search::search(&snapshot.documents, query, use_regex).map_err(|error| {
                match error {
                    ContentSearchError::InvalidQuery => ContentIndexError::InvalidQuery,
                }
            })?;
        Ok(ContentSearchSnapshot {
            status: snapshot.status,
            results,
        })
    }

    #[cfg_attr(not(test), allow(dead_code))]
    pub fn sync_entries(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(entries, source_revision, false, &|| false)
    }

    pub(crate) fn sync_entries_with_stop(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(entries, source_revision, false, should_stop)
    }

    pub fn rebuild(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        self.sync_entries_internal(entries, source_revision, true, should_stop)
    }

    pub fn clear(&self, source_revision: u64) -> Result<ContentIndexStatus, ContentIndexError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let path = self.index_path()?;
        let documents = HashMap::new();
        save_document(&path, source_revision, &documents, 0, None)?;
        self.replace_snapshot(ContentIndexSnapshot {
            status: make_status("ready", source_revision, &documents, 0, None),
            documents,
        })?;
        self.status()
    }

    pub fn mark_indexing(&self) -> Result<ContentIndexStatus, ContentIndexError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let mut snapshot = self.state_snapshot()?;
        snapshot.status.state = "indexing".to_string();
        snapshot.status.last_error = None;
        self.replace_snapshot(snapshot.clone())?;
        Ok(snapshot.status)
    }

    pub fn mark_unavailable(&self, message: &str) {
        let Ok(_guard) = self.mutation_lock.lock() else {
            return;
        };
        if let Ok(mut snapshot) = self.snapshot.write() {
            snapshot.status.state = "unavailable".to_string();
            snapshot.status.last_error = Some(message.to_string());
        }
    }

    fn sync_entries_internal(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        replace_all: bool,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let current = self.state_snapshot()?;
        let current_status = current.status.clone();
        if source_revision < current_status.source_revision {
            return Err(ContentIndexError::Stale);
        }
        if should_stop() {
            return Ok(ContentSyncResult {
                cancelled: true,
                ..ContentSyncResult::default()
            });
        }
        if current_status.state == "recovery" && !replace_all {
            return Err(ContentIndexError::RecoveryRequired);
        }
        let path = self.index_path()?;
        let existing = current.documents;
        let mut next = if replace_all {
            HashMap::new()
        } else {
            existing.clone()
        };
        let mut result = ContentSyncResult::default();
        let mut source_ids = HashSet::new();
        let mut total_bytes = next
            .values()
            .map(|document| document.content.len() as u64)
            .sum();
        let mut failed_reasons = Vec::new();

        for entry in entries {
            if should_stop() {
                result.cancelled = true;
                break;
            }
            if !is_indexable_entry(entry) {
                if next.remove(&entry.id).is_some() {
                    result.removed_count += 1;
                }
                continue;
            }
            source_ids.insert(entry.id.clone());
            let previous = next.get(&entry.id).cloned();
            let (path_value, metadata) = match filesystem::validate_regular_file_path(&entry.path) {
                Ok(value) => value,
                Err(error) => {
                    remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                    record_failure(&mut result, &mut failed_reasons, path_error_reason(error));
                    continue;
                }
            };
            let modified_at_nanos = modified_timestamp_nanos(&metadata);
            let canonical_path = path_value.to_string_lossy().into_owned();
            if previous.as_ref().is_some_and(|document| {
                filesystem::same_path(&document.path, &canonical_path)
                    && document.size == metadata.len()
                    && document.modified_at_nanos == modified_at_nanos
            }) {
                continue;
            }

            let old_size = previous
                .as_ref()
                .map(|document| document.content.len() as u64)
                .unwrap_or(0);
            if content_size_exceeds_limit(total_bytes, old_size, metadata.len()) {
                remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                result.truncated = true;
                record_failure(&mut result, &mut failed_reasons, "已达到正文索引总大小上限");
                continue;
            }

            let content = match read_content(&path_value, metadata.len()) {
                Ok(content) => content,
                Err(reason) => {
                    remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                    record_failure(&mut result, &mut failed_reasons, reason);
                    continue;
                }
            };
            if content_size_exceeds_limit(total_bytes, old_size, content.len() as u64) {
                remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                result.truncated = true;
                record_failure(&mut result, &mut failed_reasons, "已达到正文索引总大小上限");
                continue;
            }
            let document = ContentDocument {
                file_id: entry.id.clone(),
                path: canonical_path,
                size: metadata.len(),
                modified_at_nanos,
                modified_at: (modified_at_nanos / 1_000_000_000).min(i64::MAX as u128) as i64,
                content,
            };
            total_bytes = total_bytes
                .saturating_sub(old_size)
                .saturating_add(document.content.len() as u64);
            if previous.is_some() {
                result.updated_count += 1;
            } else {
                result.indexed_count += 1;
            }
            next.insert(entry.id.clone(), document);
        }

        if should_stop() {
            result.cancelled = true;
        }
        if result.cancelled && replace_all {
            self.replace_snapshot(ContentIndexSnapshot {
                status: make_status(
                    "ready",
                    current_status.source_revision,
                    &existing,
                    current_status.failed_count,
                    Some("正文索引重建已取消".to_string()),
                ),
                documents: existing,
            })?;
            return Ok(result);
        }
        if !result.cancelled && !replace_all {
            next.retain(|file_id, _| source_ids.contains(file_id));
        }
        if result.cancelled {
            return Ok(result);
        }

        if should_stop() {
            result.cancelled = true;
            return Ok(result);
        }
        result.skipped_reasons = failed_reasons.into_iter().map(str::to_string).collect();
        let last_error = (result.skipped_count > 0)
            .then(|| "部分纯文本资料未能建立正文索引，请重建后重试".to_string());
        save_document(
            &path,
            source_revision,
            &next,
            result.skipped_count,
            last_error.clone(),
        )?;
        self.replace_snapshot(ContentIndexSnapshot {
            status: make_status(
                "ready",
                source_revision,
                &next,
                result.skipped_count,
                last_error,
            ),
            documents: next,
        })?;
        Ok(result)
    }

    fn index_path(&self) -> Result<PathBuf, ContentIndexError> {
        self.path
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?
            .clone()
            .ok_or(ContentIndexError::Unavailable)
    }

    fn state_snapshot(&self) -> Result<ContentIndexSnapshot, ContentIndexError> {
        self.snapshot
            .read()
            .map_err(|_| ContentIndexError::Unavailable)
            .map(|snapshot| snapshot.clone())
    }

    fn replace_snapshot(&self, snapshot: ContentIndexSnapshot) -> Result<(), ContentIndexError> {
        *self
            .snapshot
            .write()
            .map_err(|_| ContentIndexError::Unavailable)? = snapshot;
        Ok(())
    }
}

fn content_size_exceeds_limit(total_bytes: u64, old_size: u64, next_size: u64) -> bool {
    total_bytes
        .saturating_sub(old_size)
        .saturating_add(next_size)
        > MAX_CONTENT_INDEX_BYTES
}

fn is_indexable_entry(entry: &filesystem::IndexEntry) -> bool {
    if entry.invalid {
        return false;
    }
    let Some(info) = filesystem::type_info_for_path(Path::new(&entry.path)) else {
        return false;
    };
    (info.kind == "text" || info.kind == "markdown") && info.kind == entry.kind
}

fn read_content(path: &Path, byte_length: u64) -> Result<String, &'static str> {
    if byte_length > MAX_CONTENT_FILE_BYTES {
        return Err("超过正文索引单文件上限");
    }
    let file = fs::File::open(path).map_err(|_| "无法读取纯文本文件")?;
    let mut bytes = Vec::new();
    file.take(MAX_CONTENT_FILE_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取纯文本文件")?;
    if bytes.len() as u64 > MAX_CONTENT_FILE_BYTES || bytes.contains(&0) {
        return Err("文件不是可安全读取的纯文本");
    }
    let decoded = preview::text::decode(&bytes).map_err(|_| "文本编码无法可靠识别")?;
    if decoded.value.chars().count() > MAX_CONTENT_CHARS {
        return Err("超过正文索引文本长度上限");
    }
    Ok(decoded.value)
}

fn remove_document(
    documents: &mut HashMap<String, ContentDocument>,
    file_id: &str,
    total_bytes: &mut u64,
    result: &mut ContentSyncResult,
) {
    if let Some(document) = documents.remove(file_id) {
        *total_bytes = total_bytes.saturating_sub(document.content.len() as u64);
        result.removed_count += 1;
    }
}

fn record_failure(
    result: &mut ContentSyncResult,
    reasons: &mut Vec<&'static str>,
    reason: &'static str,
) {
    if reasons.len() < MAX_FAILURE_REASONS && !reasons.contains(&reason) {
        reasons.push(reason);
    }
    result.skipped_count += 1;
}

fn path_error_reason(error: filesystem::PathValidationError) -> &'static str {
    match error {
        filesystem::PathValidationError::Missing => "纯文本文件已失效",
        filesystem::PathValidationError::PermissionDenied => "没有读取纯文本文件的权限",
        filesystem::PathValidationError::Invalid => "纯文本文件路径不可用",
    }
}

fn make_status(
    state: &str,
    source_revision: u64,
    documents: &HashMap<String, ContentDocument>,
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
        last_error,
    }
}

fn load_document(path: &Path) -> Result<Option<ContentIndexDocument>, ContentIndexError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(ContentIndexError::Read),
    };
    if filesystem::is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(ContentIndexError::Corrupt);
    }
    if metadata.len() > MAX_CONTENT_INDEX_FILE_BYTES {
        return Err(ContentIndexError::Corrupt);
    }
    let bytes = fs::read(path).map_err(|_| ContentIndexError::Read)?;
    let document = serde_json::from_slice::<ContentIndexDocument>(&bytes)
        .map_err(|_| ContentIndexError::Corrupt)?;
    if document.version != CONTENT_INDEX_FORMAT_VERSION {
        return Err(ContentIndexError::UnsupportedVersion);
    }
    validate_document(&document)?;
    Ok(Some(document))
}

fn validate_document(document: &ContentIndexDocument) -> Result<(), ContentIndexError> {
    if document.documents.len() > MAX_CONTENT_INDEX_ENTRIES {
        return Err(ContentIndexError::Corrupt);
    }
    let mut ids = HashSet::new();
    let mut total_bytes = 0u64;
    for item in &document.documents {
        if !valid_id(&item.file_id)
            || item.path.is_empty()
            || item.path.len() > filesystem::recursive_import::MAX_PATH_BYTES
            || item.content.len() as u64 > MAX_CONTENT_FILE_BYTES
            || item.content.chars().count() > MAX_CONTENT_CHARS
            || !ids.insert(item.file_id.clone())
        {
            return Err(ContentIndexError::Corrupt);
        }
        total_bytes = total_bytes.saturating_add(item.content.len() as u64);
        if total_bytes > MAX_CONTENT_INDEX_BYTES {
            return Err(ContentIndexError::Corrupt);
        }
    }
    Ok(())
}

fn save_document(
    path: &Path,
    source_revision: u64,
    documents: &HashMap<String, ContentDocument>,
    failed_count: usize,
    last_error: Option<String>,
) -> Result<(), ContentIndexError> {
    let mut ordered = documents.values().cloned().collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.file_id.cmp(&right.file_id));
    let document = ContentIndexDocument {
        version: CONTENT_INDEX_FORMAT_VERSION,
        source_revision,
        documents: ordered,
        failed_count,
        last_error,
    };
    let encoded = serde_json::to_vec_pretty(&document).map_err(|_| ContentIndexError::Write)?;
    if encoded.len() as u64 > MAX_CONTENT_INDEX_FILE_BYTES {
        return Err(ContentIndexError::Write);
    }
    let mut file = AtomicWriteFile::open(path).map_err(|_| ContentIndexError::Write)?;
    std::io::Write::write_all(file.as_file_mut(), &encoded)
        .map_err(|_| ContentIndexError::Write)?;
    file.commit().map_err(|_| ContentIndexError::Write)
}

fn backup_file(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    fs::rename(
        path,
        path.with_file_name(format!("{name}.recovery-{timestamp}")),
    )
    .is_ok()
}

fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && !value.contains(['/', '\\', ':'])
        && !value.contains("..")
        && !value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
}

fn modified_timestamp_nanos(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::{
        ContentIndexError, ContentIndexState, MAX_CONTENT_FILE_BYTES, MAX_CONTENT_INDEX_BYTES,
    };
    use crate::filesystem::IndexEntry;
    use std::{fs, path::PathBuf, time::SystemTime};

    fn unique_path(suffix: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "local-material-workbench-content-{timestamp}-{suffix}"
        ))
    }

    fn entry(id: &str, path: &PathBuf) -> IndexEntry {
        let info = crate::filesystem::type_info_for_path(path).expect("fixture type should exist");
        IndexEntry {
            id: id.to_string(),
            path: path.to_string_lossy().into_owned(),
            name: path.file_name().unwrap().to_string_lossy().into_owned(),
            kind: info.kind,
            file_type: info.file_type,
            size: fs::metadata(path).unwrap().len(),
            modified_at: 1,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: 1,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
        }
    }

    #[test]
    fn keeps_content_index_separate_and_updates_changed_text() {
        let source = unique_path("note.py");
        let index = unique_path("index.json");
        fs::write(&source, "第一版内容").unwrap();
        let state = ContentIndexState::default();
        state.initialize(index.clone());
        let first = entry("file-a", &source);
        let result = state.sync_entries(std::slice::from_ref(&first), 1).unwrap();
        assert_eq!(result.indexed_count, 1);
        let first_search = state.search_snapshot("第一版", false).unwrap();
        assert_eq!(first_search.status.source_revision, 1);
        assert_eq!(first_search.status.indexed_count, 1);
        assert_eq!(first_search.results.len(), 1);
        fs::write(&source, "第二版新增内容").unwrap();
        let mut updated = entry("file-a", &source);
        updated.modified_at = 2;
        let result = state.sync_entries(&[updated], 2).unwrap();
        assert_eq!(result.updated_count, 1);
        assert_eq!(
            state
                .search_snapshot("第一版", false)
                .unwrap()
                .results
                .len(),
            0
        );
        assert_eq!(
            state
                .search_snapshot("第二版", false)
                .unwrap()
                .results
                .len(),
            1
        );
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(&index);
    }

    #[test]
    fn failed_content_commit_keeps_documents_and_status_snapshot() {
        let source = unique_path("stable.txt");
        let root = unique_path("content-root");
        fs::create_dir_all(&root).unwrap();
        let index = root.join("content-index.json");
        fs::write(&source, "旧版本内容").unwrap();
        let state = ContentIndexState::default();
        state.initialize(index);
        let first = entry("file-a", &source);
        state.sync_entries(std::slice::from_ref(&first), 1).unwrap();
        let before = state.search_snapshot("旧版本", false).unwrap();

        fs::write(&source, "新版本内容").unwrap();
        let mut updated = entry("file-a", &source);
        updated.modified_at = 2;
        fs::remove_dir_all(&root).unwrap();

        assert!(matches!(
            state.sync_entries(&[updated], 2),
            Err(ContentIndexError::Write)
        ));
        let after = state.search_snapshot("旧版本", false).unwrap();
        assert_eq!(after.status.source_revision, before.status.source_revision);
        assert_eq!(after.status.indexed_count, before.status.indexed_count);
        assert_eq!(after.results.len(), before.results.len());
        assert!(state
            .search_snapshot("新版本", false)
            .unwrap()
            .results
            .is_empty());
        let _ = fs::remove_file(source);
    }

    #[test]
    fn corruption_is_recoverable_without_affecting_metadata_index() {
        let index = unique_path("index.json");
        fs::write(&index, b"not-json").unwrap();
        let state = ContentIndexState::default();
        state.initialize(index.clone());
        assert_eq!(state.status().unwrap().state, "recovery");
        assert!(matches!(
            state.search_snapshot("内容", false),
            Err(ContentIndexError::RecoveryRequired)
        ));
        let source = unique_path("note.txt");
        fs::write(&source, "可重建内容").unwrap();
        let result = state
            .rebuild(&[entry("file-a", &source)], 3, &|| false)
            .unwrap();
        assert_eq!(result.indexed_count, 1);
        assert_eq!(state.status().unwrap().state, "ready");
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(&index);
        let backup_prefix = format!("{}.recovery-", index.file_name().unwrap().to_string_lossy());
        if let Ok(items) = fs::read_dir(index.parent().unwrap()) {
            for item in items.flatten() {
                if item
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&backup_prefix)
                {
                    let _ = fs::remove_file(item.path());
                }
            }
        }
    }

    #[test]
    fn removes_missing_documents_and_rejects_oversized_content() {
        let source = unique_path("large.txt");
        let index = unique_path("index.json");
        fs::write(&source, vec![b'a'; (MAX_CONTENT_FILE_BYTES + 1) as usize]).unwrap();
        let state = ContentIndexState::default();
        state.initialize(index.clone());
        let result = state.sync_entries(&[entry("file-a", &source)], 1).unwrap();
        assert_eq!(result.skipped_count, 1);
        assert_eq!(state.status().unwrap().indexed_count, 0);
        let _ = fs::remove_file(source);
        let _ = fs::remove_file(index);
    }

    #[test]
    fn coalesces_pending_syncs_and_stops_an_older_revision_before_commit() {
        let state = ContentIndexState::default();
        let first_entry = IndexEntry {
            id: "file-first".to_string(),
            path: "C:\\资料\\first.txt".to_string(),
            name: "first.txt".to_string(),
            kind: "text".to_string(),
            file_type: "文本文件".to_string(),
            size: 1,
            modified_at: 1,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: 1,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
        };
        assert!(state.enqueue_sync(1, vec![first_entry]));
        let _ = state
            .take_pending_sync()
            .expect("first sync should be queued");

        let latest_entry = IndexEntry {
            id: "file-latest".to_string(),
            path: "C:\\资料\\latest.txt".to_string(),
            name: "latest.txt".to_string(),
            kind: "text".to_string(),
            file_type: "文本文件".to_string(),
            size: 1,
            modified_at: 1,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: 1,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
        };
        assert!(!state.enqueue_sync(2, vec![latest_entry.clone()]));
        assert!(state.has_pending_sync_after(1));
        assert!(
            state
                .sync_entries_with_stop(&[], 1, &|| { state.has_pending_sync_after(1) })
                .unwrap()
                .cancelled
        );
        assert!(state.finish_sync_worker());

        let (revision, entries) = state
            .take_pending_sync()
            .expect("only the latest pending sync should remain");
        assert_eq!(revision, 2);
        assert_eq!(entries, vec![latest_entry]);
        assert!(!state.finish_sync_worker());
    }

    #[test]
    fn checks_metadata_size_before_reading_when_content_capacity_is_exceeded() {
        assert!(super::content_size_exceeds_limit(
            MAX_CONTENT_INDEX_BYTES,
            0,
            1
        ));
        assert!(!super::content_size_exceeds_limit(
            MAX_CONTENT_INDEX_BYTES,
            1,
            1
        ));
        assert!(super::content_size_exceeds_limit(
            MAX_CONTENT_INDEX_BYTES - 10,
            0,
            11
        ));
    }
}
