use std::{
    fs::{self, Metadata},
    io,
    path::{Path, PathBuf},
};

use thiserror::Error;

use super::{
    is_unsafe_metadata, same_file_metadata, same_path, validate_directory_path,
    validate_regular_file_path, IndexEntry, PathValidationError,
};

#[derive(Debug, Error)]
pub(crate) enum FileOperationError {
    #[error("源文件已失效，请先重新定位或重新导入")]
    SourceMissing,
    #[error("源文件在操作前发生变化，请刷新索引后重试")]
    SourceChanged,
    #[error("没有访问源文件的权限，请检查文件权限")]
    SourcePermissionDenied,
    #[error("只允许操作资料库中的普通文件")]
    SourceInvalid,
    #[error("目标文件夹不存在或不可访问")]
    DestinationInvalid,
    #[error("目标路径包含符号链接或 Windows 重解析点")]
    UnsafePath,
    #[error("目标文件已经存在，请选择其他文件夹")]
    TargetConflict,
    #[error("文件名不能为空或包含 Windows 不允许的字符")]
    InvalidName,
    #[error("文件扩展名不能改变")]
    ExtensionChanged,
    #[error("新文件名与原文件相同")]
    NameUnchanged,
    #[error("重命名文件失败，请检查文件占用或权限")]
    RenameFailed,
    #[error("无法将文件移入回收站，请检查系统回收站状态")]
    RecycleFailed,
}

pub(crate) fn validate_indexed_file(
    entry: &IndexEntry,
) -> Result<(PathBuf, Metadata), FileOperationError> {
    if entry.kind == "folder" {
        return Err(FileOperationError::SourceInvalid);
    }
    validate_indexed_entry(entry)
}

pub(crate) fn validate_indexed_entry(
    entry: &IndexEntry,
) -> Result<(PathBuf, Metadata), FileOperationError> {
    let (path, metadata) = if entry.kind == "folder" {
        let path = validate_directory_path(&entry.path).map_err(map_source_validation_error)?;
        let metadata = fs::symlink_metadata(&path).map_err(map_source_io_error)?;
        (path, metadata)
    } else {
        validate_regular_file_path(&entry.path).map_err(map_source_validation_error)?
    };
    if same_path(&entry.path, &path.to_string_lossy()) {
        Ok((path, metadata))
    } else {
        Err(FileOperationError::SourceInvalid)
    }
}

pub(crate) fn revalidate_indexed_file(
    entry: &IndexEntry,
    expected: &Metadata,
) -> Result<(PathBuf, Metadata), FileOperationError> {
    revalidate_indexed_entry(entry, expected).and_then(|result| {
        if entry.kind == "folder" {
            Err(FileOperationError::SourceInvalid)
        } else {
            Ok(result)
        }
    })
}

pub(crate) fn revalidate_indexed_entry(
    entry: &IndexEntry,
    expected: &Metadata,
) -> Result<(PathBuf, Metadata), FileOperationError> {
    let result = validate_indexed_entry(entry)?;
    if !same_file_metadata(expected, &result.1) {
        return Err(FileOperationError::SourceChanged);
    }
    Ok(result)
}

pub(crate) fn validate_new_name(
    source: &Path,
    new_name: &str,
) -> Result<PathBuf, FileOperationError> {
    validate_file_name(new_name)?;
    let source_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or(FileOperationError::SourceInvalid)?;
    if source_name == new_name || same_path(source_name, new_name) {
        return Err(FileOperationError::NameUnchanged);
    }
    if extension_key(source) != extension_key(Path::new(new_name)) {
        return Err(FileOperationError::ExtensionChanged);
    }

    let parent = source.parent().ok_or(FileOperationError::SourceInvalid)?;
    let parent_string = parent.to_string_lossy();
    validate_directory_path(&parent_string).map_err(|error| match error {
        PathValidationError::Invalid => FileOperationError::UnsafePath,
        PathValidationError::Missing | PathValidationError::PermissionDenied => {
            FileOperationError::DestinationInvalid
        }
    })?;
    let target = parent.join(new_name);
    match fs::symlink_metadata(&target) {
        Ok(metadata) if is_unsafe_metadata(&metadata) => Err(FileOperationError::UnsafePath),
        Ok(_) => Err(FileOperationError::TargetConflict),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(target),
        Err(_) => Err(FileOperationError::DestinationInvalid),
    }
}

pub(crate) fn rename_file(
    source: &Path,
    target: &Path,
    expected: &Metadata,
) -> Result<(), FileOperationError> {
    ensure_regular_file_matches(source, expected)?;
    let parent = target
        .parent()
        .ok_or(FileOperationError::DestinationInvalid)?;
    ensure_directory(parent)?;
    ensure_target_is_available(target)?;
    ensure_regular_file_matches(source, expected)?;
    rename_without_replace(source, target).map_err(|_| FileOperationError::RenameFailed)
}

pub(crate) fn restore_renamed_file(source: &Path, target: &Path, expected: &Metadata) -> bool {
    let Some(parent) = target.parent() else {
        return false;
    };
    if ensure_regular_file_matches(source, expected).is_err()
        || validate_directory_path(&parent.to_string_lossy()).is_err()
        || ensure_target_is_available(target).is_err()
    {
        return false;
    }
    if ensure_regular_file_matches(source, expected).is_err() {
        return false;
    }
    rename_without_replace(source, target).is_ok()
}

