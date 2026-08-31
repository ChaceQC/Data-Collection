use std::path::Path;

use image::{ImageFormat, ImageReader};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ImageValidationError {
    Invalid,
    TooLarge,
}

pub(crate) fn dimensions(
    path: &Path,
    extension: &str,
    max_pixels: Option<u64>,
) -> Result<(u32, u32), ImageValidationError> {
    let reader = ImageReader::open(path).map_err(|_| ImageValidationError::Invalid)?;
    let reader = reader
        .with_guessed_format()
        .map_err(|_| ImageValidationError::Invalid)?;
    let format = reader.format().ok_or(ImageValidationError::Invalid)?;
    if !matches_extension(extension, format) {
        return Err(ImageValidationError::Invalid);
    }
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| ImageValidationError::Invalid)?;
    if max_pixels.is_some_and(|limit| u64::from(width) * u64::from(height) > limit) {
        return Err(ImageValidationError::TooLarge);
    }
    Ok((width, height))
}

fn matches_extension(extension: &str, format: ImageFormat) -> bool {
    match extension {
        "png" => format == ImageFormat::Png,
        "jpeg" => format == ImageFormat::Jpeg,
        "webp" => format == ImageFormat::WebP,
        "gif" => format == ImageFormat::Gif,
        "bmp" => format == ImageFormat::Bmp,
        _ => false,
    }
}
