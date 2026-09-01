use std::{
    collections::{HashMap, HashSet},
    fs::{self, Metadata},
    hash::{Hash, Hasher},
    path::{Path, PathBuf},
    sync::OnceLock,
    time::{SystemTime, UNIX_EPOCH},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

pub(crate) mod clipboard;
pub(crate) mod external;
pub(crate) mod operations;

pub const MAX_INDEX_ENTRIES: usize = 20_000;

#[derive(Debug, Error)]
pub enum FileSystemError {
    #[error("请选择可访问的普通文件")]
    InvalidFile,
    #[error("请选择可访问的文件夹")]
    InvalidDirectory,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct FileTypeInfo {
    pub extension: String,
    pub kind: String,
    pub file_type: String,
    pub language: Option<String>,
    pub media_type: Option<String>,
    pub max_bytes: u64,
    pub max_pixels: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedFileTypeDefinition {
    kind: String,
    file_type: String,
    language: Option<String>,
    media_type: Option<String>,
    limit: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SharedPreviewLimit {
    label: String,
    max_bytes: u64,
    max_pixels: Option<u64>,
}

#[derive(Clone, Debug, Deserialize)]
struct SharedFileTypeManifest {
    limits: HashMap<String, SharedPreviewLimit>,
    extensions: HashMap<String, SharedFileTypeDefinition>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct PreviewLimitSpec {
    pub label: String,
    pub max_bytes: u64,
    pub max_pixels: Option<u64>,
}

const SHARED_FILE_TYPES_JSON: &str = include_str!("../../../shared/file-types.json");
const PREVIEW_LIMIT_KEYS: &[&str] = &["text", "office", "pdf", "image", "video"];
static SHARED_FILE_TYPE_MANIFEST: OnceLock<Option<SharedFileTypeManifest>> = OnceLock::new();

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PreviewPathError {
    Missing,
    PermissionDenied,
    Invalid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum PathValidationError {
    Missing,
    PermissionDenied,
    Invalid,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndexEntry {
    pub id: String,
    pub path: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub size: u64,
    pub modified_at: i64,
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default)]
    pub invalid: bool,
    #[serde(default)]
    pub favorite: bool,
    #[serde(default = "default_added_at")]
    pub added_at: i64,
    #[serde(default = "default_preview_status")]
    pub preview_status: String,
    #[serde(default)]
    pub last_recorded_at: Option<i64>,
    #[serde(default)]
    pub last_opened_at: Option<i64>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub group_id: Option<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DirectoryEntry {
    pub id: String,
    pub name: String,
    pub kind: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub size: u64,
    pub modified_at: i64,
    pub status: String,
    pub invalid: bool,
    pub favorite: bool,
    pub added_at: i64,
    pub preview_status: String,
    pub last_recorded_at: Option<i64>,
    pub last_opened_at: Option<i64>,
    pub tags: Vec<String>,
    pub group_id: Option<String>,
    pub directory_id: String,
    pub relative_path: Vec<String>,
}

impl DirectoryEntry {
    pub(crate) fn from_index_entry(
        entry: IndexEntry,
        directory_id: String,
        relative_path: Vec<String>,
    ) -> Self {
        Self {
            id: entry.id,
            name: entry.name,
            kind: entry.kind,
            file_type: entry.file_type,
            size: entry.size,
            modified_at: entry.modified_at,
            status: entry.status,
            invalid: entry.invalid,
            favorite: entry.favorite,
            added_at: entry.added_at,
            preview_status: entry.preview_status,
            last_recorded_at: entry.last_recorded_at,
            last_opened_at: entry.last_opened_at,
            tags: entry.tags,
            group_id: entry.group_id,
            directory_id,
            relative_path,
        }
    }
}

#[derive(Debug, Default)]
pub struct ScanResult {
    pub entries: Vec<IndexEntry>,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
}

const MAX_SKIP_REASONS: usize = 32;

fn default_status() -> String {
    "已登记".to_string()
}

fn default_preview_status() -> String {
    "idle".to_string()
}

fn default_added_at() -> i64 {
    0
}

pub fn scan_paths(paths: &[String]) -> ScanResult {
    let mut result = ScanResult::default();
    let mut seen_paths = HashSet::new();

    for raw_path in paths {
        if result.entries.len() >= MAX_INDEX_ENTRIES {
            result.truncated = true;
            break;
        }

        let path = match canonicalize_existing_path(raw_path) {
            Ok(path) => path,
            Err(error) => {
                record_skipped(&mut result, path_error_category(error));
                continue;
            }
        };

        let metadata = match fs::symlink_metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) => {
                record_skipped(&mut result, path_error_category(map_path_io_error(error)));
                continue;
            }
        };

        if is_unsafe_metadata(&metadata) {
            record_skipped(&mut result, "路径不安全");
        } else if metadata.is_file() {
            add_file_entry(path, metadata, &mut seen_paths, &mut result);
        } else if metadata.is_dir() {
            add_folder_entry(path, metadata, &mut seen_paths, &mut result);
        } else {
            record_skipped(&mut result, "不是普通文件或文件夹");
        }
    }

    result
}

pub fn list_directory(raw_path: &str) -> Result<Vec<IndexEntry>, FileSystemError> {
    let path =
        canonicalize_selected_path(raw_path).map_err(|_| FileSystemError::InvalidDirectory)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| FileSystemError::InvalidDirectory)?;
    if is_unsafe_metadata(&metadata) || !metadata.is_dir() {
        return Err(FileSystemError::InvalidDirectory);
    }

    let mut entries = Vec::new();
    for entry in fs::read_dir(path).map_err(|_| FileSystemError::InvalidDirectory)? {
        let entry = entry.map_err(|_| FileSystemError::InvalidDirectory)?;
        let child_path = entry.path();
        let child_metadata =
            fs::symlink_metadata(&child_path).map_err(|_| FileSystemError::InvalidDirectory)?;
        if is_unsafe_metadata(&child_metadata) {
            continue;
        }
        if child_metadata.is_file() {
            if let Some(index_entry) = build_file_entry(child_path, &child_metadata) {
                entries.push(index_entry);
            }
        } else if child_metadata.is_dir() {
            if let Some(index_entry) = build_folder_entry(child_path, &child_metadata) {
                entries.push(index_entry);
            }
        }
        if entries.len() >= MAX_INDEX_ENTRIES {
            break;
        }
    }
    sort_entries(&mut entries);
    Ok(entries)
}

pub fn index_selected_path(raw_path: &str) -> Result<IndexEntry, FileSystemError> {
    let path = canonicalize_selected_path(raw_path)?;
    let metadata = fs::symlink_metadata(&path).map_err(|_| FileSystemError::InvalidFile)?;
    if is_unsafe_metadata(&metadata) {
        return Err(FileSystemError::InvalidFile);
    }
    if metadata.is_file() {
        return build_file_entry(path, &metadata).ok_or(FileSystemError::InvalidFile);
    }
    if metadata.is_dir() {
        return build_folder_entry(path, &metadata).ok_or(FileSystemError::InvalidFile);
    }
    Err(FileSystemError::InvalidFile)
}

pub fn refresh_entry(entry: &mut IndexEntry) -> bool {
    let path = Path::new(&entry.path);
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata)
            if !is_unsafe_metadata(&metadata)
                && ((entry.kind == "folder" && metadata.is_dir())
                    || (entry.kind != "folder" && metadata.is_file())) =>
        {
            metadata
        }
        _ => {
            let changed = !entry.invalid || entry.status != "路径失效";
            entry.invalid = true;
            entry.status = "路径失效".to_string();
            return changed;
        }
    };

    let updated = if entry.kind == "folder" {
        build_folder_entry(path.to_path_buf(), &metadata)
    } else {
        build_file_entry(path.to_path_buf(), &metadata)
    };
    let Some(updated) = updated else {
        let changed = !entry.invalid || entry.status != "路径失效";
        entry.invalid = true;
        entry.status = "路径失效".to_string();
        return changed;
    };

    apply_refreshed_metadata(entry, &updated)
}

pub(crate) fn refresh_entry_snapshot(entry: &IndexEntry) -> IndexEntry {
    let mut refreshed = entry.clone();
    refresh_entry(&mut refreshed);
    refreshed
}

pub(crate) fn apply_refreshed_metadata(entry: &mut IndexEntry, updated: &IndexEntry) -> bool {
    let changed = entry.invalid
        || entry.status != updated.status
        || entry.name != updated.name
        || entry.kind != updated.kind
        || entry.file_type != updated.file_type
        || entry.size != updated.size
        || entry.modified_at != updated.modified_at;
    entry.name = updated.name.clone();
    entry.kind = updated.kind.clone();
    entry.file_type = updated.file_type.clone();
    entry.size = updated.size;
    entry.modified_at = updated.modified_at;
    entry.invalid = updated.invalid;
    entry.status = updated.status.clone();
    changed
}

pub fn same_path(left: &str, right: &str) -> bool {
    normalize_path_key(Path::new(left)) == normalize_path_key(Path::new(right))
}

pub(crate) fn path_identity(raw_path: &str) -> String {
    normalize_path_key(Path::new(raw_path))
}

pub(crate) fn validate_preview_file(
    raw_path: &str,
) -> Result<(PathBuf, Metadata), PreviewPathError> {
    validate_regular_file_path(raw_path).map_err(map_path_validation_error)
}

pub(crate) fn validate_regular_file_path(
    raw_path: &str,
) -> Result<(PathBuf, Metadata), PathValidationError> {
    let path = canonicalize_existing_path(raw_path)?;
    let metadata = fs::symlink_metadata(&path).map_err(map_path_io_error)?;
    if is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(PathValidationError::Invalid);
    }
    Ok((path, metadata))
}

