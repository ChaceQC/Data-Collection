use super::*;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ContentIndexStatus {
    pub state: String,
    pub indexed_count: usize,
    pub total_bytes: u64,
    pub failed_count: usize,
    pub source_revision: u64,
    pub cache_revision: u64,
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
            cache_revision: 0,
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
    #[error("正文搜索已取消")]
    Cancelled,
    #[error("正文搜索超时，请缩短表达式后重试")]
    TimedOut,
    #[error("正文搜索繁忙，请稍后重试")]
    Busy,
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
