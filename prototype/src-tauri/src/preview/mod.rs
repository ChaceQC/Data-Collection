mod doc;
mod image;
mod loaders;
mod operations;
mod resource_protocol;
mod resources;
mod result;
mod spreadsheet;
mod text;
mod video;

use serde::{Deserialize, Serialize};

use crate::filesystem::PreviewPathError;

pub(crate) use operations::{can_preview, load_preview};
#[cfg(not(test))]
pub(crate) use resources::RESOURCE_SCHEME;

const STATUS_READY: &str = "ready";
const STATUS_UNSUPPORTED: &str = "unsupported";
const STATUS_MISSING: &str = "missing";
const STATUS_PERMISSION_DENIED: &str = "permission-denied";
const STATUS_TOO_LARGE: &str = "too-large";
const STATUS_CONVERTER_MISSING: &str = "converter-missing";
const STATUS_PARSE_ERROR: &str = "parse-error";

#[derive(Clone, Debug, Default)]
pub(crate) struct PreviewState {
    resources: resources::PreviewResourceStore,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewOptions {
    pub page: Option<u32>,
    pub scale: Option<f32>,
    pub mode: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewSupport {
    pub supported: bool,
    pub kind: String,
    pub status: String,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PreviewResult {
    pub preview_id: String,
    pub kind: String,
    pub status: String,
    pub content: Option<PreviewContent>,
    pub byte_length: u64,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub(crate) enum PreviewContent {
    Text {
        value: String,
        encoding: String,
        language: Option<String>,
    },
    Resource {
        #[serde(rename = "resourceUrl")]
        resource_url: String,
        #[serde(rename = "mediaType")]
        media_type: String,
        #[serde(rename = "byteLength")]
        byte_length: u64,
        #[serde(rename = "supportsRange")]
        supports_range: bool,
        width: Option<u32>,
        height: Option<u32>,
    },
    ConvertedPdf {
        #[serde(rename = "resourceUrl")]
        resource_url: String,
        #[serde(rename = "mediaType")]
        media_type: String,
        #[serde(rename = "sourceKind")]
        source_kind: String,
        #[serde(rename = "byteLength")]
        byte_length: u64,
        #[serde(rename = "supportsRange")]
        supports_range: bool,
    },
}

pub(crate) fn dispose_preview(state: &PreviewState, preview_id: &str) {
    operations::dispose_preview(state, preview_id);
}

impl PreviewState {
    pub(crate) fn resource_response(
        &self,
        request: &http::Request<Vec<u8>>,
    ) -> http::Response<Vec<u8>> {
        self.resources.handle_request(request)
    }

    pub(crate) fn dispose_all(&self) {
        self.resources.dispose_all();
    }
}

#[cfg(test)]
mod tests {
    use std::{fs, path::PathBuf, time::SystemTime};

    use super::{can_preview, load_preview, PreviewOptions, PreviewState};

    #[test]
    fn rejects_kind_mismatch_without_reading_as_the_requested_type() {
        let path = unique_path("preview-kind.txt");
        fs::write(&path, "内容").expect("fixture should be written");
        let support = can_preview(&path.to_string_lossy(), "markdown");
        assert!(!support.supported);
        assert_eq!(support.status, "unsupported");
        let _ = fs::remove_file(path);
    }

    #[test]
    fn loads_text_without_persisting_a_resource_session() {
        let path = unique_path("preview-text.txt");
        fs::write(&path, "中文内容").expect("fixture should be written");
        let state = PreviewState::default();
        let result = load_preview(
            &path.to_string_lossy(),
            "text",
            PreviewOptions::default(),
            &state,
        );
        assert_eq!(result.status, "ready");
        assert!(result.content.is_some());
        state.dispose_all();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn reports_missing_files_without_touching_the_index() {
        let path = unique_path("preview-missing.txt");
        let support = can_preview(&path.to_string_lossy(), "text");
        assert!(!support.supported);
        assert_eq!(support.status, "missing");
    }

    #[test]
    fn rejects_a_corrupt_open_xml_container_before_creating_a_resource() {
        let path = unique_path("preview-corrupt.xlsx");
        fs::write(&path, "not an xlsx container").expect("fixture should be written");
        let state = PreviewState::default();
        let result = load_preview(
            &path.to_string_lossy(),
            "xlsx",
            PreviewOptions::default(),
            &state,
        );
        assert_eq!(result.status, "parse-error");
        state.dispose_all();
        let _ = fs::remove_file(path);
    }

    #[test]
    fn serializes_resource_fields_for_the_frontend_protocol() {
        let value = serde_json::to_value(super::PreviewContent::Resource {
            resource_url: "http://preview.localhost/preview-test".to_string(),
            media_type: "image/png".to_string(),
            byte_length: 42,
            supports_range: true,
            width: Some(10),
            height: Some(20),
        })
        .expect("preview content should serialize");

        assert_eq!(value["type"], "resource");
        assert_eq!(
            value["resourceUrl"],
            "http://preview.localhost/preview-test"
        );
        assert_eq!(value["mediaType"], "image/png");
        assert_eq!(value["byteLength"], 42);
        assert_eq!(value["supportsRange"], true);
        assert!(value.get("resource_url").is_none());
    }

    fn unique_path(name: &str) -> PathBuf {
        let timestamp = SystemTime::now()
            .duration_since(SystemTime::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or_default();
        std::env::temp_dir().join(format!("local-material-{timestamp}-{name}"))
    }
}
