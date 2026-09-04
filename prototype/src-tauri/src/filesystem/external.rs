use std::{fs::Metadata, path::Path};

use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum ExternalOpenError {
    #[cfg(not(windows))]
    #[error("当前平台不支持外部打开")]
    Unsupported,
    #[error("系统默认程序无法打开该文件")]
    LaunchFailed,
    #[error("目标文件在操作前发生变化，请刷新索引后重试")]
    TargetChanged,
    #[error("Windows 资源管理器不可用")]
    ExplorerUnavailable,
}

pub(crate) fn open_with_default(path: &Path, expected: &Metadata) -> Result<(), ExternalOpenError> {
    #[cfg(windows)]
    {
        execute_shell_open(path, None, Some((path, expected, false)))
    }
    #[cfg(not(windows))]
    {
        let _ = (path, expected);
        Err(ExternalOpenError::Unsupported)
    }
}

pub(crate) fn reveal_in_explorer(
    path: &Path,
    is_directory: bool,
    expected: &Metadata,
) -> Result<(), ExternalOpenError> {
    #[cfg(windows)]
    {
        confirm_target(path, is_directory, expected)?;
        if is_directory {
            return execute_shell_open(path, None, None);
        }

        let system_root = std::env::var_os("SystemRoot")
            .map(std::path::PathBuf::from)
            .ok_or(ExternalOpenError::ExplorerUnavailable)?;
        let explorer = system_root.join("explorer.exe");
        let metadata = std::fs::symlink_metadata(&explorer)
            .map_err(|_| ExternalOpenError::ExplorerUnavailable)?;
        if super::is_unsafe_metadata(&metadata) || !metadata.is_file() {
            return Err(ExternalOpenError::ExplorerUnavailable);
        }
        execute_shell_open(&explorer, explorer_parameters(path, false).as_deref(), None)
    }
    #[cfg(not(windows))]
    {
        let _ = (path, is_directory, expected);
        Err(ExternalOpenError::Unsupported)
    }
}

#[cfg(windows)]
fn execute_shell_open(
    path: &Path,
    parameters: Option<&str>,
    expected: Option<(&Path, &Metadata, bool)>,
) -> Result<(), ExternalOpenError> {
    use std::{os::windows::ffi::OsStrExt, ptr::null_mut};

    use windows_sys::Win32::UI::{Shell::ShellExecuteW, WindowsAndMessaging::SW_SHOWNORMAL};

    if let Some((target, metadata, is_directory)) = expected {
        confirm_target(target, is_directory, metadata)?;
    }
    let operation: Vec<u16> = std::ffi::OsStr::new("open")
        .encode_wide()
        .chain([0])
        .collect();
    let file: Vec<u16> = path.as_os_str().encode_wide().chain([0]).collect();
    let parameter_buffer = parameters.map(|value| {
        std::ffi::OsStr::new(value)
            .encode_wide()
            .chain([0])
            .collect::<Vec<_>>()
    });
    let parameter_pointer = parameter_buffer
        .as_ref()
        .map_or(std::ptr::null(), |value| value.as_ptr());
    let result = unsafe {
        ShellExecuteW(
            null_mut(),
            operation.as_ptr(),
            file.as_ptr(),
            parameter_pointer,
            std::ptr::null(),
            SW_SHOWNORMAL,
        )
    };
    if (result as isize) <= 32 {
        return Err(ExternalOpenError::LaunchFailed);
    }
    Ok(())
}

#[cfg(windows)]
fn confirm_target(
    path: &Path,
    is_directory: bool,
    expected: &Metadata,
) -> Result<(), ExternalOpenError> {
    let metadata = std::fs::symlink_metadata(path).map_err(|_| ExternalOpenError::TargetChanged)?;
    if super::is_unsafe_metadata(&metadata)
        || metadata.is_dir() != is_directory
        || metadata.is_file() == is_directory
        || !super::same_file_metadata(expected, &metadata)
    {
        return Err(ExternalOpenError::TargetChanged);
    }
    Ok(())
}

#[cfg(windows)]
fn explorer_parameters(path: &Path, is_directory: bool) -> Option<String> {
    if is_directory {
        None
    } else {
        Some(format!("/select,\"{}\"", path.to_string_lossy()))
    }
}

#[cfg(all(test, windows))]
mod tests {
    use std::path::Path;

    #[test]
    fn quotes_unicode_file_paths_for_explorer_selection() {
        let parameters =
            super::explorer_parameters(Path::new(r"C:\资料 目录\研究 计划.txt"), false);
        assert_eq!(
            parameters.as_deref(),
            Some(r#"/select,"C:\资料 目录\研究 计划.txt""#)
        );
    }

    #[test]
    fn opens_a_directory_without_selection_parameters() {
        assert!(super::explorer_parameters(Path::new(r"C:\资料"), true).is_none());
    }
}
