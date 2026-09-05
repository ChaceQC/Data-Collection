use std::{
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::Path,
    time::{SystemTime, UNIX_EPOCH},
};

use atomic_write_file::AtomicWriteFile;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AppDataFile {
    Index,
    ContentIndex,
    Settings,
    OperationHistory,
    FloatingPlacement,
    PendingOperations,
}

impl AppDataFile {
    const fn max_bytes(self) -> u64 {
        match self {
            Self::Index => 64 * 1024 * 1024,
            Self::ContentIndex => super::content_limits::MAX_CONTENT_INDEX_FILE_BYTES,
            Self::Settings => 64 * 1024,
            Self::OperationHistory => 16 * 1024 * 1024,
            Self::FloatingPlacement => 64 * 1024,
            Self::PendingOperations => 8 * 1024 * 1024,
        }
    }

    const fn fallback_name(self) -> &'static str {
        match self {
            Self::Index => "index.json",
            Self::ContentIndex => "content-index.json",
            Self::Settings => "settings.json",
            Self::OperationHistory => "operation-history.json",
            Self::FloatingPlacement => "floating-ball.json",
            Self::PendingOperations => "pending-operations.json",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum AppDataError {
    Read,
    TooLarge,
    Unsafe,
    Write,
    Directory,
}

pub(crate) fn ensure_parent(path: &Path) -> Result<(), AppDataError> {
    let parent = path.parent().ok_or(AppDataError::Directory)?;
    ensure_directory(parent)
}

fn verify_parent(path: &Path) -> Result<(), AppDataError> {
    let parent = path.parent().ok_or(AppDataError::Directory)?;
    verify_directory(parent)
}

pub(crate) fn ensure_directory(path: &Path) -> Result<(), AppDataError> {
    if path.as_os_str().is_empty() {
        return Err(AppDataError::Directory);
    }

    let mut missing = Vec::new();
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                ensure_directory_metadata(&metadata)?;
            }
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                missing.push(ancestor.to_path_buf());
            }
            Err(_) => return Err(AppDataError::Directory),
        }
    }

    for directory in missing.into_iter().rev() {
        match fs::create_dir(&directory) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(_) => return Err(AppDataError::Directory),
        }
        let metadata = fs::symlink_metadata(&directory).map_err(|_| AppDataError::Directory)?;
        ensure_directory_metadata(&metadata)?;
    }
    Ok(())
}

fn verify_directory(path: &Path) -> Result<(), AppDataError> {
    if path.as_os_str().is_empty() {
        return Err(AppDataError::Directory);
    }
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        let metadata = fs::symlink_metadata(ancestor).map_err(|_| AppDataError::Directory)?;
        ensure_directory_metadata(&metadata)?;
    }
    Ok(())
}

pub(crate) fn read(path: &Path, file_kind: AppDataFile) -> Result<Option<Vec<u8>>, AppDataError> {
    verify_parent(path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppDataError::Read),
    };
    ensure_regular_file_metadata(&metadata)?;
    let max_bytes = file_kind.max_bytes();
    if metadata.len() > max_bytes {
        return Err(AppDataError::TooLarge);
    }

    let source = match File::open(path) {
        Ok(source) => source,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppDataError::Read),
    };
    let opened_metadata = source.metadata().map_err(|_| AppDataError::Read)?;
    if !crate::filesystem::same_file_metadata(&metadata, &opened_metadata) {
        return Err(AppDataError::Unsafe);
    }

    let mut bytes = Vec::with_capacity(metadata.len().min(max_bytes) as usize);
    source
        .take(max_bytes.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| AppDataError::Read)?;
    if bytes.len() as u64 > max_bytes {
        return Err(AppDataError::TooLarge);
    }

    let current_metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(AppDataError::Read),
    };
    ensure_regular_file_metadata(&current_metadata)?;
    if !crate::filesystem::same_file_metadata(&opened_metadata, &current_metadata) {
        return Err(AppDataError::Unsafe);
    }
    Ok(Some(bytes))
}