pub(crate) fn validate_directory_path(raw_path: &str) -> Result<PathBuf, PathValidationError> {
    let path = canonicalize_existing_path(raw_path)?;
    let metadata = fs::symlink_metadata(&path).map_err(map_path_io_error)?;
    if is_unsafe_metadata(&metadata) || !metadata.is_dir() {
        return Err(PathValidationError::Invalid);
    }
    Ok(path)
}

pub(crate) fn resolve_directory_child(
    raw_root: &str,
    relative_path: &[String],
) -> Result<PathBuf, PathValidationError> {
    if relative_path.len() > 128 {
        return Err(PathValidationError::Invalid);
    }
    let root = validate_directory_path(raw_root)?;
    let mut current = root.clone();
    for component in relative_path {
        validate_relative_component(component)?;
        let candidate = current.join(component);
        let resolved = canonicalize_existing_path(&candidate.to_string_lossy())?;
        if !is_path_within(&root, &resolved) {
            return Err(PathValidationError::Invalid);
        }
        current = resolved;
    }
    Ok(current)
}

pub(crate) fn is_path_within(root: &Path, candidate: &Path) -> bool {
    let root_key = normalize_path_key(root).trim_end_matches('\\').to_string();
    let candidate_key = normalize_path_key(candidate);
    candidate_key == root_key || candidate_key.starts_with(&(root_key + "\\"))
}

