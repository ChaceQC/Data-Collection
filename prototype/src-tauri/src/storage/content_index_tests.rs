use super::{
    ContentIndexError, ContentIndexState, MAX_CONTENT_FILE_BYTES, MAX_CONTENT_INDEX_BYTES,
};
use crate::filesystem::IndexEntry;
use std::{fs, path::PathBuf, time::SystemTime};

pub(super) fn unique_path(suffix: &str) -> PathBuf {
    let timestamp = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .expect("clock should be available")
        .as_nanos();
    std::env::temp_dir().join(format!(
        "local-material-workbench-content-{timestamp}-{suffix}"
    ))
}

pub(super) fn entry(id: &str, path: &PathBuf) -> IndexEntry {
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
            .sync_entries_with_stop(&[], 1, 0, &|| { state.has_pending_sync_after(1) })
            .unwrap()
            .cancelled
    );
    assert!(state.finish_sync_worker());

    let (revision, entries, _) = state
        .take_pending_sync()
        .expect("only the latest pending sync should remain");
    assert_eq!(revision, 2);
    assert_eq!(entries, vec![latest_entry]);
    assert!(!state.finish_sync_worker());
}

#[test]
fn checks_metadata_size_before_reading_when_content_capacity_is_exceeded() {
    assert!(super::sync::content_size_exceeds_limit(
        MAX_CONTENT_INDEX_BYTES,
        0,
        1
    ));
    assert!(!super::sync::content_size_exceeds_limit(
        MAX_CONTENT_INDEX_BYTES,
        1,
        1
    ));
    assert!(super::sync::content_size_exceeds_limit(
        MAX_CONTENT_INDEX_BYTES - 10,
        0,
        11
    ));
}
