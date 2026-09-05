use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
};

use http::{header::CONTENT_LENGTH, Method, Request, Response, StatusCode};

use super::resources::PreviewResourceStore;
use crate::filesystem;

const MAX_PROTOCOL_CHUNK_BYTES: u64 = 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct ByteRange {
    start: u64,
    end: u64,
}

impl PreviewResourceStore {
    pub(super) fn handle_request(&self, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
        self.cleanup_expired();

        if request.method() == Method::OPTIONS {
            let Some(preview_id) = request_preview_id(request) else {
                return response(StatusCode::NOT_FOUND, Vec::new()).finish();
            };
            let registered = self
                .sessions
                .lock()
                .ok()
                .is_some_and(|sessions| sessions.contains_key(preview_id));
            if !registered {
                return response(StatusCode::NOT_FOUND, Vec::new()).finish();
            }
            return response(StatusCode::NO_CONTENT, Vec::new())
                .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
                .header("Access-Control-Allow-Headers", "Range")
                .header("Access-Control-Max-Age", "60")
                .finish();
        }
        if request.method() != Method::GET && request.method() != Method::HEAD {
            return response(StatusCode::METHOD_NOT_ALLOWED, Vec::new())
                .header("Allow", "GET, HEAD")
                .finish();
        }

        let Some(preview_id) = request_preview_id(request) else {
            return response(StatusCode::NOT_FOUND, Vec::new()).finish();
        };
        let Some(resource) = self
            .sessions
            .lock()
            .ok()
            .and_then(|sessions| sessions.get(preview_id).cloned())
        else {
            return response(StatusCode::NOT_FOUND, Vec::new()).finish();
        };

        let (safe_path, metadata) =
            match filesystem::validate_preview_file(&resource.path.to_string_lossy()) {
                Ok(value)
                    if filesystem::same_path(
                        &value.0.to_string_lossy(),
                        &resource.path.to_string_lossy(),
                    ) =>
                {
                    value
                }
                Err(crate::filesystem::PreviewPathError::PermissionDenied) => {
                    return response(StatusCode::FORBIDDEN, Vec::new()).finish();
                }
                Ok(_) | Err(_) => return response(StatusCode::NOT_FOUND, Vec::new()).finish(),
            };
        self.touch(preview_id);
        if metadata.len() != resource.byte_length
            || !filesystem::same_file_snapshot(&resource.source_metadata, &metadata)
        {
            self.dispose(preview_id);
            return response(StatusCode::CONFLICT, Vec::new()).finish();
        }

        let byte_length = resource.byte_length;
        let requested_range = request
            .headers()
            .get("range")
            .filter(|_| request.method() == Method::GET)
            .map(|value| {
                value
                    .to_str()
                    .ok()
                    .and_then(|value| parse_range(value, byte_length))
            });
        if request.method() == Method::GET
            && request.headers().contains_key("range")
            && (requested_range.flatten().is_none()
                || request.headers().get_all("range").iter().count() != 1)
        {
            return response(StatusCode::RANGE_NOT_SATISFIABLE, Vec::new())
                .header("Content-Range", format!("bytes */{byte_length}"))
                .header("Accept-Ranges", "bytes")
                .finish();
        }

        let (range, status) = match requested_range.flatten() {
            Some(range) => (clamp_range(range, byte_length), StatusCode::PARTIAL_CONTENT),
            None if request.method() == Method::GET
                && resource.supports_range
                && is_large_stream_resource(&resource.media_type)
                && byte_length > MAX_PROTOCOL_CHUNK_BYTES =>
            {
                return response(StatusCode::BAD_REQUEST, Vec::new())
                    .header("Accept-Ranges", "bytes")
                    .header("Content-Length", "0")
                    .finish();
            }
            None => (
                ByteRange {
                    start: 0,
                    end: byte_length.saturating_sub(1),
                },
                StatusCode::OK,
            ),
        };
        let content_length = if byte_length == 0 {
            0
        } else {
            range.end - range.start + 1
        };
        let mut builder = response(status, Vec::new())
            .header("Content-Type", resource.media_type)
            .header(CONTENT_LENGTH, content_length.to_string())
            .header("Accept-Ranges", "bytes")
            .header(
                "Access-Control-Expose-Headers",
                "Accept-Ranges, Content-Length, Content-Range, Content-Type",
            );
        if status == StatusCode::PARTIAL_CONTENT {
            builder = builder.header(
                "Content-Range",
                format!("bytes {}-{}/{byte_length}", range.start, range.end),
            );
        }

        if request.method() == Method::HEAD || content_length == 0 {
            return builder.finish();
        }

        let body = match read_range(&safe_path, range, &resource.source_metadata) {
            Ok(body) => body,
            Err(ReadRangeError::Changed) => {
                self.dispose(preview_id);
                return response(StatusCode::CONFLICT, Vec::new()).finish();
            }
            Err(ReadRangeError::Io(error))
                if error.kind() == std::io::ErrorKind::PermissionDenied =>
            {
                return response(StatusCode::FORBIDDEN, Vec::new()).finish();
            }
            Err(_) => return response(StatusCode::INTERNAL_SERVER_ERROR, Vec::new()).finish(),
        };
        // dispose 与读取可并发，释放后不再交付已经读取的内容。
        if !self
            .sessions
            .lock()
            .ok()
            .is_some_and(|sessions| sessions.contains_key(preview_id))
        {
            return response(StatusCode::NOT_FOUND, Vec::new()).finish();
        }
        builder.with_body(body)
    }
}

