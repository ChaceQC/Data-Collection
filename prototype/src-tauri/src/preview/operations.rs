use std::path::Path;

use crate::{
    config::{
        IMAGE_PREVIEW_LIMIT, OFFICE_PREVIEW_LIMIT, PDF_PREVIEW_LIMIT, TEXT_PREVIEW_LIMIT,
        VIDEO_PREVIEW_LIMIT,
    },
    filesystem::{self, FileTypeInfo},
};

use super::{doc, image, loaders, result};
use super::{PreviewCancellation, PreviewOptions, PreviewResult, PreviewState, PreviewSupport};

#[derive(Clone, Copy, Debug)]
pub(super) struct PreviewFailure {
    pub status: &'static str,
    pub reason: &'static str,
}

pub(crate) fn can_preview(raw_path: &str, requested_kind: &str) -> PreviewSupport {
    let kind = safe_kind(requested_kind);
    let inspected = inspect_file(raw_path, &kind);
    let (path, metadata, info) = match inspected {
        Ok(value) => value,
        Err(failure) => return result::support_failure(kind, failure),
    };
    match extra_validation(&path, &metadata, &info) {
        Ok(()) => PreviewSupport {
            supported: true,
            kind,
            status: super::STATUS_READY.to_string(),
            reason: None,
        },
        Err(failure) => result::support_failure(kind, failure),
    }
}

#[cfg(test)]
pub(crate) fn load_preview(
    raw_path: &str,
    requested_kind: &str,
    options: PreviewOptions,
    state: &PreviewState,
) -> PreviewResult {
    let cancellation = PreviewCancellation::never_cancelled();
    load_preview_with_cancellation(raw_path, requested_kind, options, state, &cancellation)
}

pub(crate) fn load_preview_with_cancellation(
    raw_path: &str,
    requested_kind: &str,
    options: PreviewOptions,
    state: &PreviewState,
    cancellation: &PreviewCancellation,
) -> PreviewResult {
    let _ = (&options.page, &options.scale, &options.mode);
    let preview_id = super::resources::new_preview_id();
    let kind = safe_kind(requested_kind);
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, kind);
    }
    let (path, metadata, info) = match inspect_file(raw_path, &kind) {
        Ok(value) => value,
        Err(failure) => return result::result_failure(preview_id, kind, failure),
    };
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, kind);
    }
    if let Err(failure) = extra_validation(&path, &metadata, &info) {
        return result::result_failure(preview_id, kind, failure);
    }

    if info.kind == "text" || info.kind == "markdown" {
        return loaders::load_text(preview_id, path, metadata.len(), info, cancellation);
    }
    if info.kind == "doc" {
        return loaders::load_doc(preview_id, path, kind, state, cancellation);
    }
    loaders::load_resource(preview_id, path, metadata.len(), info, state, cancellation)
}

pub(super) fn dispose_preview(state: &PreviewState, preview_id: &str) {
    state.resources.dispose(preview_id);
}

fn inspect_file(
    raw_path: &str,
    requested_kind: &str,
) -> Result<(std::path::PathBuf, std::fs::Metadata, FileTypeInfo), PreviewFailure> {
    let (path, metadata) =
        filesystem::validate_preview_file(raw_path).map_err(result::path_failure)?;
    let Some(info) = filesystem::type_info_for_path(&path) else {
        return Err(PreviewFailure {
            status: super::STATUS_UNSUPPORTED,
            reason: "此格式暂不支持预览",
        });
    };
    if info.kind != requested_kind {
        return Err(PreviewFailure {
            status: super::STATUS_UNSUPPORTED,
            reason: "文件类型与登记信息不一致，请重新导入文件",
        });
    }
    if metadata.len() > limit_for(&info) {
        return Err(PreviewFailure {
            status: super::STATUS_TOO_LARGE,
            reason: "文件超过当前预览大小限制",
        });
    }
    Ok((path, metadata, info))
}

fn extra_validation(
    path: &Path,
    _metadata: &std::fs::Metadata,
    info: &FileTypeInfo,
) -> Result<(), PreviewFailure> {
    if info.kind == "doc" && !doc::converter_available() {
        return Err(PreviewFailure {
            status: super::STATUS_CONVERTER_MISSING,
            reason: "未找到 LibreOffice 转换器，无法预览 DOC",
        });
    }
    if info.kind == "image" {
        match image::dimensions(path, info.extension) {
            Ok(_) => {}
            Err(image::ImageValidationError::TooLarge) => {
                return Err(PreviewFailure {
                    status: super::STATUS_TOO_LARGE,
                    reason: "图片解码尺寸超过 100 megapixels 限制",
                });
            }
            Err(image::ImageValidationError::Invalid) => {
                return Err(PreviewFailure {
                    status: super::STATUS_PARSE_ERROR,
                    reason: "图片无法解析，请检查文件是否损坏",
                });
            }
        }
    }
    Ok(())
}

fn limit_for(info: &FileTypeInfo) -> u64 {
    match info.limit {
        "text" => TEXT_PREVIEW_LIMIT,
        "docx" | "xlsx" => OFFICE_PREVIEW_LIMIT,
        "pdf" => PDF_PREVIEW_LIMIT,
        "image" => IMAGE_PREVIEW_LIMIT,
        "video" => VIDEO_PREVIEW_LIMIT,
        _ => 0,
    }
}

fn safe_kind(kind: &str) -> String {
    match kind {
        "markdown" | "text" | "doc" | "docx" | "xlsx" | "pdf" | "image" | "video" => {
            kind.to_string()
        }
        _ => "other".to_string(),
    }
}
