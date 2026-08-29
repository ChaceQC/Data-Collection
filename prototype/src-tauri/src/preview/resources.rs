use std::{
    collections::HashMap,
    fs,
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, SystemTime},
};

use uuid::Uuid;

pub(crate) const RESOURCE_SCHEME: &str = "preview";
const RESOURCE_ID_PREFIX: &str = "preview-";
const RESOURCE_TTL: Duration = Duration::from_secs(30 * 60);

#[derive(Clone, Debug)]
pub(crate) struct PreviewResourceStore {
    pub(super) sessions: Arc<Mutex<HashMap<String, PreviewResource>>>,
}

#[derive(Clone, Debug)]
pub(super) struct PreviewResource {
    pub(super) path: PathBuf,
    pub(super) media_type: String,
    pub(super) byte_length: u64,
    pub(super) supports_range: bool,
    pub(super) temporary_directory: Option<PathBuf>,
    pub(super) created_at: SystemTime,
}

impl PreviewResourceStore {
    pub(crate) fn insert(
        &self,
        preview_id: String,
        path: PathBuf,
        media_type: String,
        byte_length: u64,
        temporary_directory: Option<PathBuf>,
    ) -> Result<(), ()> {
        self.cleanup_expired();
        let mut sessions = self.sessions.lock().map_err(|_| ())?;
        sessions.insert(
            preview_id,
            PreviewResource {
                path,
                media_type,
                byte_length,
                supports_range: true,
                temporary_directory,
                created_at: SystemTime::now(),
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
                            .duration_since(resource.created_at)
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
}

impl Default for PreviewResourceStore {
    fn default() -> Self {
        Self {
            sessions: Arc::new(Mutex::new(HashMap::new())),
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