fn request_preview_id(request: &Request<Vec<u8>>) -> Option<&str> {
    if request.uri().query().is_some() {
        return None;
    }
    let id = request.uri().path().strip_prefix('/')?;
    if id.is_empty() || id.contains('/') || !id.starts_with("preview-") {
        return None;
    }
    let suffix = id.strip_prefix("preview-")?;
    if suffix.len() != 32
        || !suffix
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return None;
    }
    Some(id)
}

fn parse_range(value: &str, byte_length: u64) -> Option<ByteRange> {
    if byte_length == 0 || !value.starts_with("bytes=") || value.contains(',') {
        return None;
    }
    let range = value.strip_prefix("bytes=")?;
    let (start, end) = range.split_once('-')?;
    if start.is_empty() {
        let suffix_length = end.parse::<u64>().ok()?.min(byte_length);
        if suffix_length == 0 {
            return None;
        }
        return Some(ByteRange {
            start: byte_length - suffix_length,
            end: byte_length - 1,
        });
    }
    let start = start.parse::<u64>().ok()?;
    if start >= byte_length {
        return None;
    }
    let end = if end.is_empty() {
        byte_length - 1
    } else {
        end.parse::<u64>().ok()?.min(byte_length - 1)
    };
    (start <= end).then_some(ByteRange { start, end })
}

fn clamp_range(range: ByteRange, byte_length: u64) -> ByteRange {
    let end = range
        .end
        .min(byte_length.saturating_sub(1))
        .min(range.start.saturating_add(MAX_PROTOCOL_CHUNK_BYTES - 1));
    ByteRange {
        start: range.start,
        end,
    }
}

fn is_large_stream_resource(media_type: &str) -> bool {
    media_type.starts_with("video/") || media_type == "application/pdf"
}

enum ReadRangeError {
    Changed,
    Io(std::io::Error),
}

fn read_range(
    path: &Path,
    range: ByteRange,
    expected_metadata: &fs::Metadata,
) -> Result<Vec<u8>, ReadRangeError> {
    let length = range.end - range.start + 1;
    let mut file = File::open(path).map_err(ReadRangeError::Io)?;
    let opened_metadata = file.metadata().map_err(ReadRangeError::Io)?;
    if !filesystem::same_file_snapshot(expected_metadata, &opened_metadata) {
        return Err(ReadRangeError::Changed);
    }
    file.seek(SeekFrom::Start(range.start))
        .map_err(ReadRangeError::Io)?;
    let mut body = Vec::with_capacity(length as usize);
    file.take(length)
        .read_to_end(&mut body)
        .map_err(ReadRangeError::Io)?;
    let current_metadata = fs::symlink_metadata(path).map_err(ReadRangeError::Io)?;
    if body.len() as u64 != length
        || !filesystem::same_file_snapshot(expected_metadata, &current_metadata)
    {
        return Err(ReadRangeError::Changed);
    }
    Ok(body)
}