fn add_folder_entry(
    path: PathBuf,
    metadata: Metadata,
    seen_paths: &mut HashSet<String>,
    result: &mut ScanResult,
) {
    let key = normalize_path_key(&path);
    if !seen_paths.insert(key) {
        return;
    }
    if let Some(entry) = build_folder_entry(path, &metadata) {
        result.entries.push(entry);
    } else {
        record_skipped(result, "无法读取文件夹名称");
    }
}

fn add_file_entry(
    path: PathBuf,
    metadata: Metadata,
    seen_paths: &mut HashSet<String>,
    result: &mut ScanResult,
) {
    let key = normalize_path_key(&path);
    if !seen_paths.insert(key) {
        return;
    }
    if let Some(entry) = build_file_entry(path, &metadata) {
        result.entries.push(entry);
    } else {
        record_skipped(result, "无法读取文件名称");
    }
}

fn record_skipped(result: &mut ScanResult, reason: &str) {
    result.skipped_count += 1;
    if result.skipped_reasons.len() < MAX_SKIP_REASONS
        && !result.skipped_reasons.iter().any(|item| item == reason)
    {
        result.skipped_reasons.push(reason.to_string());
    }
}

fn canonicalize_selected_path(raw_path: &str) -> Result<PathBuf, FileSystemError> {
    canonicalize_existing_path(raw_path).map_err(|_| FileSystemError::InvalidFile)
}

fn build_file_entry(path: PathBuf, metadata: &Metadata) -> Option<IndexEntry> {
    let (kind, file_type) = classify_path(&path);
    build_entry(path, metadata, kind, file_type, metadata.len())
}

fn build_folder_entry(path: PathBuf, metadata: &Metadata) -> Option<IndexEntry> {
    build_entry(path, metadata, "folder", "文件夹", 0)
}

fn build_entry(
    path: PathBuf,
    metadata: &Metadata,
    kind: impl Into<String>,
    file_type: impl Into<String>,
    size: u64,
) -> Option<IndexEntry> {
    let name = path.file_name()?.to_string_lossy().into_owned();
    Some(IndexEntry {
        id: make_id(&path),
        path: path.to_string_lossy().into_owned(),
        name,
        kind: kind.into(),
        file_type: file_type.into(),
        size,
        modified_at: modified_timestamp(metadata),
        status: "已登记".to_string(),
        invalid: false,
        favorite: false,
        added_at: current_timestamp(),
        preview_status: default_preview_status(),
        last_recorded_at: None,
        last_opened_at: None,
        tags: Vec::new(),
        group_id: None,
    })
}

