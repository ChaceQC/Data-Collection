use std::path::Path;

use thiserror::Error;

#[derive(Debug, Error)]
pub(crate) enum ClipboardError {
    #[error("文件路径无法复制到剪贴板")]
    InvalidPath,
    #[error("系统剪贴板当前不可用，请稍后重试")]
    Unavailable,
    #[cfg(not(windows))]
    #[error("当前平台不支持文件剪贴板")]
    Unsupported,
}

pub(crate) fn set_file(path: &Path) -> Result<(), ClipboardError> {
    if path.as_os_str().is_empty() {
        return Err(ClipboardError::InvalidPath);
    }

    #[cfg(windows)]
    {
        let payload = file_list_payload(path);
        set_windows_file_list(&payload)
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Err(ClipboardError::Unsupported)
    }
}

#[cfg(windows)]
fn file_list_payload(path: &Path) -> Vec<u16> {
    use std::os::windows::ffi::OsStrExt;

    path.as_os_str().encode_wide().chain([0, 0]).collect()
}

#[cfg(windows)]
fn set_windows_file_list(payload: &[u16]) -> Result<(), ClipboardError> {
    use std::{
        mem::{size_of, size_of_val},
        ptr::{copy_nonoverlapping, null_mut, write_unaligned},
        thread,
        time::Duration,
    };

    use windows_sys::Win32::{
        Foundation::{GlobalFree, POINT},
        System::{
            DataExchange::{CloseClipboard, EmptyClipboard, OpenClipboard, SetClipboardData},
            Memory::{GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE},
            Ole::CF_HDROP,
        },
        UI::Shell::DROPFILES,
    };

    let mut opened = false;
    for _ in 0..10 {
        if unsafe { OpenClipboard(null_mut()) } != 0 {
            opened = true;
            break;
        }
        thread::sleep(Duration::from_millis(5));
    }
    if !opened {
        return Err(ClipboardError::Unavailable);
    }

    let result = unsafe {
        let byte_length = size_of::<DROPFILES>() + size_of_val(payload);
        let memory = GlobalAlloc(GMEM_MOVEABLE, byte_length);
        if memory.is_null() {
            Err(ClipboardError::Unavailable)
        } else {
            let locked = GlobalLock(memory);
            if locked.is_null() {
                GlobalFree(memory);
                Err(ClipboardError::Unavailable)
            } else {
                let header = DROPFILES {
                    pFiles: size_of::<DROPFILES>() as u32,
                    pt: POINT { x: 0, y: 0 },
                    fNC: 0,
                    fWide: 1,
                };
                write_unaligned(locked.cast::<DROPFILES>(), header);
                copy_nonoverlapping(
                    payload.as_ptr().cast::<u8>(),
                    locked.cast::<u8>().add(size_of::<DROPFILES>()),
                    size_of_val(payload),
                );
                let _ = GlobalUnlock(memory);

                if EmptyClipboard() == 0 || SetClipboardData(CF_HDROP as u32, memory).is_null() {
                    GlobalFree(memory);
                    Err(ClipboardError::Unavailable)
                } else {
                    Ok(())
                }
            }
        }
    };
    unsafe {
        CloseClipboard();
    }
    result
}

#[cfg(all(test, windows))]
mod tests {
    use std::path::Path;

    #[test]
    fn builds_a_unicode_file_list_payload_with_two_terminators() {
        let path = Path::new(r"C:\资料 目录\研究 计划.txt");
        let payload = super::file_list_payload(path);

        assert_eq!(&payload[payload.len() - 2..], [0, 0]);
        assert!(String::from_utf16(&payload[..payload.len() - 2])
            .expect("UTF-16 path should decode")
            .contains("研究 计划.txt"));
    }
}