struct ResponseBuilder {
    builder: http::response::Builder,
    body: Vec<u8>,
}

fn response(status: StatusCode, body: Vec<u8>) -> ResponseBuilder {
    ResponseBuilder {
        builder: Response::builder()
            .status(status)
            .header("Access-Control-Allow-Origin", "*")
            .header("Cache-Control", "no-store"),
        body,
    }
}

impl ResponseBuilder {
    fn header(self, name: impl AsRef<str>, value: impl Into<String>) -> Self {
        Self {
            builder: self.builder.header(name.as_ref(), value.into()),
            body: self.body,
        }
    }

    fn with_body(mut self, body: Vec<u8>) -> Response<Vec<u8>> {
        self.body = body;
        self.finish()
    }

    fn finish(self) -> Response<Vec<u8>> {
        self.builder
            .body(self.body)
            .unwrap_or_else(|_| Response::new(Vec::new()))
    }
}

#[cfg(test)]
mod tests {
    use std::{
        fs,
        time::{SystemTime, UNIX_EPOCH},
    };

    use http::{Method, Request};

    use super::{parse_range, ByteRange};
    use crate::preview::resources::{new_preview_id, resource_url, PreviewResourceStore};

    #[test]
    fn parses_and_limits_single_ranges() {
        assert_eq!(
            parse_range("bytes=2-6", 10),
            Some(ByteRange { start: 2, end: 6 })
        );
        assert_eq!(
            parse_range("bytes=7-", 10),
            Some(ByteRange { start: 7, end: 9 })
        );
        assert_eq!(
            parse_range("bytes=-3", 10),
            Some(ByteRange { start: 7, end: 9 })
        );
        assert_eq!(parse_range("bytes=2-3,5-6", 10), None);
        assert_eq!(parse_range("bytes=10-", 10), None);
    }

    #[test]
    fn serves_only_registered_ids_and_disposes_sessions() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path = std::env::temp_dir().join(format!("local-material-resource-{timestamp}.txt"));
        fs::write(&path, b"0123456789").expect("fixture should be written");
        let canonical_path = fs::canonicalize(&path).expect("fixture should canonicalize");
        let store = PreviewResourceStore::default();
        let preview_id = new_preview_id();
        store
            .insert(
                preview_id.clone(),
                canonical_path,
                fs::metadata(&path).expect("resource metadata should be readable"),
                "text/plain".to_string(),
                10,
                None,
            )
            .expect("resource should be registered");

