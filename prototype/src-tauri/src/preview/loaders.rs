use std::{fs::File, io::Read, path::Path};

use crate::{config::TEXT_PREVIEW_LIMIT, filesystem::FileTypeInfo};

use super::operations::PreviewFailure;
use super::{doc, image, result, spreadsheet, video};
use super::{PreviewCancellation, PreviewContent, PreviewResult, PreviewState};

pub(super) fn load_text(
    preview_id: String,
    path: std::path::PathBuf,
    byte_length: u64,
    info: FileTypeInfo,
    cancellation: &PreviewCancellation,
) -> PreviewResult {
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, info.kind.to_string());
    }
    let bytes = match read_bounded(&path, TEXT_PREVIEW_LIMIT) {
        Ok(bytes) => bytes,
        Err(failure) => return result::result_failure(preview_id, info.kind.to_string(), failure),
    };
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, info.kind.to_string());
    }
    let decoded = match super::text::decode(&bytes) {
        Ok(decoded) => decoded,
        Err(()) => {
            return result::result_failure(
                preview_id,
                info.kind.to_string(),
                PreviewFailure {
                    status: super::STATUS_PARSE_ERROR,
                    reason: "文本编码无法可靠识别，请转换为 UTF-8 或 GB18030",
                },
            )
        }
    };
    result::result_ready(
        preview_id,
        info.kind.to_string(),
        byte_length,
        PreviewContent::Text {
            value: decoded.value,
            encoding: decoded.encoding.to_string(),
            language: info.language.map(str::to_string),
        },
    )
}

pub(super) fn load_resource(
    preview_id: String,
    path: std::path::PathBuf,
    byte_length: u64,
    info: FileTypeInfo,
    state: &PreviewState,
    cancellation: &PreviewCancellation,
) -> PreviewResult {
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, info.kind.to_string());
    }
    if (info.kind == "docx" || info.kind == "xlsx")
        && !spreadsheet::has_supported_container(&path, info.extension).unwrap_or(false)
    {
        return result::result_failure(
            preview_id,
            info.kind.to_string(),
            PreviewFailure {
                status: super::STATUS_PARSE_ERROR,
                reason: "文件容器无法解析，请检查文件是否损坏或加密",
            },
        );
    }
    let Some(media_type) = info.media_type else {
        return result::result_failure(
            preview_id,
            info.kind.to_string(),
            PreviewFailure {
                status: super::STATUS_UNSUPPORTED,
                reason: "此格式暂不支持预览",
            },
        );
    };
    if info.kind == "video" && !video::is_registered_media_type(info.extension, media_type) {
        return result::result_failure(
            preview_id,
            info.kind.to_string(),
            PreviewFailure {
                status: super::STATUS_UNSUPPORTED,
                reason: "当前视频容器或 MIME 类型暂不支持",
            },
        );
    }
    let dimensions = if info.kind == "image" {
        match image::dimensions(&path, info.extension) {
            Ok(dimensions) => Some(dimensions),
            Err(image::ImageValidationError::TooLarge) => {
                return result::result_failure(
                    preview_id,
                    info.kind.to_string(),
                    PreviewFailure {
                        status: super::STATUS_TOO_LARGE,
                        reason: "图片解码尺寸超过 100 megapixels 限制",
                    },
                )
            }
            Err(image::ImageValidationError::Invalid) => {
                return result::result_failure(
                    preview_id,
                    info.kind.to_string(),
                    PreviewFailure {
                        status: super::STATUS_PARSE_ERROR,
                        reason: "图片无法解析，请检查文件是否损坏",
                    },
                )
            }
        }
    } else {
        None
    };
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, info.kind.to_string());
    }
    if state
        .resources
        .insert(
            preview_id.clone(),
            path,
            media_type.to_string(),
            byte_length,
            None,
        )
        .is_err()
    {
        return result::result_failure(
            preview_id,
            info.kind.to_string(),
            PreviewFailure {
                status: super::STATUS_PARSE_ERROR,
                reason: "预览资源初始化失败，请重试",
            },
        );
    }
    if cancellation.is_cancelled() {
        state.resources.dispose(&preview_id);
        return result::result_cancelled(preview_id, info.kind.to_string());
    }
    let (width, height) = dimensions.unwrap_or((0, 0));
    result::result_ready(
        preview_id.clone(),
        info.kind.to_string(),
        byte_length,
        PreviewContent::Resource {
            resource_url: super::resources::resource_url(&preview_id),
            media_type: media_type.to_string(),
            byte_length,
            supports_range: true,
            width: (width > 0).then_some(width),
            height: (height > 0).then_some(height),
        },
    )
}

