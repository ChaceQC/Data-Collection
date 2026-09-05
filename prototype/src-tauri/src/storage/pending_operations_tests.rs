use super::super::AppState;
use super::*;
use std::path::PathBuf;

struct Fixture {
    root: PathBuf,
    state: AppState,
    entry: IndexEntry,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("workbench-pending-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("合成资料.txt");
        fs::write(&path, "合成内容").unwrap();
        let entry = filesystem::index_selected_path(&path.to_string_lossy()).unwrap();
        let state = AppState::default();
        state.initialize(root.join("index.json")).unwrap();
        state
            .update_entries(|entries| {
                entries.push(entry.clone());
                Ok(true)
            })
            .unwrap();
        Self { root, state, entry }
    }
    fn prepare(&self) {
        self.state
            .prepare_delete(&self.entry.id, Path::new(&self.entry.path))
            .unwrap();
    }
    fn pending(&self) -> PathBuf {
        self.root.join("pending-operations.json")
    }
    fn restart(&self) -> AppState {
        let state = AppState::default();
        state.initialize(self.root.join("index.json")).unwrap();
        state
    }
    fn block_pending(&self) {
        let path = self.root.join("blocked");
        fs::create_dir(&path).unwrap();
        *self.state.pending_operations_path.lock().unwrap() = Some(path);
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn recovery_matrix_preserves_ambiguous_and_replaced_sources_and_is_idempotent() {
    for phase in ["prepared", "physical-complete"] {
        for source in ["same", "missing", "replaced", "relocated"] {
            let f = Fixture::new();
            f.prepare();
            if phase == "physical-complete" {
                f.state.mark_delete_complete(&f.entry.id).unwrap();
            }
            if source != "same" {
                fs::remove_file(&f.entry.path).unwrap();
            }
            if source == "replaced" {
                fs::write(&f.entry.path, "原路径上的新文件，必须保留").unwrap();
            }
            if source == "relocated" {
                f.state
                    .update_entries(|entries| {
                        entries[0].path = f.root.join("新位置.txt").to_string_lossy().into();
                        entries[0].name = "新位置.txt".into();
                        Ok(true)
                    })
                    .unwrap();
            }
            let state = f.restart();
            state.reconcile_pending_operations().unwrap();
            let resolved = (phase == "prepared" && source == "same")
                || source == "relocated"
                || (phase == "physical-complete" && source == "missing");
            assert_eq!(
                state.recovery_status().unwrap().is_none(),
                resolved,
                "{phase}/{source}"
            );
            assert_eq!(
                state.snapshot().unwrap().entries.is_empty(),
                phase == "physical-complete" && source == "missing"
            );
            let snapshot = state.snapshot().unwrap();
            assert!(!state.reconcile_pending_operations().unwrap());
            assert_eq!(state.snapshot().unwrap(), snapshot);
            if source == "replaced" {
                assert_eq!(
                    fs::read_to_string(&f.entry.path).unwrap(),
                    "原路径上的新文件，必须保留"
                );
            }
        }
    }
}

#[test]
fn persistence_failures_leave_recoverable_state_at_each_delete_window() {
    for step in ["prepare", "mark", "index", "clear"] {
        let f = Fixture::new();
        if step == "prepare" {
            f.block_pending();
            assert!(f
                .state
                .prepare_delete(&f.entry.id, Path::new(&f.entry.path))
                .is_err());
            assert!(Path::new(&f.entry.path).exists());
            assert!(f.state.recovery_status().unwrap().is_none());
            continue;
        }
        f.prepare();
        // 自动测试只移除隔离夹具，不调用系统回收站。
        fs::remove_file(&f.entry.path).unwrap();
        if step == "mark" {
            f.block_pending();
            assert!(f.state.mark_delete_complete(&f.entry.id).is_err());
            let state = f.restart();
            state.reconcile_pending_operations().unwrap();
            assert_eq!(
                state.recovery_status().unwrap().unwrap().pending_operations,
                1
            );
            assert_eq!(state.snapshot().unwrap().entries.len(), 1);
            continue;
        }
        f.state.mark_delete_complete(&f.entry.id).unwrap();
        if step == "index" {
            let blocked = f.root.join("blocked-index");
            fs::create_dir(&blocked).unwrap();
            *f.state.index_path.lock().unwrap() = Some(blocked);
        } else {
            f.block_pending();
        }
        assert!(f.state.reconcile_pending_operations().is_err());
        let state = f.restart();
        assert_eq!(
            state.snapshot().unwrap().entries.len(),
            usize::from(step == "index")
        );
        assert_eq!(
            state.snapshot().unwrap().entries,
            f.state.snapshot().unwrap().entries
        );
        state.reconcile_pending_operations().unwrap();
        assert!(state.snapshot().unwrap().entries.is_empty());
        assert!(state.recovery_status().unwrap().is_none());
    }
}

#[test]
fn recovery_skips_live_operations_and_reset_clears_both_files_even_after_cleanup_failure() {
    let f = Fixture::new();
    f.prepare();
    let guard = f.state.begin_file_action(&f.entry.id).unwrap();
    assert!(!f.state.reconcile_pending_operations().unwrap());
    assert!(matches!(
        f.state.reset_index_recovery(),
        Err(StorageError::FileBusy)
    ));
    drop(guard);
    f.block_pending();
    assert!(f.state.reset_index_recovery().is_err());
    assert!(f.state.snapshot().unwrap().entries.is_empty());
    assert_eq!(
        f.state
            .recovery_status()
            .unwrap()
            .unwrap()
            .pending_operations,
        1
    );
    let state = f.restart();
    state.reconcile_pending_operations().unwrap();
    assert!(state.recovery_status().unwrap().is_none());
    assert!(!f.pending().exists());
    assert!(Path::new(&f.entry.path).exists());
    assert!(state.reset_index_recovery().unwrap().recovery.is_none());
}

#[test]
fn legacy_log_is_backed_up_and_kept_for_explicit_verification() {
    let f = Fixture::new();
    f.prepare();
    let mut document: serde_json::Value =
        serde_json::from_slice(&fs::read(f.pending()).unwrap()).unwrap();
    document["version"] = 1.into();
    document["operations"][0]
        .as_object_mut()
        .unwrap()
        .remove("source");
    let bytes = serde_json::to_vec(&document).unwrap();
    fs::write(f.pending(), &bytes).unwrap();
    let state = f.restart();
    state.reconcile_pending_operations().unwrap();
    assert_eq!(
        state.recovery_status().unwrap().unwrap().pending_operations,
        1
    );
    let migrated: serde_json::Value =
        serde_json::from_slice(&fs::read(f.pending()).unwrap()).unwrap();
    assert_eq!(migrated["version"], 2);
    let backup = fs::read_dir(&f.root)
        .unwrap()
        .flatten()
        .find(|entry| {
            entry
                .file_name()
                .to_string_lossy()
                .starts_with("pending-operations.json.recovery-")
        })
        .unwrap();
    assert_eq!(fs::read(backup.path()).unwrap(), bytes);
    state.reset_index_recovery().unwrap();
    assert!(f.restart().recovery_status().unwrap().is_none());
}
