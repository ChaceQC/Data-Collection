use crate::{
    filesystem,
    preview::PreviewState,
    storage::{AppState, StorageError},
};
use std::{fs, path::PathBuf};

struct Fixture {
    directory: PathBuf,
    index: AppState,
    preview: PreviewState,
    ids: Vec<String>,
}
impl Fixture {
    fn new() -> Self {
        let directory =
            std::env::temp_dir().join(format!("local-material-outcome-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let index = AppState::default();
        index.initialize(directory.join("index.json")).unwrap();
        let mut entries = Vec::new();
        for name in ["preview.txt", "other.txt"] {
            let path = directory.join(name);
            fs::write(&path, "synthetic fixture").unwrap();
            entries.push(filesystem::index_selected_path(&path.to_string_lossy()).unwrap());
        }
        let ids = entries.iter().map(|entry| entry.id.clone()).collect();
        index
            .update_entries_with(|current| {
                *current = entries;
                Ok((true, ()))
            })
            .unwrap();
        Self {
            directory,
            index,
            preview: PreviewState::default(),
            ids,
        }
    }
    fn token(&self, task: &str, preview_id: &str) -> String {
        let (task_id, cancellation) = self.preview.begin_task(Some(task.to_string()));
        let (token, _) = self
            .preview
            .outcomes
            .begin(&self.index, &self.ids[0], &task_id, &cancellation)
            .unwrap();
        assert!(self.preview.outcomes.attach(&token, preview_id));
        self.preview.finish_task(&task_id, &cancellation);
        token
    }
    fn record(
        &self,
        token: &str,
        status: &str,
    ) -> Result<crate::storage::MutationResult<Option<filesystem::IndexEntry>>, StorageError> {
        self.preview
            .outcomes
            .record(&self.index, &self.ids[0], token, status)
    }
}
impl Drop for Fixture {
    fn drop(&mut self) {
        self.preview.dispose_all();
        let _ = fs::remove_dir_all(&self.directory);
    }
}

#[test]
fn preview_outcome_survives_unrelated_and_same_file_user_metadata_changes() {
    let fixture = Fixture::new();
    let token = fixture.token("slow-preview", "resource-1");
    fixture
        .index
        .update_entries_with(|entries| {
            entries[0].tags.push("tag".to_string());
            entries[0].favorite = true;
            entries[1].favorite = true;
            Ok((true, ()))
        })
        .unwrap();
    let first = fixture.record(&token, "ready").unwrap();
    assert!(first.changed);
    assert!(first.value.as_ref().unwrap().last_opened_at.is_some());
    assert!(first.value.as_ref().unwrap().favorite);
    assert!(!fixture.record(&token, "ready").unwrap().changed);
    let failure = fixture.record(&token, "timed-out").unwrap();
    assert_eq!(
        failure.value.unwrap().last_opened_at,
        first.value.unwrap().last_opened_at
    );
}

#[test]
fn preview_outcome_rejects_replaced_removed_relocated_and_renamed_sources() {
    for change in ["replace", "remove", "relocate", "rename"] {
        let fixture = Fixture::new();
        let token = fixture.token("preview", "resource-1");
        if change == "replace" {
            let path = fixture.directory.join("preview.txt");
            fs::remove_file(&path).unwrap();
            fs::write(&path, "replacement source").unwrap();
        } else {
            fixture
                .index
                .update_entries_with(|entries| {
                    match change {
                        "remove" => {
                            entries.remove(0);
                        }
                        "relocate" => {
                            entries[0].path = fixture
                                .directory
                                .join("nested")
                                .join("preview.txt")
                                .to_string_lossy()
                                .into_owned();
                        }
                        _ => {
                            entries[0].name = "renamed.txt".to_string();
                            entries[0].path = fixture
                                .directory
                                .join("renamed.txt")
                                .to_string_lossy()
                                .into_owned();
                        }
                    }
                    Ok((true, ()))
                })
                .unwrap();
        }
        let before = fixture.index.snapshot().unwrap();
        assert!(
            matches!(
                fixture.record(&token, "ready"),
                Err(StorageError::PreviewRevisionConflict)
            ),
            "{change}"
        );
        assert_eq!(fixture.index.snapshot().unwrap(), before);
    }
}

#[test]
fn preview_outcome_rejects_superseded_cancelled_disposed_expired_and_exited_tasks() {
    for change in ["supersede", "cancel", "dispose", "expire", "exit"] {
        let fixture = Fixture::new();
        let token = fixture.token("preview", "resource-1");
        match change {
            "supersede" => {
                fixture.token("new-preview", "resource-2");
            }
            "cancel" => fixture.preview.cancel_task("preview"),
            "dispose" => crate::preview::dispose_preview(&fixture.preview, "resource-1"),
            "expire" => {
                fixture
                    .preview
                    .outcomes
                    .0
                    .lock()
                    .unwrap()
                    .get_mut(&token)
                    .unwrap()
                    .created_at -= super::OUTCOME_TTL;
            }
            _ => fixture.preview.dispose_all(),
        }
        assert!(
            matches!(
                fixture.record(&token, "ready"),
                Err(StorageError::PreviewRevisionConflict)
            ),
            "{change}"
        );
    }
}

#[test]
fn preview_outcome_write_failure_can_retry_without_losing_metadata() {
    let fixture = Fixture::new();
    let token = fixture.token("preview", "resource-1");
    let index_path = fixture.directory.join("index.json");
    let before = fixture.index.snapshot().unwrap();
    fs::remove_file(&index_path).unwrap();
    fs::create_dir(&index_path).unwrap();
    assert!(matches!(
        fixture.record(&token, "ready"),
        Err(StorageError::Write)
    ));
    assert_eq!(fixture.index.snapshot().unwrap(), before);
    fs::remove_dir(&index_path).unwrap();
    assert!(fixture.record(&token, "ready").unwrap().changed);
    let reloaded = AppState::default();
    reloaded.initialize(index_path).unwrap();
    assert!(reloaded
        .snapshot()
        .unwrap()
        .entries
        .iter()
        .find(|entry| entry.id == fixture.ids[0])
        .unwrap()
        .last_opened_at
        .is_some());
}
