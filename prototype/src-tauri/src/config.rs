#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct PreviewLimitSpec {
    pub label: &'static str,
    pub max_bytes: u64,
    pub max_pixels: Option<u64>,
}

pub(crate) const TEXT_PREVIEW_LIMIT: u64 = 2 * 1024 * 1024;
pub(crate) const OFFICE_PREVIEW_LIMIT: u64 = 20 * 1024 * 1024;
pub(crate) const PDF_PREVIEW_LIMIT: u64 = 50 * 1024 * 1024;
pub(crate) const IMAGE_PREVIEW_LIMIT: u64 = 50 * 1024 * 1024;
pub(crate) const VIDEO_PREVIEW_LIMIT: u64 = 512 * 1024 * 1024;
pub(crate) const MAX_IMAGE_PIXELS: u64 = 100_000_000;

pub(crate) const PREVIEW_LIMITS: &[PreviewLimitSpec] = &[
    PreviewLimitSpec {
        label: "纯文本和 Markdown",
        max_bytes: TEXT_PREVIEW_LIMIT,
        max_pixels: None,
    },
    PreviewLimitSpec {
        label: "DOCX 和 XLSX",
        max_bytes: OFFICE_PREVIEW_LIMIT,
        max_pixels: None,
    },
    PreviewLimitSpec {
        label: "PDF",
        max_bytes: PDF_PREVIEW_LIMIT,
        max_pixels: None,
    },
    PreviewLimitSpec {
        label: "图片",
        max_bytes: IMAGE_PREVIEW_LIMIT,
        max_pixels: Some(MAX_IMAGE_PIXELS),
    },
    PreviewLimitSpec {
        label: "视频",
        max_bytes: VIDEO_PREVIEW_LIMIT,
        max_pixels: None,
    },
];
