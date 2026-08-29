use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    process::{ChildStderr, ChildStdout, Command, Stdio},
    thread::JoinHandle,
    time::{Duration, Instant},
};

use uuid::Uuid;

use crate::filesystem;

const CONVERSION_TIMEOUT: Duration = Duration::from_secs(60);

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DocConversionError {
    MissingConverter,
    Failed,
    TimedOut,
}

#[derive(Debug)]
pub(crate) struct ConvertedPdf {
    pub path: PathBuf,
    pub temporary_directory: PathBuf,
    pub byte_length: u64,
}

pub(crate) fn converter_available() -> bool {
    resolve_soffice().is_some()
}

pub(crate) fn convert_to_pdf(input: &Path) -> Result<ConvertedPdf, DocConversionError> {
    let Some(executable) = resolve_soffice() else {
        return Err(DocConversionError::MissingConverter);
    };
    let temporary_directory =
        create_temporary_directory().map_err(|_| DocConversionError::Failed)?;
    let Some(stem) = input.file_stem().and_then(|stem| stem.to_str()) else {
        remove_temporary_directory(&temporary_directory);
        return Err(DocConversionError::Failed);
    };
    let output_path = temporary_directory.join(format!("{stem}.pdf"));

    let child_result = Command::new(&executable)
        .args([
            "--headless",
            "--convert-to",
            "pdf",
            "--outdir",
            temporary_directory.to_string_lossy().as_ref(),
            input.to_string_lossy().as_ref(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match child_result {
        Ok(child) => child,
        Err(_) => {
            remove_temporary_directory(&temporary_directory);
            return Err(DocConversionError::Failed);
        }
    };
    let stdout_reader = child.stdout.take().map(drain_pipe::<ChildStdout>);
    let stderr_reader = child.stderr.take().map(drain_pipe::<ChildStderr>);

    let started_at = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started_at.elapsed() >= CONVERSION_TIMEOUT => {
                let _ = child.kill();
                let _ = child.wait();
                join_pipe(stdout_reader);
                join_pipe(stderr_reader);
                remove_temporary_directory(&temporary_directory);
                return Err(DocConversionError::TimedOut);
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                join_pipe(stdout_reader);
                join_pipe(stderr_reader);
                remove_temporary_directory(&temporary_directory);
                return Err(DocConversionError::Failed);
            }
        }
    }

    let status = match child.wait() {
        Ok(status) => status,
        Err(_) => {
            join_pipe(stdout_reader);
            join_pipe(stderr_reader);
            remove_temporary_directory(&temporary_directory);
            return Err(DocConversionError::Failed);
        }
    };
    join_pipe(stdout_reader);
    join_pipe(stderr_reader);
    if !status.success() {
        remove_temporary_directory(&temporary_directory);
        return Err(DocConversionError::Failed);
    }

    let output_path = match fs::canonicalize(&output_path) {
        Ok(path) => path,
        Err(_) => {
            remove_temporary_directory(&temporary_directory);
            return Err(DocConversionError::Failed);
        }
    };
    let canonical_directory = match fs::canonicalize(&temporary_directory) {
        Ok(path) => path,
        Err(_) => {
            remove_temporary_directory(&temporary_directory);
            return Err(DocConversionError::Failed);
        }
    };
    let metadata = match fs::symlink_metadata(&output_path) {
        Ok(metadata) => metadata,
        Err(_) => {
            remove_temporary_directory(&temporary_directory);
            return Err(DocConversionError::Failed);
        }
    };
    if filesystem::is_unsafe_metadata(&metadata)
        || !metadata.is_file()
        || output_path.parent() != Some(canonical_directory.as_path())
    {
        remove_temporary_directory(&temporary_directory);
        return Err(DocConversionError::Failed);
    }

    Ok(ConvertedPdf {
        path: output_path,
        temporary_directory,
        byte_length: metadata.len(),
    })
}

fn resolve_soffice() -> Option<PathBuf> {
    let executable_name = if cfg!(windows) {
        "soffice.exe"
    } else {
        "soffice"
    };
    let mut candidates = Vec::new();

    #[cfg(windows)]
    {
        for variable in ["ProgramFiles", "ProgramW6432", "ProgramFiles(x86)"] {
            if let Some(root) = std::env::var_os(variable) {
                candidates.push(PathBuf::from(root).join("LibreOffice/program/soffice.exe"));
            }
        }
        if let Some(root) = std::env::var_os("LOCALAPPDATA") {
            candidates.push(PathBuf::from(root).join("Programs/LibreOffice/program/soffice.exe"));
        }
    }

    #[cfg(not(windows))]
    {
        candidates.extend([
            PathBuf::from("/usr/bin/soffice"),
            PathBuf::from("/usr/local/bin/soffice"),
        ]);
    }

    if let Some(path_variable) = std::env::var_os("PATH") {
        candidates
            .extend(std::env::split_paths(&path_variable).map(|path| path.join(executable_name)));
    }

    candidates.into_iter().find_map(|candidate| {
        let canonical = fs::canonicalize(candidate).ok()?;
        let metadata = fs::symlink_metadata(&canonical).ok()?;
        (metadata.is_file() && !filesystem::is_unsafe_metadata(&metadata)).then_some(canonical)
    })
}

fn create_temporary_directory() -> std::io::Result<PathBuf> {
    let root = std::env::temp_dir();
    for _ in 0..3 {
        let path = root.join(format!(
            "local-material-preview-{}",
            Uuid::new_v4().simple()
        ));
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(error),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "preview directory collision",
    ))
}

pub(crate) fn remove_temporary_directory(path: &Path) {
    let Some(name) = path.file_name().and_then(|name| name.to_str()) else {
        return;
    };
    if name.starts_with("local-material-preview-")
        && path.parent() == Some(std::env::temp_dir().as_path())
    {
        let _ = fs::remove_dir_all(path);
    }
}

fn drain_pipe<T: Read + Send + 'static>(mut pipe: T) -> JoinHandle<Vec<u8>> {
    std::thread::spawn(move || {
        let mut output = Vec::new();
        let _ = pipe.read_to_end(&mut output);
        output
    })
}

fn join_pipe(reader: Option<JoinHandle<Vec<u8>>>) {
    if let Some(reader) = reader {
        let _ = reader.join();
    }
}

#[cfg(test)]
mod tests {
    use super::{create_temporary_directory, remove_temporary_directory};

    #[test]
    fn owned_temporary_directory_is_created_and_removed() {
        let path = create_temporary_directory().expect("temporary directory should be created");
        assert!(path.is_dir());
        remove_temporary_directory(&path);
        assert!(!path.exists());
    }
}
