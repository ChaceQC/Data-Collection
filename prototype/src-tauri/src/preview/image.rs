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
        "jpg" | "jpeg" => format == ImageFormat::Jpeg,
        "webp" => format == ImageFormat::WebP,
        "gif" => format == ImageFormat::Gif,
        "bmp" => format == ImageFormat::Bmp,
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::SystemTime};

    use image::{DynamicImage, ImageFormat};

    use super::{dimensions, ImageValidationError};

    #[test]
    fn accepts_jpg_and_jpeg_with_real_jpeg_content() {
        for extension in ["jpg", "jpeg"] {
            let path = temporary_path(extension);
            DynamicImage::new_rgb8(2, 3)
                .save_with_format(&path, ImageFormat::Jpeg)
                .expect("test JPEG should be written");

            assert_eq!(dimensions(&path, extension, Some(6)), Ok((2, 3)));
            let _ = fs::remove_file(path);
        }
    }

    #[test]
    fn rejects_content_that_does_not_match_the_jpg_extension() {
        let path = temporary_path("jpg");
        DynamicImage::new_rgb8(2, 3)
            .save_with_format(&path, ImageFormat::Png)
            .expect("test PNG should be written");

        assert_eq!(
            dimensions(&path, "jpg", Some(6)),
            Err(ImageValidationError::Invalid)
        );
        let _ = fs::remove_file(path);
    }

    fn temporary_path(extension: &str) -> PathBuf {
        let nonce = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .expect("test clock should be valid")
            .as_nanos();
        std::env::temp_dir().join(format!(
            "local-material-workbench-image-test-{}-{nonce}.{extension}",
            std::process::id()
        ))
    }
}