pub(crate) fn write(path: &Path, file_kind: AppDataFile, bytes: &[u8]) -> Result<(), AppDataError> {
    if bytes.len() as u64 > file_kind.max_bytes() {
        return Err(AppDataError::TooLarge);
    }
    verify_parent(path)?;
    ensure_target(path)?;

    let mut target = AtomicWriteFile::open(path).map_err(|_| AppDataError::Write)?;
    target.write_all(bytes).map_err(|_| AppDataError::Write)?;

    verify_parent(path)?;
    ensure_target(path)?;
    target.commit().map_err(|_| AppDataError::Write)
}

pub(crate) fn remove(path: &Path) -> Result<(), AppDataError> {
    verify_parent(path)?;
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(_) => return Err(AppDataError::Read),
    };
    ensure_regular_file_metadata(&metadata)?;
    fs::remove_file(path).map_err(|_| AppDataError::Write)
}

pub(crate) fn backup(path: &Path, file_kind: AppDataFile) -> bool {
    if verify_parent(path).is_err() {
        return false;
    }
    let Ok(source_metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if ensure_regular_file_metadata(&source_metadata).is_err() {
        return false;
    }
    if source_metadata.len() > file_kind.max_bytes() {
        return false;
    }
    let Some(parent) = path.parent() else {
        return false;
    };
    let base_name = backup_base_name(path, file_kind);
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();

    for attempt in 0..3_u32 {
        let backup_path = parent.join(format!("{base_name}.recovery-{timestamp}-{attempt}.bak"));
        if fs::symlink_metadata(&backup_path).is_ok() {
            continue;
        }
        if copy_backup(path, &backup_path, &source_metadata).is_ok() {
            return true;
        }
    }
    false
}

fn ensure_target(path: &Path) -> Result<(), AppDataError> {
    match fs::symlink_metadata(path) {
        Ok(metadata) => ensure_regular_file_metadata(&metadata),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(_) => Err(AppDataError::Read),
    }
}

fn ensure_directory_metadata(metadata: &fs::Metadata) -> Result<(), AppDataError> {
    if crate::filesystem::is_unsafe_metadata(metadata) || !metadata.is_dir() {
        return Err(AppDataError::Directory);
    }
    Ok(())
}

fn ensure_regular_file_metadata(metadata: &fs::Metadata) -> Result<(), AppDataError> {
    if crate::filesystem::is_unsafe_metadata(metadata) || !metadata.is_file() {
        return Err(AppDataError::Unsafe);
    }
    Ok(())
}

fn backup_base_name(path: &Path, file_kind: AppDataFile) -> String {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return file_kind.fallback_name().to_string();
    };
    if name.is_empty()
        || name.len() > 128
        || name.chars().any(|character| {
            character.is_control()
                || matches!(
                    character,
                    '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*'
                )
        })
    {
        file_kind.fallback_name().to_string()
    } else {
        name.to_string()
    }
}

