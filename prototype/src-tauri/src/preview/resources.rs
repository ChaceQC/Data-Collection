use std::sync::atomic::{AtomicBool, Ordering};
use std::{
    collections::HashMap,
    fs::{self, Metadata},
    path::PathBuf,
    sync::{Arc, Condvar, Mutex},
    time::{Duration, SystemTime},
};

use uuid::Uuid;

pub(crate) const RESOURCE_SCHEME: &str = "preview";
const RESOURCE_ID_PREFIX: &str = "preview-";
const RESOURCE_TTL: Duration = Duration::from_secs(30 * 60);
const RESOURCE_CLEANUP_INTERVAL: Duration = Duration::from_secs(60);
const MAX_ACTIVE_RESOURCES: usize = 64;

#[derive(Clone, Debug)]
pub(crate) struct PreviewResourceStore {
    pub(super) sessions: Arc<Mutex<HashMap<String, PreviewResource>>>,
    cleanup_started: Arc<AtomicBool>,
    cleanup_stop: Arc<AtomicBool>,
    cleanup_wakeup: Arc<(Mutex<()>, Condvar)>,
    closed: Arc<AtomicBool>,
}

#[derive(Clone, Debug)]
pub(super) struct PreviewResource {
    pub(super) path: PathBuf,
    pub(super) source_metadata: Metadata,
    pub(super) media_type: String,
    pub(super) byte_length: u64,
    pub(super) supports_range: bool,
    pub(super) temporary_directory: Option<PathBuf>,
    pub(super) last_accessed_at: SystemTime,
}

impl PreviewResourceStore {
    pub(crate) fn insert(
        &self,
        preview_id: String,
        path: PathBuf,
        source_metadata: Metadata,
        media_type: String,
        byte_length: u64,
        temporary_directory: Option<PathBuf>,
    ) -> Result<(), ()> {
        self.cleanup_expired();
        let mut sessions = self.sessions.lock().map_err(|_| ())?;
        if self.closed.load(Ordering::Acquire) || sessions.len() >= MAX_ACTIVE_RESOURCES {
            return Err(());
        }
        sessions.insert(
            preview_id,
            PreviewResource {
                path,
                source_metadata,
                media_type,
                byte_length,
                supports_range: true,
                temporary_directory,
                last_accessed_at: SystemTime::now(),
            },
        );
        Ok(())
    }

    pub(crate) fn dispose(&self, preview_id: &str) {
        let resource = self
            .sessions
            .lock()
            .ok()
            .and_then(|mut sessions| sessions.remove(preview_id));
        if let Some(resource) = resource {
            remove_temporary_directory(resource.temporary_directory.as_deref());
        }
    }

