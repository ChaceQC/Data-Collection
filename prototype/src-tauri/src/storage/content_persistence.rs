use super::sync::content_size_exceeds_limit;
use super::*;

const CONTENT_INDEX_FORMAT_VERSION: u32 = 1;

#[derive(Debug, Deserialize, Serialize)]
pub(super) struct ContentIndexDocument {
    version: u32,
    #[serde(default)]
    pub(super) source_revision: u64,
    #[serde(default)]
    pub(super) documents: Vec<ContentDocument>,
    #[serde(default)]
    pub(super) failed_count: usize,
    #[serde(default)]
    pub(super) last_error: Option<String>,
}

pub(super) fn load_document(
    path: &Path,
) -> Result<Option<ContentIndexDocument>, ContentIndexError> {
    let Some(bytes) =
        app_data::read(path, AppDataFile::ContentIndex).map_err(map_app_data_error)?
    else {
        return Ok(None);
    };
    let mut document = serde_json::from_slice::<ContentIndexDocument>(&bytes)
        .map_err(|_| ContentIndexError::Corrupt)?;
    if document.version != CONTENT_INDEX_FORMAT_VERSION {
        return Err(ContentIndexError::UnsupportedVersion);
    }
    if validate_document(&document).is_err() {
        let mut ids = HashSet::new();
        let mut total_bytes = 0u64;
        let before = document.documents.len();
        document.documents.retain(|item| {
            if validate_entry(item).is_err()
                || ids.contains(&item.file_id)
                || ids.len() >= MAX_CONTENT_INDEX_ENTRIES
                || content_size_exceeds_limit(total_bytes, 0, item.content.len() as u64)
            {
                return false;
            }
            ids.insert(item.file_id.clone());
            total_bytes += item.content.len() as u64;
            true
        });
        if !backup_file(path) {
            return Err(ContentIndexError::Corrupt);
        }
        let isolated = before - document.documents.len();
        document.failed_count = document.failed_count.saturating_add(isolated);
        document.last_error = Some(format!("已备份并隔离 {isolated} 条无效或超限正文缓存"));
        validate_document(&document)?;
        let encoded = encode_document(&document)?;
        app_data::write(path, AppDataFile::ContentIndex, &encoded)
            .map_err(|_| ContentIndexError::Write)?;
    }
    Ok(Some(document))
}

fn validate_document(document: &ContentIndexDocument) -> Result<(), ContentIndexError> {
    if document.documents.len() > MAX_CONTENT_INDEX_ENTRIES {
        return Err(ContentIndexError::Corrupt);
    }
    let mut ids = HashSet::new();
    let mut total_bytes = 0u64;
    for item in &document.documents {
        if validate_entry(item).is_err() || !ids.insert(item.file_id.clone()) {
            return Err(ContentIndexError::Corrupt);
        }
        total_bytes = total_bytes.saturating_add(item.content.len() as u64);
        if total_bytes > MAX_CONTENT_INDEX_BYTES {
            return Err(ContentIndexError::Corrupt);
        }
    }
    Ok(())
}

pub(super) fn save_document(
    path: &Path,
    source_revision: u64,
    documents: &ContentDocuments,
    failed_count: usize,
    last_error: Option<String>,
) -> Result<(), ContentIndexError> {
    if documents.len() > MAX_CONTENT_INDEX_ENTRIES {
        return Err(ContentIndexError::Corrupt);
    }
    let mut total_bytes = 0u64;
    for (id, item) in documents {
        validate_entry(item).map_err(|_| ContentIndexError::Corrupt)?;
        if id != &item.file_id {
            return Err(ContentIndexError::Corrupt);
        }
        total_bytes = total_bytes.saturating_add(item.content.len() as u64);
        if total_bytes > MAX_CONTENT_INDEX_BYTES {
            return Err(ContentIndexError::Corrupt);
        }
    }
    let mut ordered = documents.values().map(AsRef::as_ref).collect::<Vec<_>>();
    ordered.sort_by(|left, right| left.file_id.cmp(&right.file_id));
    #[derive(Serialize)]
    struct BorrowedDocument<'a> {
        version: u32,
        source_revision: u64,
        documents: Vec<&'a ContentDocument>,
        failed_count: usize,
        last_error: Option<String>,
    }
    let document = BorrowedDocument {
        version: CONTENT_INDEX_FORMAT_VERSION,
        source_revision,
        documents: ordered,
        failed_count,
        last_error,
    };
    let encoded = encode_document(&document)?;
    app_data::write(path, AppDataFile::ContentIndex, &encoded).map_err(|_| ContentIndexError::Write)
}

fn encode_document(document: &impl Serialize) -> Result<Vec<u8>, ContentIndexError> {
    let mut buffer = BoundedJsonBuffer(Vec::new());
    serde_json::to_writer_pretty(&mut buffer, document).map_err(|_| ContentIndexError::Write)?;
    Ok(buffer.0)
}

struct BoundedJsonBuffer(Vec<u8>);
impl std::io::Write for BoundedJsonBuffer {
    fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
        if self.0.len().saturating_add(bytes.len()) as u64 > MAX_CONTENT_INDEX_FILE_BYTES {
            return Err(std::io::Error::other("正文缓存 JSON 超限"));
        }
        self.0.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

pub(super) fn backup_file(path: &Path) -> bool {
    app_data::backup(path, AppDataFile::ContentIndex)
}

fn map_app_data_error(error: AppDataError) -> ContentIndexError {
    match error {
        AppDataError::TooLarge | AppDataError::Unsafe => ContentIndexError::Corrupt,
        AppDataError::Read | AppDataError::Write | AppDataError::Directory => {
            ContentIndexError::Read
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn json_limit_stops_encoding_without_committing_partial_output() {
        let mut buffer = BoundedJsonBuffer(vec![b' '; MAX_CONTENT_INDEX_FILE_BYTES as usize - 1]);
        buffer.write_all(b" ").unwrap();
        assert_eq!(buffer.0.len() as u64, MAX_CONTENT_INDEX_FILE_BYTES);
        assert!(buffer.write_all(b" ").is_err());
        assert_eq!(buffer.0.len() as u64, MAX_CONTENT_INDEX_FILE_BYTES);
    }
}