fn copy_backup(
    source_path: &Path,
    backup_path: &Path,
    source_metadata: &fs::Metadata,
) -> io::Result<()> {
    let mut source = File::open(source_path)?;
    let opened_metadata = source.metadata()?;
    if !crate::filesystem::same_file_metadata(source_metadata, &opened_metadata) {
        return Err(io::Error::new(io::ErrorKind::InvalidData, "source changed"));
    }

    let mut backup = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(backup_path)?;
    let copy_result = (|| {
        let copied = io::copy(&mut source, &mut backup)?;
        if copied != source_metadata.len() {
            return Err(io::Error::new(
                io::ErrorKind::UnexpectedEof,
                "backup truncated",
            ));
        }
        backup.sync_all()?;
        let backup_metadata = fs::symlink_metadata(backup_path)?;
        ensure_regular_file_metadata(&backup_metadata)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidData, "unsafe backup"))?;
        Ok(())
    })();
    if copy_result.is_err() {
        let _ = fs::remove_file(backup_path);
        return copy_result;
    }

    let current_metadata = fs::symlink_metadata(source_path)?;
    if crate::filesystem::is_unsafe_metadata(&current_metadata)
        || !current_metadata.is_file()
        || !crate::filesystem::same_file_metadata(&opened_metadata, &current_metadata)
    {
        let _ = fs::remove_file(backup_path);
        return Err(io::Error::new(io::ErrorKind::InvalidData, "source changed"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{backup, ensure_directory, read, write, AppDataError, AppDataFile};
    use std::{
        fs,
        path::{Path, PathBuf},
        time::SystemTime,
    };

    #[test]
    fn bounds_reads_and_writes_before_json_is_parsed() {
        let path = unique_path("settings.json");
        let oversized = vec![b'x'; (AppDataFile::Settings.max_bytes() + 1) as usize];
        assert!(matches!(
            write(&path, AppDataFile::Settings, &oversized),
            Err(AppDataError::TooLarge)
        ));
        fs::write(&path, oversized).expect("oversized file should be written");
        assert!(matches!(
            read(&path, AppDataFile::Settings),
            Err(AppDataError::TooLarge)
        ));
        cleanup(path);
    }

    #[test]
    fn applies_a_raw_byte_limit_to_each_app_data_file_kind() {
        let kinds = [
            (AppDataFile::Index, "index.json"),
            (AppDataFile::ContentIndex, "content-index.json"),
            (AppDataFile::Settings, "settings.json"),
            (AppDataFile::OperationHistory, "operation-history.json"),
            (AppDataFile::FloatingPlacement, "floating-ball.json"),
            (AppDataFile::PendingOperations, "pending-operations.json"),
        ];
        for (kind, name) in kinds {
            let path = unique_path(name);
            let file = fs::File::create(&path).expect("oversized file should be created");
            file.set_len(kind.max_bytes() + 1)
                .expect("oversized file should be extended");
            assert!(matches!(read(&path, kind), Err(AppDataError::TooLarge)));
            cleanup(path);
        }
    }

    #[test]
    fn rejects_directory_targets_without_replacing_them() {
        let directory = unique_path("settings.json");
        ensure_directory(&directory).expect("test directory should be created");
        assert!(matches!(
            write(&directory, AppDataFile::Settings, b"{}"),
            Err(AppDataError::Unsafe)
        ));
        assert!(directory.is_dir());
        cleanup(directory);
    }

    #[test]
    fn creates_a_bounded_backup_while_preserving_the_source() {
        let path = unique_path("settings.json");
        fs::write(&path, b"original").expect("source should be written");
        assert!(backup(&path, AppDataFile::Settings));
        assert_eq!(fs::read(&path).expect("source should remain"), b"original");
        let backup_prefix = format!(
            "{}.recovery-",
            path.file_name()
                .expect("source should have a file name")
                .to_string_lossy()
        );
        let backup_count = fs::read_dir(path.parent().expect("parent should exist"))
            .expect("parent should be readable")
            .flatten()
            .filter(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with(&backup_prefix)
            })
            .count();
        assert_eq!(backup_count, 1);
        cleanup_recovery_files(&path);
        cleanup(path);
    }

    #[cfg(unix)]
    #[test]
    fn refuses_to_read_or_replace_a_symbolic_link() {
        use std::os::unix::fs::symlink;

        let target = unique_path("settings-target.json");
        let path = unique_path("settings.json");
        fs::write(&target, b"target").expect("target should be written");
        symlink(&target, &path).expect("symbolic link should be created");
        assert!(matches!(
            read(&path, AppDataFile::Settings),
            Err(AppDataError::Unsafe)
        ));
        assert!(matches!(
            write(&path, AppDataFile::Settings, b"replacement"),
            Err(AppDataError::Unsafe)
        ));
        assert_eq!(
            fs::read(&target).expect("link target should remain"),
            b"target"
        );
        cleanup(path);
        cleanup(target);
    }

    fn unique_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("clock should be available")
            .as_nanos();
        std::env::temp_dir().join(format!("local-material-app-data-{timestamp}-{name}"))
    }

    fn cleanup(path: PathBuf) {
        if path.is_dir() {
            let _ = fs::remove_dir_all(path);
        } else {
            let _ = fs::remove_file(path);
        }
    }

    fn cleanup_recovery_files(path: &Path) {
        if let Some(parent) = path.parent() {
            let backup_prefix = format!(
                "{}.recovery-",
                path.file_name()
                    .expect("source should have a file name")
                    .to_string_lossy()
            );
            if let Ok(entries) = fs::read_dir(parent) {
                for entry in entries.flatten() {
                    if entry
                        .file_name()
                        .to_string_lossy()
                        .starts_with(&backup_prefix)
                    {
                        let _ = fs::remove_file(entry.path());
                    }
                }
            }
        }
    }
}
