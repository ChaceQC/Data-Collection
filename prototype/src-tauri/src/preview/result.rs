use super::operations::PreviewFailure;
use super::{PreviewContent, PreviewResult, PreviewSupport, STATUS_READY};
use super::{STATUS_PARSE_ERROR, STATUS_PERMISSION_DENIED, STATUS_UNSUPPORTED};

pub(super) fn path_failure(error: super::PreviewPathError) -> PreviewFailure {
    match error {
        super::PreviewPathError::Missing => PreviewFailure {
            status: super::STATUS_MISSING,
            reason: "文件已移动或删除，请重新定位或重新导入",
        },
        super::PreviewPathError::PermissionDenied => PreviewFailure {
            status: STATUS_PERMISSION_DENIED,
            reason: "没有读取该文件的权限，请检查权限后重试",
        },
        super::PreviewPathError::Invalid => PreviewFailure {
            status: STATUS_UNSUPPORTED,
            reason: "只允许预览已登记的普通文件",
        },
    }
}

pub(super) fn read_failure(error: std::io::Error) -> PreviewFailure {
    match error.kind() {
        std::io::ErrorKind::NotFound => PreviewFailure {
            status: super::STATUS_MISSING,
            reason: "文件已移动或删除，请重新定位或重新导入",
        },
        std::io::ErrorKind::PermissionDenied => PreviewFailure {
            status: STATUS_PERMISSION_DENIED,
            reason: "没有读取该文件的权限，请检查权限后重试",
        },
        _ => PreviewFailure {
            status: STATUS_PARSE_ERROR,
            reason: "文件读取失败，请重试",
        },
    }
}

pub(super) fn support_failure(kind: String, failure: PreviewFailure) -> PreviewSupport {
    PreviewSupport {
        supported: false,
        kind,
        status: failure.status.to_string(),
        reason: Some(failure.reason.to_string()),
    }
}

pub(super) fn result_failure(
    preview_id: String,
    kind: String,
    failure: PreviewFailure,
) -> PreviewResult {
    PreviewResult {
        preview_id,
        kind,
        status: failure.status.to_string(),
        content: None,
        byte_length: 0,
        reason: Some(failure.reason.to_string()),
    }
}

pub(super) fn result_ready(
    preview_id: String,
    kind: String,
    byte_length: u64,
    content: PreviewContent,
) -> PreviewResult {
    PreviewResult {
        preview_id,
        kind,
        status: STATUS_READY.to_string(),
        content: Some(content),
        byte_length,
        reason: None,
    }
}