fn sort_entries(entries: &mut [IndexEntry]) {
    entries.sort_by(|left, right| {
        right
            .modified_at
            .cmp(&left.modified_at)
            .then_with(|| left.name.cmp(&right.name))
            .then_with(|| left.id.cmp(&right.id))
    });
}

pub(crate) fn type_info_for_path(path: &Path) -> Option<FileTypeInfo> {
    let extension = path
        .extension()
        .and_then(|extension| extension.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    type_info_for_extension(&extension)
}

pub(crate) fn type_info_for_extension(extension: &str) -> Option<FileTypeInfo> {
    let extension = extension.trim_start_matches('.').to_ascii_lowercase();
    let manifest = shared_file_type_manifest()?;
    let definition = manifest.extensions.get(&extension)?;
    let limit_key = definition.limit.as_deref()?;
    let limit = manifest.limits.get(limit_key)?;
    Some(FileTypeInfo {
        extension,
        kind: definition.kind.clone(),
        file_type: definition.file_type.clone(),
        language: definition.language.clone(),
        media_type: definition.media_type.clone(),
        max_bytes: limit.max_bytes,
        max_pixels: limit.max_pixels,
    })
}

fn classify_path(path: &Path) -> (String, String) {
    type_info_for_path(path)
        .map(|info| (info.kind, info.file_type))
        .unwrap_or_else(|| ("other".to_string(), "其他文件".to_string()))
}

pub(crate) fn preview_limit_bytes(key: &str) -> Option<u64> {
    shared_file_type_manifest()?
        .limits
        .get(key)
        .map(|limit| limit.max_bytes)
}

pub(crate) fn preview_limits() -> Vec<PreviewLimitSpec> {
    let Some(manifest) = shared_file_type_manifest() else {
        return Vec::new();
    };
    PREVIEW_LIMIT_KEYS
        .iter()
        .filter_map(|key| manifest.limits.get(*key))
        .map(|limit| PreviewLimitSpec {
            label: limit.label.clone(),
            max_bytes: limit.max_bytes,
            max_pixels: limit.max_pixels,
        })
        .collect()
}

fn shared_file_type_manifest() -> Option<&'static SharedFileTypeManifest> {
    SHARED_FILE_TYPE_MANIFEST
        .get_or_init(|| serde_json::from_str(SHARED_FILE_TYPES_JSON).ok())
        .as_ref()
}

fn modified_timestamp(metadata: &Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0)
}

fn make_id(path: &Path) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    normalize_path_key(path).hash(&mut hasher);
    format!("file-{:016x}", hasher.finish())
}

fn normalize_path_key(path: &Path) -> String {
    let path = path.to_string_lossy().replace('/', "\\");
    #[cfg(windows)]
    {
        path.to_ascii_lowercase()
    }
    #[cfg(not(windows))]
    {
        path
    }
}

pub(crate) fn is_unsafe_metadata(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    is_reparse_point(metadata)
}

pub(crate) fn canonicalize_existing_path(raw_path: &str) -> Result<PathBuf, PathValidationError> {
    let trimmed = raw_path.trim();
    if trimmed.is_empty() {
        return Err(PathValidationError::Invalid);
    }

    let input = PathBuf::from(trimmed);
    let absolute = if input.is_absolute() {
        input
    } else {
        std::env::current_dir()
            .map_err(|_| PathValidationError::Invalid)?
            .join(input)
    };
    reject_unsafe_components(&absolute)?;
    let link_metadata = fs::symlink_metadata(&absolute).map_err(map_path_io_error)?;
    if is_unsafe_metadata(&link_metadata) {
        return Err(PathValidationError::Invalid);
    }

    let canonical = fs::canonicalize(&absolute).map_err(map_path_io_error)?;
    reject_unsafe_components(&canonical)?;
    let canonical_metadata = fs::symlink_metadata(&canonical).map_err(map_path_io_error)?;
    if is_unsafe_metadata(&canonical_metadata) {
        return Err(PathValidationError::Invalid);
    }
    Ok(canonical)
}

fn reject_unsafe_components(path: &Path) -> Result<(), PathValidationError> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) if is_unsafe_metadata(&metadata) => {
                return Err(PathValidationError::Invalid)
            }
            Ok(_) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => break,
            Err(error) => return Err(map_path_io_error(error)),
        }
    }
    Ok(())
}

