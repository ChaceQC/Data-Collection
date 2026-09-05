use super::*;
use std::{
    fs,
    path::PathBuf,
    sync::{Arc, Barrier},
};

struct Fixture {
    root: PathBuf,
    state: AppState,
    entry: IndexEntry,
}
impl Fixture {
    fn new() -> Self {
        let root = std::env::temp_dir().join(format!("workbench-actions-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("原始资料.txt");
        fs::write(&path, "合成测试内容").unwrap();
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
}
impl Drop for Fixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

#[test]
fn reposition_returns_stable_id_after_sort_and_preserves_current_metadata() {
    let fixture = Fixture::new();
    let replacement = fixture.root.join("重新定位.txt");
    fs::write(&replacement, "新路径").unwrap();
    fs::remove_file(&fixture.entry.path).unwrap();
    fixture
        .state
        .update_entries(|entries| {
            let source = &mut entries[0];
            source.invalid = true;
            source.status = "路径失效".into();
            source.modified_at = 1;
            source.favorite = true;
            source.tags = vec!["保留".into()];
            source.last_opened_at = Some(10);
            let mut other = source.clone();
            other.id = "other".into();
            other.path = "C:\\fixtures\\other.txt".into();
            other.name = "other.txt".into();
            other.modified_at = 2;
            entries.push(other);
            super::super::sort_entries(entries);
            Ok(true)
        })
        .unwrap();
    assert_eq!(
        fixture.state.snapshot().unwrap().entries[1].id,
        fixture.entry.id
    );
    let result = reposition(
        &fixture.state,
        &fixture.entry.id,
        &replacement.to_string_lossy(),
    )
    .unwrap();
    let returned = result.value.unwrap();
    assert_eq!(returned.id, fixture.entry.id);
    assert_eq!(result.entries[0].id, fixture.entry.id);
    assert!(returned.favorite);
    assert_eq!(returned.tags, ["保留"]);
    assert_eq!(returned.last_opened_at, Some(10));
    assert_eq!(returned.added_at, fixture.entry.added_at);
    assert!(!returned.invalid);
    assert!(matches!(
        reposition(
            &fixture.state,
            &fixture.entry.id,
            &replacement.to_string_lossy()
        ),
        Err(FileActionError::Storage(StorageError::RepositionNotNeeded))
    ));
}

#[test]
fn reposition_checks_type_duplicate_and_inaccessible_paths_and_supports_folders() {
    let fixture = Fixture::new();
    fs::remove_file(&fixture.entry.path).unwrap();
    fixture
        .state
        .update_entries(|entries| {
            entries[0].invalid = true;
            entries[0].status = "路径失效".into();
            Ok(true)
        })
        .unwrap();
    let before = fixture.state.snapshot().unwrap();
    assert!(matches!(
        reposition(
            &fixture.state,
            &fixture.entry.id,
            &fixture.root.to_string_lossy()
        ),
        Err(FileActionError::Storage(
            StorageError::RepositionKindMismatch
        ))
    ));
    assert!(reposition(
        &fixture.state,
        &fixture.entry.id,
        &fixture.root.join("missing").to_string_lossy()
    )
    .is_err());
    assert_eq!(fixture.state.snapshot().unwrap(), before);
    let other = fixture.root.join("重复.txt");
    fs::write(&other, "重复").unwrap();
    let other_entry = filesystem::index_selected_path(&other.to_string_lossy()).unwrap();
    fixture
        .state
        .update_entries(|entries| {
            entries.push(other_entry);
            Ok(true)
        })
        .unwrap();
    assert!(matches!(
        reposition(&fixture.state, &fixture.entry.id, &other.to_string_lossy()),
        Err(FileActionError::Storage(StorageError::DuplicateEntry))
    ));
    let folder = fixture.root.join("原文件夹");
    fs::create_dir(&folder).unwrap();
    let mut entry = filesystem::index_selected_path(&folder.to_string_lossy()).unwrap();
    entry.invalid = true;
    entry.status = "路径失效".into();
    fixture
        .state
        .update_entries(|entries| {
            entries.push(entry.clone());
            Ok(true)
        })
        .unwrap();
    fs::remove_dir(&folder).unwrap();
    let result = reposition(&fixture.state, &entry.id, &fixture.root.to_string_lossy()).unwrap();
    assert_eq!(result.value.unwrap().id, entry.id);
}

#[test]
fn rename_barrier_preserves_concurrent_user_metadata_and_rejects_same_file_action() {
    let fixture = Fixture::new();
    let reached = Arc::new(Barrier::new(2));
    let resume = Arc::new(Barrier::new(2));
    std::thread::scope(|scope| {
        let task = scope.spawn(|| {
            rename_with_checkpoint(&fixture.state, &fixture.entry.id, "新名称.txt", || {
                reached.wait();
                resume.wait();
            })
        });
        reached.wait();
        assert!(matches!(
            fixture.state.begin_file_action(&fixture.entry.id),
            Err(StorageError::FileBusy)
        ));
        assert!(fixture.state.begin_file_action("unrelated").is_ok());
        fixture
            .state
            .update_index_with(|entries, groups| {
                groups.push(super::super::Group {
                    id: "group".into(),
                    name: "分组".into(),
                });
                let entry = &mut entries[0];
                entry.favorite = true;
                entry.tags = vec!["并发标签".into()];
                entry.group_id = Some("group".into());
                entry.last_recorded_at = Some(20);
                entry.last_opened_at = Some(30);
                entry.preview_status = "ready".into();
                Ok((true, ()))
            })
            .unwrap();
        resume.wait();
        let renamed = task.join().unwrap().unwrap().value.unwrap();
        assert!(renamed.favorite);
        assert_eq!(renamed.tags, ["并发标签"]);
        assert_eq!(renamed.group_id.as_deref(), Some("group"));
        assert_eq!(renamed.last_recorded_at, Some(20));
        assert_eq!(renamed.last_opened_at, Some(30));
        assert_eq!(renamed.preview_status, "ready");
        assert_eq!(renamed.name, "新名称.txt");
        assert_eq!(renamed.added_at, fixture.entry.added_at);
    });
}

#[test]
fn rename_save_failure_rolls_back_without_overwriting_or_moving_replaced_sources() {
    for conflict in ["none", "original", "renamed"] {
        let fixture = Fixture::new();
        let blocked = fixture.root.join("blocked");
        fs::create_dir(&blocked).unwrap();
        *fixture.state.index_path.lock().unwrap() = Some(blocked);
        let target = fixture.root.join("新名称.txt");
        let result =
            rename_with_checkpoint(&fixture.state, &fixture.entry.id, "新名称.txt", || {
                if conflict == "original" {
                    fs::write(&fixture.entry.path, "新建的原路径文件").unwrap();
                }
                if conflict == "renamed" {
                    fs::remove_file(&target).unwrap();
                    fs::write(&target, "替换后的不同来源").unwrap();
                }
            });
        if conflict == "none" {
            assert!(matches!(
                result,
                Err(FileActionError::Storage(StorageError::Write))
            ));
            assert!(PathBuf::from(&fixture.entry.path).exists());
            assert!(!target.exists());
        } else {
            assert!(matches!(result, Err(FileActionError::Partial)));
            assert!(target.exists());
            if conflict == "original" {
                assert_eq!(
                    fs::read_to_string(&fixture.entry.path).unwrap(),
                    "新建的原路径文件"
                );
            } else {
                assert_eq!(fs::read_to_string(target).unwrap(), "替换后的不同来源");
            }
        }
    }
}