pub(super) fn load_doc(
    preview_id: String,
    path: std::path::PathBuf,
    kind: String,
    state: &PreviewState,
    cancellation: &PreviewCancellation,
) -> PreviewResult {
    if cancellation.is_cancelled() {
        return result::result_cancelled(preview_id, kind);
    }
    let converted = match doc::convert_to_pdf(&path, cancellation) {
        Ok(converted) => converted,
        Err(doc::DocConversionError::MissingConverter) => {
            return result::result_failure(
                preview_id,
                kind,
                PreviewFailure {
                    status: super::STATUS_CONVERTER_MISSING,
                    reason: "未找到 LibreOffice 转换器，无法预览 DOC",
                },
            )
        }
        Err(doc::DocConversionError::TimedOut) => {
            return result::result_failure(
                preview_id,
                kind,
                PreviewFailure {
                    status: super::STATUS_PARSE_ERROR,
                    reason: "DOC 转换超时，临时文件已清理，请重试",
                },
            )
        }
        Err(doc::DocConversionError::Cancelled) => {
            return result::result_cancelled(preview_id, kind);
        }
        Err(doc::DocConversionError::OutputTooLarge) => {
            return result::result_failure(
                preview_id,
                kind,
                PreviewFailure {
                    status: super::STATUS_TOO_LARGE,
                    reason: "DOC 转换后的 PDF 超过当前预览大小限制",
                },
            )
        }
        Err(doc::DocConversionError::Failed) => {
            return result::result_failure(
                preview_id,
                kind,
                PreviewFailure {
                    status: super::STATUS_PARSE_ERROR,
                    reason: "DOC 转换失败，请检查文件是否损坏",
                },
            )
        }
    };
    let doc::ConvertedPdf {
        path: converted_path,
        temporary_directory,
        byte_length,
    } = converted;
    let cleanup_directory = temporary_directory.clone();
    if cancellation.is_cancelled() {
        doc::remove_temporary_directory(&cleanup_directory);
        return result::result_cancelled(preview_id, kind);
    }
    if state
        .resources
        .insert(
            preview_id.clone(),
            converted_path,
            "application/pdf".to_string(),
            byte_length,
            Some(temporary_directory),
        )
        .is_err()
    {
        doc::remove_temporary_directory(&cleanup_directory);
        return result::result_failure(
            preview_id,
            kind,
            PreviewFailure {
                status: super::STATUS_PARSE_ERROR,
                reason: "预览资源初始化失败，临时文件已清理",
            },
        );
    }
    result::result_ready(
        preview_id.clone(),
        kind,
        byte_length,
        PreviewContent::ConvertedPdf {
            resource_url: super::resources::resource_url(&preview_id),
            media_type: "application/pdf".to_string(),
            source_kind: "doc".to_string(),
            byte_length,
            supports_range: true,
        },
    )
}

fn read_bounded(path: &Path, limit: u64) -> Result<Vec<u8>, PreviewFailure> {
    let file = File::open(path).map_err(result::read_failure)?;
    let mut bytes = Vec::new();
    file.take(limit.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(result::read_failure)?;
    if bytes.len() as u64 > limit {
        return Err(PreviewFailure {
            status: super::STATUS_TOO_LARGE,
            reason: "文件超过当前预览大小限制",
        });
    }
    Ok(bytes)
}
