//! 正文缓存读写共用边界；源字节、UTF-8 字节和 Unicode 字符分别计数。
use super::content_index::ContentDocument;
use crate::filesystem;

pub const MAX_CONTENT_FILE_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_CONTENT_UTF8_BYTES: u64 = 2 * 1024 * 1024;
pub const MAX_CONTENT_INDEX_BYTES: u64 = 64 * 1024 * 1024;
pub const MAX_CONTENT_INDEX_ENTRIES: usize = 20_000;
pub const MAX_CONTENT_INDEX_FILE_BYTES: u64 = 72 * 1024 * 1024;
pub const MAX_CONTENT_CHARS: usize = 1_000_000;

pub fn validate_text(source_bytes: u64, content: &str) -> Result<(), &'static str> {
    if source_bytes > MAX_CONTENT_FILE_BYTES {
        return Err("超过正文索引源文件字节上限");
    }
    if content.len() as u64 > MAX_CONTENT_UTF8_BYTES {
        return Err("超过正文索引解码后 UTF-8 字节上限");
    }
    if content.chars().take(MAX_CONTENT_CHARS + 1).count() > MAX_CONTENT_CHARS {
        return Err("超过正文索引 Unicode 字符上限");
    }
    Ok(())
}

pub fn validate_entry(item: &ContentDocument) -> Result<(), &'static str> {
    if !valid_id(&item.file_id)
        || item.path.is_empty()
        || item.path.len() > filesystem::recursive_import::MAX_PATH_BYTES
    {
        return Err("正文缓存条目结构无效");
    }
    validate_text(item.size, &item.content)
}

pub fn valid_id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 96
        && !value.contains(['/', '\\', ':'])
        && !value.contains("..")
        && !value
            .chars()
            .any(|character| character.is_control() || character.is_whitespace())
}