fn validate_relative_component(component: &str) -> Result<(), PathValidationError> {
    if component.is_empty()
        || component == "."
        || component == ".."
        || component.encode_utf16().count() > 255
        || component
            .chars()
            .any(|character| character.is_control() || matches!(character, '/' | '\\' | ':'))
    {
        return Err(PathValidationError::Invalid);
    }
    Ok(())
}

fn map_path_io_error(error: std::io::Error) -> PathValidationError {
    match error.kind() {
        std::io::ErrorKind::NotFound => PathValidationError::Missing,
        std::io::ErrorKind::PermissionDenied => PathValidationError::PermissionDenied,
        _ => PathValidationError::Invalid,
    }
}

fn map_path_validation_error(error: PathValidationError) -> PreviewPathError {
    match error {
        PathValidationError::Missing => PreviewPathError::Missing,
        PathValidationError::PermissionDenied => PreviewPathError::PermissionDenied,
        PathValidationError::Invalid => PreviewPathError::Invalid,
    }
}

fn path_error_category(error: PathValidationError) -> &'static str {
    match error {
        PathValidationError::Missing => "路径不存在",
        PathValidationError::PermissionDenied => "没有访问权限",
        PathValidationError::Invalid => "路径不安全或无效",
    }
}

fn current_timestamp() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs().min(i64::MAX as u64) as i64)
        .unwrap_or(0)
}

#[cfg(windows)]
fn is_reparse_point(metadata: &Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;

    const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
    metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
}

#[cfg(not(windows))]
fn is_reparse_point(_metadata: &Metadata) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::{
        list_directory, preview_limits, resolve_directory_child, same_path, scan_paths,
        type_info_for_extension,
    };
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn reads_file_types_and_preview_limits_from_shared_manifest() {
        let xlsx = type_info_for_extension(".XLSX").expect("shared manifest should define xlsx");
        assert_eq!(xlsx.kind, "xlsx");
        assert_eq!(xlsx.file_type, "Excel 工作簿");
        assert_eq!(xlsx.max_bytes, 20 * 1024 * 1024);
        assert_eq!(preview_limits().len(), 5);
    }

    #[test]
    fn indexes_selected_directory_as_one_folder() {
        let root = unique_temp_dir();
        let nested = root.join("资料 子目录");
        assert!(fs::create_dir_all(&nested).is_ok());
        let file = nested.join("研究 计划.md");
        assert!(fs::write(&file, "# 资料").is_ok());

        let result = scan_paths(&[root.to_string_lossy().into_owned()]);

        assert_eq!(result.entries.len(), 1);
        assert_eq!(
            result.entries[0].name,
            root.file_name().unwrap().to_string_lossy()
        );
        assert_eq!(result.entries[0].kind, "folder");
        assert_eq!(result.entries[0].file_type, "文件夹");
        assert!(!result.entries[0].invalid);
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[test]
    fn lists_direct_children_for_folder_navigation() {
        let root = unique_temp_dir();
        let nested = root.join("子目录");
        assert!(fs::create_dir_all(&nested).is_ok());
        assert!(fs::write(root.join("研究 计划.md"), "# 资料").is_ok());
        assert!(fs::write(nested.join("访谈 记录.txt"), "记录").is_ok());

        let result = list_directory(&root.to_string_lossy()).expect("directory should list");

        assert_eq!(result.len(), 2);
        assert!(result
            .iter()
            .any(|entry| entry.name == "子目录" && entry.kind == "folder"));
        assert!(result
            .iter()
            .any(|entry| entry.name == "研究 计划.md" && entry.kind == "markdown"));
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[test]
    fn resolves_only_registered_directory_children() {
        let root = unique_temp_dir();
        let nested = root.join("子目录");
        assert!(fs::create_dir_all(&nested).is_ok());
        let file = nested.join("资料.txt");
        assert!(fs::write(&file, "内容").is_ok());

        let resolved = resolve_directory_child(
            &root.to_string_lossy(),
            &["子目录".to_string(), "资料.txt".to_string()],
        )
        .expect("registered child should resolve");
        let canonical_file = fs::canonicalize(&file).expect("fixture should canonicalize");
        assert_eq!(resolved, canonical_file);
        assert!(resolve_directory_child(
            &root.to_string_lossy(),
            &["..".to_string(), "outside.txt".to_string()],
        )
        .is_err());
        assert!(fs::remove_dir_all(root).is_ok());
    }

    #[cfg(windows)]
    #[test]
    fn compares_windows_style_paths_without_case_differences() {
        assert!(same_path("C:\\资料\\计划.md", "c:/资料/计划.md"));
    }

    fn unique_temp_dir() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-workbench-{timestamp}"))
    }
}