        let request = Request::builder()
            .method(Method::GET)
            .uri(resource_url(&preview_id))
            .header("Range", "bytes=2-5")
            .body(Vec::new())
            .expect("request should be valid");
        let response = store.handle_request(&request);
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"2345");

        let complete_request = Request::builder()
            .method(Method::GET)
            .uri(resource_url(&preview_id))
            .body(Vec::new())
            .expect("request should be valid");
        let complete = store.handle_request(&complete_request);
        assert_eq!(complete.status(), 200);
        assert_eq!(complete.body(), b"0123456789");

        let invalid_range = Request::builder()
            .method(Method::GET)
            .uri(resource_url(&preview_id))
            .header("Range", "bytes=10-")
            .body(Vec::new())
            .expect("request should be valid");
        let invalid_response = store.handle_request(&invalid_range);
        assert_eq!(invalid_response.status(), 416);
        assert_eq!(
            invalid_response
                .headers()
                .get("Content-Range")
                .unwrap()
                .to_str()
                .unwrap(),
            "bytes */10"
        );

        let options = Request::builder()
            .method(Method::OPTIONS)
            .uri(resource_url(&preview_id))
            .body(Vec::new())
            .expect("request should be valid");
        assert_eq!(store.handle_request(&options).status(), 204);

        let unknown = Request::builder()
            .uri("preview://localhost/preview-00000000000000000000000000000000")
            .body(Vec::new())
            .expect("request should be valid");
        assert_eq!(store.handle_request(&unknown).status(), 404);

        let unknown_options = Request::builder()
            .method(Method::OPTIONS)
            .uri("preview://localhost/preview-00000000000000000000000000000000")
            .body(Vec::new())
            .expect("request should be valid");
        assert_eq!(store.handle_request(&unknown_options).status(), 404);

        fs::remove_file(&path).expect("resource source should be removable");
        fs::write(&path, b"abcdefghij").expect("replacement source should be written");
        let replaced = store.handle_request(&complete_request);
        assert_eq!(replaced.status(), 409);
        assert_eq!(store.handle_request(&complete_request).status(), 404);

        store.dispose(&preview_id);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn requires_explicit_ranges_for_large_pdf_and_video_and_keeps_head_complete() {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        let path =
            std::env::temp_dir().join(format!("local-material-pdf-resource-{timestamp}.pdf"));
        let bytes = vec![b'x'; (super::MAX_PROTOCOL_CHUNK_BYTES + 1) as usize];
        fs::write(&path, &bytes).expect("fixture should be written");
        let canonical_path = fs::canonicalize(&path).expect("fixture should canonicalize");
        let store = PreviewResourceStore::default();
        let preview_id = new_preview_id();
        store
            .insert(
                preview_id.clone(),
                canonical_path,
                fs::metadata(&path).expect("resource metadata should be readable"),
                "application/pdf".to_string(),
                bytes.len() as u64,
                None,
            )
            .expect("resource should be registered");

        let request = Request::builder()
            .method(Method::GET)
            .uri(resource_url(&preview_id))
            .body(Vec::new())
            .expect("request should be valid");
        let response = store.handle_request(&request);
        assert_eq!(response.status(), 400);
        assert!(response.body().is_empty());
        for media_type in ["application/pdf", "video/mp4"] {
            store
                .sessions
                .lock()
                .unwrap()
                .get_mut(&preview_id)
                .unwrap()
                .media_type = media_type.to_string();
            assert_eq!(store.handle_request(&request).status(), 400);
            for (range, expected_status, expected_length) in [
                ("bytes=0-", 206, super::MAX_PROTOCOL_CHUNK_BYTES as usize),
                ("bytes=-1", 206, 1),
                ("bytes=1048576-", 206, 1),
                ("bytes=1048577-", 416, 0),
                ("bytes=0-1,4-5", 416, 0),
            ] {
                let mut ranged = request.clone();
                ranged.headers_mut().insert("range", range.parse().unwrap());
                let response = store.handle_request(&ranged);
                assert_eq!(response.status(), expected_status);
                assert_eq!(response.body().len(), expected_length);
                if expected_status == 206 {
                    assert_eq!(
                        response.headers()["Content-Length"],
                        expected_length.to_string()
                    );
                    assert!(response.headers()["Content-Range"]
                        .to_str()
                        .unwrap()
                        .ends_with("/1048577"));
                }
            }
        }
        let mut head = request.clone();
        *head.method_mut() = Method::HEAD;
        let response = store.handle_request(&head);
        assert_eq!(response.status(), 200);
        assert_eq!(response.body().len(), 0);
        let expected_content_length = bytes.len().to_string();
        assert_eq!(
            response
                .headers()
                .get("Content-Length")
                .unwrap()
                .to_str()
                .unwrap(),
            expected_content_length.as_str()
        );
        assert!(!response.headers().contains_key("Content-Range"));

        store.dispose(&preview_id);
        let _ = fs::remove_file(path);
    }
}
