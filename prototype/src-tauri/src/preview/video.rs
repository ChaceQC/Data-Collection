pub(crate) fn is_registered_media_type(extension: &str, media_type: &str) -> bool {
    matches!(
        (extension, media_type),
        ("mp4", "video/mp4") | ("webm", "video/webm")
    )
}
