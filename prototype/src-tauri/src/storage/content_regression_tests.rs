use super::tests::{entry, unique_path};
use super::*;
use crate::storage::content_limits::{MAX_CONTENT_CHARS, MAX_CONTENT_UTF8_BYTES};
use std::time::Instant;

struct Fixture(PathBuf);
impl Fixture {
    fn new() -> Self {
        let path = unique_path("regression");
        fs::create_dir_all(&path).unwrap();
        Self(path)
    }
    fn state(&self) -> ContentIndexState {
        let state = ContentIndexState::default();
        state.initialize(self.0.join("content-index.json"));
        state
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}

#[test]
fn gb18030_expansion_is_skipped_and_legacy_bad_entries_are_isolated() {
    let fixture = Fixture::new();
    let valid = fixture.0.join("valid.md");
    let oversized = fixture.0.join("oversized.txt");
    fs::write(&valid, "有效正文").unwrap();
    let decoded = "汉".repeat(800_000);
    let (encoded, _, errors) = encoding_rs::GB18030.encode(&decoded);
    assert!(!errors);
    assert_eq!(encoded.len(), 1_600_000);
    assert_eq!(decoded.len(), 2_400_000);
    fs::write(&oversized, encoded).unwrap();
    let state = fixture.state();
    let entries = [entry("valid", &valid), entry("oversized", &oversized)];
    for rebuild in [false, true] {
        let result = if rebuild {
            state.rebuild(&entries, 2, &|| false)
        } else {
            state.sync_entries(&entries, 1)
        }
        .unwrap();
        assert_eq!(result.skipped_count, 1);
        assert!(result.skipped_reasons[0].contains("UTF-8"));
        let restarted = fixture.state();
        assert_eq!(restarted.status().unwrap().indexed_count, 1);
        assert_eq!(
            restarted
                .search_snapshot("有效", false)
                .unwrap()
                .results
                .len(),
            1
        );
    }
    let path = fixture.0.join("content-index.json");
    let mut legacy: serde_json::Value = serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
    let mut bad = legacy["documents"][0].clone();
    bad["file_id"] = "legacy-oversized".into();
    bad["size"] = 1_600_000.into();
    bad["content"] = decoded.into();
    legacy["documents"].as_array_mut().unwrap().push(bad);
    let original = serde_json::to_vec(&legacy).unwrap();
    fs::write(&path, &original).unwrap();
    let recovered = fixture.state();
    assert_eq!(recovered.status().unwrap().state, "ready");
    assert_eq!(recovered.status().unwrap().indexed_count, 1);
    assert!(recovered
        .status()
        .unwrap()
        .last_error
        .unwrap()
        .contains("隔离 1 条"));
    let backup = fs::read_dir(&fixture.0)
        .unwrap()
        .flatten()
        .find(|item| {
            item.file_name()
                .to_string_lossy()
                .starts_with("content-index.json.recovery-")
        })
        .unwrap();
    assert_eq!(fs::read(backup.path()).unwrap(), original);
    assert_eq!(fixture.state().status().unwrap().indexed_count, 1);
}

#[test]
fn all_write_boundaries_preserve_the_last_readable_cache() {
    let fixture = Fixture::new();
    let path = fixture.0.join("content-index.json");
    let state = fixture.state();
    state.clear(1).unwrap();
    let saved = fs::read(&path).unwrap();
    let unicode = "😀".repeat((MAX_CONTENT_UTF8_BYTES / 4) as usize);
    assert!(validate_text(MAX_CONTENT_FILE_BYTES - 1, &unicode).is_ok());
    assert!(validate_text(MAX_CONTENT_FILE_BYTES, &unicode).is_ok());
    assert!(validate_text(MAX_CONTENT_FILE_BYTES + 1, "a").is_err());
    assert!(validate_text(1, &(unicode.clone() + "a")).is_err());
    assert!(validate_text(1, &"a".repeat(MAX_CONTENT_CHARS - 1)).is_ok());
    assert!(validate_text(1, &"a".repeat(MAX_CONTENT_CHARS)).is_ok());
    assert!(validate_text(1, &"a".repeat(MAX_CONTENT_CHARS + 1)).is_err());
    let base = ContentDocument {
        file_id: "file".into(),
        path: "C:\\fixtures\\file.txt".into(),
        size: 1,
        modified_at: 0,
        modified_at_nanos: 0,
        content: unicode + "a",
    };
    let bad = HashMap::from([("file".to_string(), Arc::new(base.clone()))]);
    assert!(save_document(&path, 2, &bad, 0, None).is_err());
    let base = ContentDocument {
        content: String::new(),
        ..base
    };
    let mut too_many = HashMap::new();
    for n in 0..=MAX_CONTENT_INDEX_ENTRIES {
        let id = format!("file-{n}");
        too_many.insert(
            id.clone(),
            Arc::new(ContentDocument {
                file_id: id,
                content: String::new(),
                ..base.clone()
            }),
        );
    }
    assert!(save_document(&path, 2, &too_many, 0, None).is_err());
    assert_eq!(fs::read(&path).unwrap(), saved);
    too_many.remove(&format!("file-{}", MAX_CONTENT_INDEX_ENTRIES));
    save_document(&path, 2, &too_many, 0, None).unwrap();
    assert_eq!(
        fixture.state().status().unwrap().indexed_count,
        MAX_CONTENT_INDEX_ENTRIES
    );
    let serialized = serde_json::to_value(state.status().unwrap()).unwrap();
    assert!(serialized["cacheRevision"].is_u64());
    assert!(serialized.get("cache_revision").is_none());
}

#[test]
fn clear_rebuild_sync_order_cancel_and_failure_keep_coherent_snapshots() {
    let fixture = Fixture::new();
    let source = fixture.0.join("stable.txt");
    fs::write(&source, "原有正文").unwrap();
    let entries = [entry("file", &source)];
    let state = fixture.state();
    state.sync_entries(&entries, 5).unwrap();
    let before = state.state_snapshot().unwrap();
    assert!(Arc::ptr_eq(&before, &state.state_snapshot().unwrap()));
    let checks = std::cell::Cell::new(0);
    let late = state.search_with_check("原有", false, &|| {
        checks.set(checks.get() + 1);
        if checks.get() == 2 {
            state.clear(5)?;
        }
        Ok(())
    });
    assert!(matches!(late, Err(ContentIndexError::Stale)));
    state.sync_entries(&entries, 5).unwrap();
    let ticket = state.queries.begin("query-a").unwrap();
    let cleared = state.clear(4).unwrap();
    assert_eq!(cleared.source_revision, 5);
    assert!(cleared.cache_revision > before.status.cache_revision);
    assert!(matches!(ticket.check(), Err(ContentIndexError::Cancelled)));
    assert!(
        state
            .sync_entries_with_stop(&entries, 5, 0, &|| false)
            .unwrap()
            .cancelled
    );
    assert_eq!(state.status().unwrap().indexed_count, 0);
    assert!(!state.enqueue_sync(5, entries.to_vec()));
    assert!(state.enqueue_sync(6, entries.to_vec()));
    let (revision, pending, epoch) = state.take_pending_sync().unwrap();
    state
        .sync_entries_with_stop(&pending, revision, epoch, &|| false)
        .unwrap();
    let baseline = state.state_snapshot().unwrap();
    let stopped = state.rebuild(&entries, 6, &|| true).unwrap();
    assert!(stopped.cancelled);
    assert!(Arc::ptr_eq(
        &baseline.documents,
        &state.state_snapshot().unwrap().documents
    ));
    assert_eq!(state.status().unwrap().state, "ready");
    let calls = std::cell::Cell::new(0);
    let stopped = state
        .rebuild(&entries, 6, &|| {
            calls.set(calls.get() + 1);
            calls.get() > 2
        })
        .unwrap();
    assert!(stopped.cancelled);
    assert_eq!(state.status().unwrap().indexed_count, 1);
    let old_epoch = state.begin_change().unwrap();
    state.clear(6).unwrap();
    assert!(
        state
            .rebuild_at(&entries, 6, old_epoch, &|| false)
            .unwrap()
            .cancelled
    );
    assert_eq!(fixture.state().status().unwrap().indexed_count, 0);
    state.sync_entries(&entries, 7).unwrap();
    let writable = state.index_path().unwrap();
    *state.path.lock().unwrap() = Some(fixture.0.join("absent").join("content-index.json"));
    assert!(state.clear(8).is_err());
    assert!(state.rebuild(&entries, 8, &|| false).is_err());
    assert_eq!(state.status().unwrap().source_revision, 7);
    assert_eq!(
        state.search_snapshot("原有", false).unwrap().results.len(),
        1
    );
    *state.path.lock().unwrap() = Some(writable);
    assert_eq!(fixture.state().status().unwrap().source_revision, 7);
}

#[test]
fn near_capacity_sync_reclaims_removed_and_replaced_documents_before_new_items() {
    let fixture = Fixture::new();
    let content = "😀".repeat((MAX_CONTENT_UTF8_BYTES / 4) as usize);
    let mut entries = Vec::new();
    for n in 0..32 {
        let path = fixture.0.join(format!("{n}.txt"));
        fs::write(&path, &content).unwrap();
        entries.push(entry(&format!("file-{n}"), &path));
    }
    let state = fixture.state();
    let started = Instant::now();
    state.rebuild(&entries, 1, &|| false).unwrap();
    let rebuild_ms = started.elapsed().as_millis();
    assert_eq!(state.status().unwrap().total_bytes, MAX_CONTENT_INDEX_BYTES);
    let mut overflow = (*state.state_snapshot().unwrap().documents).clone();
    let document = &overflow["file-0"];
    overflow.insert(
        "overflow".to_string(),
        Arc::new(ContentDocument {
            file_id: "overflow".into(),
            content: "x".into(),
            ..(**document).clone()
        }),
    );
    assert!(save_document(&state.index_path().unwrap(), 2, &overflow, 0, None).is_err());
    drop(overflow);
    let snapshot = state.state_snapshot().unwrap();
    let started = Instant::now();
    for _ in 0..1000 {
        assert!(Arc::ptr_eq(&snapshot, &state.state_snapshot().unwrap()));
    }
    let snapshot_us = started.elapsed().as_micros();
    let started = Instant::now();
    let ticket = state.queries.begin("near-capacity").unwrap();
    assert!(state
        .run_query("absent", false, &ticket)
        .unwrap()
        .results
        .is_empty());
    let query_ms = started.elapsed().as_millis();
    let new_path = fixture.0.join("new.txt");
    fs::write(&new_path, &content).unwrap();
    fs::write(&entries[0].path, "缩小").unwrap();
    entries[31].invalid = true;
    entries.insert(0, entry("new", &new_path));
    let started = Instant::now();
    let updated = state.sync_entries(&entries, 2).unwrap();
    let sync_ms = started.elapsed().as_millis();
    assert_eq!(updated.skipped_count, 0);
    assert_eq!(updated.removed_count, 1);
    assert_eq!(updated.updated_count, 1);
    assert_eq!(
        state.status().unwrap().total_bytes,
        31 * MAX_CONTENT_UTF8_BYTES + 6
    );
    assert!(Arc::ptr_eq(
        &snapshot.documents["file-1"],
        &state.state_snapshot().unwrap().documents["file-1"]
    ));
    assert_eq!(
        fixture.state().status().unwrap().total_bytes,
        state.status().unwrap().total_bytes
    );
    eprintln!("CONTENT_CAPACITY bytes={} rebuild_ms={rebuild_ms} snapshot_1000_us={snapshot_us} query_ms={query_ms} incremental_ms={sync_ms}", MAX_CONTENT_INDEX_BYTES);
}