#[cfg(windows)]
fn rename_without_replace(source: &Path, target: &Path) -> io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    // MoveFileW 不允许覆盖目标，即使目标在前置检查后才被创建。
    if unsafe {
        windows_sys::Win32::Storage::FileSystem::MoveFileW(source.as_ptr(), target.as_ptr())
    } == 0
    {
        Err(io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn rename_without_replace(source: &Path, target: &Path) -> io::Result<()> {
    fs::hard_link(source, target)?;
    fs::remove_file(source)
}

pub(crate) fn delete_to_recycle_bin(
    path: &Path,
    expected: &Metadata,
) -> Result<(), FileOperationError> {
    ensure_regular_file_matches(path, expected)?;
    ensure_regular_file_matches(path, expected)?;
    trash::delete(path).map_err(|_| FileOperationError::RecycleFailed)
}

fn validate_file_name(name: &str) -> Result<(), FileOperationError> {
    if name.trim().is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 255
        || name.ends_with('.')
        || name.ends_with(' ')
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
        || is_reserved_device_name(name)
    {
        return Err(FileOperationError::InvalidName);
    }
    Ok(())
}

fn is_reserved_device_name(name: &str) -> bool {
    let base = name
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(
        base.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
    )
}

fn extension_key(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| extension.to_ascii_lowercase())
}

fn ensure_target_is_available(target: &Path) -> Result<(), FileOperationError> {
    match fs::symlink_metadata(target) {
        Ok(metadata) if is_unsafe_metadata(&metadata) => Err(FileOperationError::UnsafePath),
        Ok(_) => Err(FileOperationError::TargetConflict),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(FileOperationError::DestinationInvalid),
    }
}

fn ensure_regular_file(path: &Path) -> Result<Metadata, io::Error> {
    let metadata = fs::symlink_metadata(path)?;
    if is_unsafe_metadata(&metadata) || !metadata.is_file() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "not a regular file",
        ));
    }
    Ok(metadata)
}

fn ensure_regular_file_matches(
    path: &Path,
    expected: &Metadata,
) -> Result<Metadata, FileOperationError> {
    let metadata = ensure_regular_file(path).map_err(map_source_io_error)?;
    if !same_file_metadata(expected, &metadata) {
        return Err(FileOperationError::SourceChanged);
    }
    Ok(metadata)
}

fn ensure_directory(path: &Path) -> Result<Metadata, FileOperationError> {
    let metadata = fs::symlink_metadata(path).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::PermissionDenied => {
            FileOperationError::DestinationInvalid
        }
        _ => FileOperationError::DestinationInvalid,
    })?;
    if is_unsafe_metadata(&metadata) {
        return Err(FileOperationError::UnsafePath);
    }
    if !metadata.is_dir() {
        return Err(FileOperationError::DestinationInvalid);
    }
    Ok(metadata)
}

fn map_source_validation_error(error: PathValidationError) -> FileOperationError {
    match error {
        PathValidationError::Missing => FileOperationError::SourceMissing,
        PathValidationError::PermissionDenied => FileOperationError::SourcePermissionDenied,
        PathValidationError::Invalid => FileOperationError::SourceInvalid,
    }
}

fn map_source_io_error(error: io::Error) -> FileOperationError {
    match error.kind() {
        io::ErrorKind::NotFound => FileOperationError::SourceMissing,
        io::ErrorKind::PermissionDenied => FileOperationError::SourcePermissionDenied,
        _ => FileOperationError::SourceInvalid,
    }
}

#[cfg(test)]
mod tests {
    use super::{validate_file_name, validate_indexed_file, validate_new_name, FileOperationError};
    use crate::filesystem::IndexEntry;
    use std::{fs, path::PathBuf, time::SystemTime};

    #[test]
    fn rejects_path_injection_and_reserved_windows_names() {
        for name in ["", ".", "..", "bad/name", "CON.txt", "report?.txt"] {
            assert!(matches!(
                validate_file_name(name),
                Err(FileOperationError::InvalidName)
            ));
        }
    }

    #[test]
    fn keeps_the_original_extension_when_renaming() {
        let root = unique_temp_dir();
        fs::create_dir_all(&root).expect("test directory should be created");
        let source = root.join("资料.txt");
        fs::write(&source, "内容").expect("test file should be written");

        assert!(matches!(
            validate_new_name(&source, "资料.md"),
            Err(FileOperationError::ExtensionChanged)
        ));
        assert!(validate_new_name(&source, "新资料.txt").is_ok());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn reports_missing_source_and_destination_without_touching_other_paths() {
        let root = unique_temp_dir();
        fs::create_dir_all(&root).expect("test directory should be created");
        let missing_source = root.join("不存在.txt");
        let entry = IndexEntry {
            id: "missing".to_string(),
            path: missing_source.to_string_lossy().into_owned(),
            name: "不存在.txt".to_string(),
            kind: "text".to_string(),
            file_type: "文本文件".to_string(),
            size: 0,
            modified_at: 0,
            status: "路径失效".to_string(),
            invalid: true,
            favorite: false,
            added_at: 0,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
        };
        assert!(matches!(
            validate_indexed_file(&entry),
            Err(FileOperationError::SourceMissing)
        ));
        assert!(super::validate_directory_path(&root.join("不存在").to_string_lossy()).is_err());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_a_replaced_source_before_a_file_action() {
        let root = unique_temp_dir();
        fs::create_dir_all(&root).expect("test directory should be created");
        let source = root.join("资料.txt");
        fs::write(&source, "原始文件内容").expect("source file should be written");
        let entry = crate::filesystem::index_selected_path(&source.to_string_lossy())
            .expect("source should be indexable");
        let (_, expected) = super::validate_indexed_file(&entry).expect("source should validate");

        fs::remove_file(&source).expect("original source should be removed");
        fs::write(&source, "被替换后的不同长度文件内容").expect("replacement should be written");

        assert!(matches!(
            super::revalidate_indexed_file(&entry, &expected),
            Err(FileOperationError::SourceChanged)
        ));
        let _ = fs::remove_dir_all(root);
    }

    fn unique_temp_dir() -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-operations-{timestamp}"))
    }
}