    pub(crate) fn dispose_all(&self) {
        self.closed.store(true, Ordering::Release);
        let resources = self
            .sessions
            .lock()
            .ok()
            .map(|mut sessions| {
                sessions
                    .drain()
                    .map(|(_, resource)| resource)
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for resource in resources {
            remove_temporary_directory(resource.temporary_directory.as_deref());
        }
    }

    pub(crate) fn cleanup_expired(&self) {
        let expired = self
            .sessions
            .lock()
            .ok()
            .map(|mut sessions| {
                let now = SystemTime::now();
                let expired_ids = sessions
                    .iter()
                    .filter_map(|(id, resource)| {
                        let expired = now
                            .duration_since(resource.last_accessed_at)
                            .map(|age| age > RESOURCE_TTL)
                            .unwrap_or(false);
                        expired.then(|| id.clone())
                    })
                    .collect::<Vec<_>>();
                expired_ids
                    .into_iter()
                    .filter_map(|id| sessions.remove(&id))
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        for resource in expired {
            remove_temporary_directory(resource.temporary_directory.as_deref());
        }
    }

    pub(crate) fn touch(&self, preview_id: &str) {
        if let Ok(mut sessions) = self.sessions.lock() {
            if let Some(resource) = sessions.get_mut(preview_id) {
                resource.last_accessed_at = SystemTime::now();
            }
        }
    }

    pub(crate) fn start_cleanup_task(&self) {
        if self.cleanup_started.swap(true, Ordering::AcqRel) {
            return;
        }
        let stop = self.cleanup_stop.clone();
        let wakeup = self.cleanup_wakeup.clone();
        // 资源表由应用状态持有，清理线程只负责定期回收过期会话。
        let store = self.clone();
        std::thread::spawn(move || {
            while !stop.load(Ordering::Acquire) {
                let Ok(lock) = wakeup.0.lock() else {
                    break;
                };
                let _ = wakeup.1.wait_timeout(lock, RESOURCE_CLEANUP_INTERVAL);
                if !stop.load(Ordering::Acquire) {
                    store.cleanup_expired();
                }
            }
        });
    }

    pub(crate) fn stop_cleanup_task(&self) {
        self.cleanup_stop.store(true, Ordering::Release);
        self.cleanup_wakeup.1.notify_all();
    }
}

impl Default for PreviewResourceStore {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
            cleanup_started: Arc::new(AtomicBool::new(false)),
            cleanup_stop: Arc::new(AtomicBool::new(false)),
            cleanup_wakeup: Arc::new((Mutex::new(()), Condvar::new())),
            closed: Arc::new(AtomicBool::new(false)),
        }
    }
}

pub(crate) fn new_preview_id() -> String {
    format!("{RESOURCE_ID_PREFIX}{}", Uuid::new_v4().simple())
}

pub(crate) fn resource_url(preview_id: &str) -> String {
    #[cfg(windows)]
    {
        format!("http://{RESOURCE_SCHEME}.localhost/{preview_id}")
    }
    #[cfg(not(windows))]
    {
        format!("{RESOURCE_SCHEME}://localhost/{preview_id}")
    }
}

fn remove_temporary_directory(path: Option<&std::path::Path>) {
    let Some(path) = path else {
        return;
    };
    let temp_root = std::env::temp_dir();
    let owned_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.starts_with("local-material-preview-"))
        .unwrap_or(false);
    if owned_name && path.parent() == Some(temp_root.as_path()) {
        let _ = fs::remove_dir_all(path);
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, time::UNIX_EPOCH};

    use super::{new_preview_id, PreviewResourceStore};

    #[test]
    fn cleanup_removes_expired_resources_and_owned_temporary_directories() {
        let directory =
            std::env::temp_dir().join(format!("local-material-preview-test-{}", new_preview_id()));
        fs::create_dir(&directory).expect("temporary directory should be created");
        let path = directory.join("preview.pdf");
        fs::write(&path, b"%PDF-").expect("preview fixture should be written");
        let store = PreviewResourceStore::default();
        let preview_id = new_preview_id();
        store
            .insert(
                preview_id.clone(),
                path,
                fs::metadata(directory.join("preview.pdf"))
                    .expect("resource metadata should be readable"),
                "application/pdf".to_string(),
                5,
                Some(directory.clone()),
            )
            .expect("resource should be registered");
        store
            .sessions
            .lock()
            .expect("resource store should be available")
            .get_mut(&preview_id)
            .expect("resource should exist")
            .last_accessed_at = UNIX_EPOCH;

        store.cleanup_expired();

        assert!(!directory.exists());
        assert!(!store
            .sessions
            .lock()
            .expect("resource store should be available")
            .contains_key(&preview_id));
    }

    #[test]
    fn bounds_active_resource_sessions_before_registering_another_source() {
        let path = std::env::temp_dir().join(format!(
            "local-material-resource-limit-{}",
            new_preview_id()
        ));
        fs::write(&path, b"resource").expect("resource fixture should be written");
        let metadata = fs::metadata(&path).expect("resource metadata should be readable");
        let store = PreviewResourceStore::default();
        for _ in 0..super::MAX_ACTIVE_RESOURCES {
            store
                .insert(
                    new_preview_id(),
                    path.clone(),
                    metadata.clone(),
                    "text/plain".to_string(),
                    metadata.len(),
                    None,
                )
                .expect("resource should stay within the active bound");
        }
        assert!(store
            .insert(
                new_preview_id(),
                path.clone(),
                metadata,
                "text/plain".to_string(),
                7,
                None,
            )
            .is_err());
        store.dispose_all();
        let _ = fs::remove_file(path);
    }
}
