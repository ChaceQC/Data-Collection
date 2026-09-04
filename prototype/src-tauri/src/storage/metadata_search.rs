use std::collections::{HashMap, HashSet};

use regex::{Regex, RegexBuilder};
use serde::{Deserialize, Serialize};
use thiserror::Error;
use unicode_normalization::UnicodeNormalization;

use crate::filesystem::IndexEntry;

use super::{content_search::MAX_REGEX_PROGRAM_BYTES, Group};

pub const MAX_QUERY_CHARS: usize = 256;

const MAX_SEARCH_FIELD_CHARS: usize = 4 * 1024;
const MAX_POSITION_SUMMARY_CHARS: usize = 1024;
const MAX_METADATA_RESULTS: usize = crate::filesystem::MAX_INDEX_ENTRIES;
const MAX_FILTER_VALUES: usize = 256;
const MAX_HIT_RANGES: usize = 64;
const MAX_ID_CHARS: usize = 96;
const MAX_TAG_CHARS: usize = 32;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataSearchQuery {
    pub query: String,
    #[serde(default)]
    pub use_regex: bool,
    #[serde(default = "default_active_nav")]
    pub active_nav: String,
    #[serde(default)]
    pub filter: String,
    #[serde(default)]
    pub group_ids: Vec<String>,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub target_directory: Option<MetadataSearchTarget>,
}

impl Default for MetadataSearchQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            use_regex: false,
            active_nav: default_active_nav(),
            filter: String::new(),
            group_ids: Vec::new(),
            tags: Vec::new(),
            target_directory: None,
        }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MetadataSearchTarget {
    pub(crate) directory_id: String,
    #[serde(default)]
    pub(crate) relative_path: Vec<String>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSearchResponse {
    pub revision: u64,
    pub matched_ids: Vec<String>,
    pub hits: Vec<MetadataSearchHit>,
    pub total: usize,
    pub truncated: bool,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSearchHit {
    pub file_id: String,
    pub field: String,
    pub ranges: Vec<MetadataTextRange>,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataTextRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Eq, Error, PartialEq)]
pub enum MetadataSearchError {
    #[error("元数据搜索表达式无效或超过限制")]
    Query,
    #[error("元数据搜索导航范围无效")]
    Navigation,
    #[error("元数据筛选条件无效")]
    Filter,
    #[error("元数据搜索分组条件无效")]
    Groups,
    #[error("元数据搜索标签条件无效")]
    Tags,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum ActiveNavigation {
    Library,
    Recent,
    RecentOpened,
    Favorites,
    Invalid,
}

struct NormalizedRequest {
    patterns: Vec<Regex>,
    use_regex: bool,
    active_nav: ActiveNavigation,
    filter: Option<String>,
    group_ids: HashSet<String>,
    tags: Vec<String>,
    directory: bool,
}

struct SearchField {
    key: &'static str,
    plain: NormalizedText,
    regex: NormalizedText,
}

struct NormalizedText {
    value: String,
    original_indexes: Vec<usize>,
}

pub fn search(
    entries: &[IndexEntry],
    groups: &[Group],
    revision: u64,
    request: &MetadataSearchQuery,
) -> Result<MetadataSearchResponse, MetadataSearchError> {
    let normalized = normalize_request(request)?;
    let group_names = groups
        .iter()
        .map(|group| (group.id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();
    let candidates = candidate_entries(entries, &normalized);
    let mut matched_ids = Vec::new();
    let mut hits = Vec::new();
    let mut total = 0usize;

    for entry in candidates {
        let fields = searchable_fields(entry, &group_names);
        let Some(hit) = find_hit(entry, &fields, &normalized.patterns, normalized.use_regex) else {
            continue;
        };
        total = total.saturating_add(1);
        if matched_ids.len() < MAX_METADATA_RESULTS {
            matched_ids.push(entry.id.clone());
            hits.push(hit);
        }
    }

    Ok(MetadataSearchResponse {
        revision,
        matched_ids,
        hits,
        total,
        truncated: total > MAX_METADATA_RESULTS,
    })
}

fn normalize_request(
    request: &MetadataSearchQuery,
) -> Result<NormalizedRequest, MetadataSearchError> {
    let raw_query = request.query.nfkc().collect::<String>().trim().to_string();
    if raw_query.is_empty()
        || raw_query.chars().count() > MAX_QUERY_CHARS
        || raw_query.chars().any(char::is_control)
    {
        return Err(MetadataSearchError::Query);
    }

    let active_nav = match request.active_nav.as_str() {
        "library" => ActiveNavigation::Library,
        "recent" => ActiveNavigation::Recent,
        "recent-opened" => ActiveNavigation::RecentOpened,
        "favorites" => ActiveNavigation::Favorites,
        "invalid" => ActiveNavigation::Invalid,
        _ => return Err(MetadataSearchError::Navigation),
    };
    let filter = normalize_filter(&request.filter)?;
    let group_ids = normalize_group_ids(&request.group_ids)?;
    let tags = normalize_tags(&request.tags)?;
    let query = if request.use_regex {
        raw_query
    } else {
        normalize_text(&raw_query)
    };
    let expressions = if request.use_regex {
        vec![query]
    } else {
        query
            .split_whitespace()
            .map(regex::escape)
            .collect::<Vec<_>>()
    };
    let patterns = expressions
        .into_iter()
        .map(|expression| {
            RegexBuilder::new(&expression)
                .case_insensitive(true)
                .size_limit(MAX_REGEX_PROGRAM_BYTES)
                .dfa_size_limit(MAX_REGEX_PROGRAM_BYTES)
                .build()
                .map_err(|_| MetadataSearchError::Query)
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(NormalizedRequest {
        patterns,
        use_regex: request.use_regex,
        active_nav,
        filter,
        group_ids,
        tags,
        directory: request.target_directory.is_some(),
    })
}

fn normalize_filter(value: &str) -> Result<Option<String>, MetadataSearchError> {
    let normalized = normalize_text(value);
    if normalized.chars().count() > MAX_SEARCH_FIELD_CHARS
        || normalized.chars().any(char::is_control)
    {
        return Err(MetadataSearchError::Filter);
    }
    Ok((!normalized.is_empty()).then_some(normalized))
}

fn normalize_group_ids(values: &[String]) -> Result<HashSet<String>, MetadataSearchError> {
    if values.len() > MAX_FILTER_VALUES || values.iter().any(|value| !is_opaque_id(value)) {
        return Err(MetadataSearchError::Groups);
    }
    Ok(values.iter().cloned().collect())
}

fn normalize_tags(values: &[String]) -> Result<Vec<String>, MetadataSearchError> {
    if values.len() > MAX_FILTER_VALUES {
        return Err(MetadataSearchError::Tags);
    }
    let mut normalized = Vec::with_capacity(values.len());
    for value in values {
        let value = normalize_text(value);
        if value.is_empty()
            || value.chars().count() > MAX_TAG_CHARS
            || value.chars().any(char::is_control)
        {
            return Err(MetadataSearchError::Tags);
        }
        if !normalized.contains(&value) {
            normalized.push(value);
        }
    }
    Ok(normalized)
}

fn candidate_entries<'a>(
    entries: &'a [IndexEntry],
    request: &NormalizedRequest,
) -> Vec<&'a IndexEntry> {
    let mut candidates = entries
        .iter()
        .filter(|entry| request.directory || matches_navigation(entry, request.active_nav))
        .collect::<Vec<_>>();

    if !request.directory
        && matches!(
            request.active_nav,
            ActiveNavigation::Recent | ActiveNavigation::RecentOpened
        )
    {
        candidates.sort_by(|left, right| match request.active_nav {
            ActiveNavigation::Recent => right
                .added_at
                .cmp(&left.added_at)
                .then_with(|| left.id.cmp(&right.id)),
            ActiveNavigation::RecentOpened => right
                .last_opened_at
                .cmp(&left.last_opened_at)
                .then_with(|| left.id.cmp(&right.id)),
            _ => std::cmp::Ordering::Equal,
        });
        candidates.truncate(50);
    }

    candidates
        .into_iter()
        .filter(|entry| matches_filters(entry, request))
        .collect()
}

fn matches_navigation(entry: &IndexEntry, navigation: ActiveNavigation) -> bool {
    match navigation {
        ActiveNavigation::Library => true,
        ActiveNavigation::Recent => !entry.invalid && entry.added_at > 0,
        ActiveNavigation::RecentOpened => {
            !entry.invalid && entry.last_opened_at.is_some_and(|value| value > 0)
        }
        ActiveNavigation::Favorites => entry.favorite,
        ActiveNavigation::Invalid => entry.invalid,
    }
}

fn matches_filters(entry: &IndexEntry, request: &NormalizedRequest) -> bool {
    if let Some(filter) = &request.filter {
        if normalize_text(&entry.file_type) != *filter {
            return false;
        }
    }
    if !request.group_ids.is_empty()
        && entry
            .group_id
            .as_ref()
            .is_none_or(|group_id| !request.group_ids.contains(group_id))
    {
        return false;
    }
    if !request.tags.is_empty() {
        let entry_tags = entry
            .tags
            .iter()
            .map(|tag| normalize_text(tag))
            .collect::<HashSet<_>>();
        if request.tags.iter().any(|tag| !entry_tags.contains(tag)) {
            return false;
        }
    }
    true
}

fn searchable_fields(entry: &IndexEntry, group_names: &HashMap<&str, &str>) -> Vec<SearchField> {
    let mut fields = vec![
        make_field("name", &entry.name),
        make_field("type", &entry.file_type),
        make_field("status", &entry.status),
        make_field("location", &position_summary(&entry.path)),
    ];
    fields.extend(entry.tags.iter().map(|tag| make_field("tag", tag)));
    if let Some(group_name) = entry
        .group_id
        .as_deref()
        .and_then(|group_id| group_names.get(group_id).copied())
    {
        fields.push(make_field("group", group_name));
    }
    fields.into_iter().flatten().collect()
}

fn make_field(key: &'static str, value: &str) -> Option<SearchField> {
    let value = value
        .chars()
        .take(MAX_SEARCH_FIELD_CHARS)
        .collect::<String>();
    if value.is_empty() {
        return None;
    }
    Some(SearchField {
        key,
        plain: NormalizedText::new(&value, true),
        regex: NormalizedText::new(&value, false),
    })
}

fn position_summary(path: &str) -> String {
    let normalized = path.replace('/', "\\");
    let characters = normalized.chars().collect::<Vec<_>>();
    if characters.len() <= MAX_POSITION_SUMMARY_CHARS {
        return normalized;
    }
    let prefix_length = MAX_POSITION_SUMMARY_CHARS / 2;
    let suffix_length = MAX_POSITION_SUMMARY_CHARS - prefix_length - 3;
    format!(
        "{}...{}",
        characters[..prefix_length].iter().collect::<String>(),
        characters[characters.len() - suffix_length..]
            .iter()
            .collect::<String>()
    )
}

fn find_hit(
    entry: &IndexEntry,
    fields: &[SearchField],
    patterns: &[Regex],
    use_regex: bool,
) -> Option<MetadataSearchHit> {
    let field = if use_regex {
        fields.iter().find(|field| {
            patterns
                .iter()
                .any(|pattern| pattern.is_match(&field.regex.value))
        })?
    } else {
        if !patterns.iter().all(|pattern| {
            fields
                .iter()
                .any(|field| pattern.is_match(&field.plain.value))
        }) {
            return None;
        }
        fields
            .iter()
            .find(|field| {
                patterns
                    .iter()
                    .all(|pattern| pattern.is_match(&field.plain.value))
            })
            .or_else(|| {
                fields.iter().find(|field| {
                    patterns
                        .iter()
                        .any(|pattern| pattern.is_match(&field.plain.value))
                })
            })?
    };
    let text = if use_regex {
        &field.regex
    } else {
        &field.plain
    };
    Some(MetadataSearchHit {
        file_id: entry.id.clone(),
        field: field.key.to_string(),
        ranges: ranges_for(text, patterns),
    })
}

fn ranges_for(text: &NormalizedText, patterns: &[Regex]) -> Vec<MetadataTextRange> {
    let mut ranges = Vec::new();
    for pattern in patterns {
        for matched in pattern.find_iter(&text.value) {
            if let Some(range) = original_range(text, matched.start(), matched.end()) {
                ranges.push(range);
            }
            if ranges.len() >= MAX_HIT_RANGES {
                break;
            }
        }
        if ranges.len() >= MAX_HIT_RANGES {
            break;
        }
    }
    ranges.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<MetadataTextRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut() {
            if range.start <= previous.end {
                previous.end = previous.end.max(range.end);
                continue;
            }
        }
        merged.push(range);
    }
    merged
}

fn original_range(
    text: &NormalizedText,
    start_byte: usize,
    end_byte: usize,
) -> Option<MetadataTextRange> {
    let start = text.value[..start_byte].chars().count();
    let end = text.value[..end_byte].chars().count();
    if start >= end {
        return None;
    }
    let original_start = *text.original_indexes.get(start)?;
    let original_end = text.original_indexes.get(end - 1)?.saturating_add(1);
    (original_start < original_end).then_some(MetadataTextRange {
        start: original_start,
        end: original_end,
    })
}

impl NormalizedText {
    fn new(value: &str, collapse_whitespace: bool) -> Self {
        let mut normalized = Vec::new();
        for (original_index, character) in value.chars().enumerate() {
            let lower = character
                .to_string()
                .nfkc()
                .collect::<String>()
                .to_lowercase();
            for character in lower.chars() {
                normalized.push((
                    if character.is_whitespace() {
                        ' '
                    } else {
                        character
                    },
                    original_index,
                ));
            }
        }
        if collapse_whitespace {
            let mut compact = Vec::with_capacity(normalized.len());
            let mut previous_space = true;
            for (character, original_index) in normalized {
                if character == ' ' {
                    if previous_space {
                        continue;
                    }
                    previous_space = true;
                } else {
                    previous_space = false;
                }
                compact.push((character, original_index));
            }
            if compact
                .last()
                .is_some_and(|(character, _)| *character == ' ')
            {
                compact.pop();
            }
            normalized = compact;
        }
        let value = normalized.iter().map(|(character, _)| *character).collect();
        let original_indexes = normalized
            .into_iter()
            .map(|(_, original_index)| original_index)
            .collect();
        Self {
            value,
            original_indexes,
        }
    }
}

fn normalize_text(value: &str) -> String {
    value
        .nfkc()
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

fn is_opaque_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= MAX_ID_CHARS
        && !value.contains('/')
        && !value.contains('\\')
        && !value.contains(':')
        && !value.contains("..")
        && !value
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

fn default_active_nav() -> String {
    "library".to_string()
}

#[cfg(test)]
mod tests {
    use super::{search, MetadataSearchError, MetadataSearchQuery};
    use crate::filesystem::IndexEntry;
    use crate::storage::Group;

    fn entry(id: &str, name: &str) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            path: format!("C:\\资料\\项目\\{name}"),
            name: name.to_string(),
            kind: "text".to_string(),
            file_type: "代码或配置".to_string(),
            size: 10,
            modified_at: 1,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: 1,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: vec!["研究".to_string()],
            group_id: Some("group-a".to_string()),
        }
    }

    fn query(value: &str) -> MetadataSearchQuery {
        MetadataSearchQuery {
            query: value.to_string(),
            ..MetadataSearchQuery::default()
        }
    }

    #[test]
    fn searches_unicode_metadata_and_returns_only_ids_and_ranges() {
        let entries = [entry("file-a", "Ａ计划.py")];
        let groups = [Group {
            id: "group-a".to_string(),
            name: "重点项目".to_string(),
        }];
        let result = search(&entries, &groups, 7, &query("ａ计划")).expect("query should work");
        assert_eq!(result.revision, 7);
        assert_eq!(result.matched_ids, ["file-a"]);
        assert_eq!(result.hits[0].field, "name");
        assert_eq!(
            result.hits[0].ranges,
            [super::MetadataTextRange { start: 0, end: 3 }]
        );
        let serialized = serde_json::to_string(&result).expect("response should serialize");
        assert!(!serialized.contains("C:\\\\资料"));
        assert!(!serialized.contains("path"));
    }

    #[test]
    fn supports_regex_filters_and_rejects_unsafe_inputs_without_js_backtracking() {
        let entries = [entry("file-a", "aaaaaaaa")];
        let mut regex_query = query(r"^(a+)+$");
        regex_query.use_regex = true;
        assert_eq!(search(&entries, &[], 1, &regex_query).unwrap().total, 1);

        let mut invalid_query = query("[");
        invalid_query.use_regex = true;
        assert_eq!(
            search(&entries, &[], 1, &invalid_query),
            Err(MetadataSearchError::Query)
        );
        assert_eq!(
            search(
                &entries,
                &[],
                1,
                &query(&"a".repeat(super::MAX_QUERY_CHARS + 1))
            ),
            Err(MetadataSearchError::Query)
        );
    }

    #[test]
    fn bounds_long_location_fields_while_preserving_a_safe_position_summary() {
        let mut long_path = entry("file-a", "报告.txt");
        long_path.path = format!("C:\\资料\\{}\\报告.txt", "深层目录\\".repeat(700));
        let result = search(&[long_path], &[], 4, &query("C:\\资料")).expect("query should work");
        assert_eq!(result.matched_ids, ["file-a"]);
        assert!(result.hits[0].ranges.len() <= super::MAX_HIT_RANGES);
    }

    #[test]
    fn applies_navigation_type_tag_and_group_filters_before_matching() {
        let mut favorite = entry("favorite", "目标.txt");
        favorite.favorite = true;
        favorite.file_type = "文本文件".to_string();
        let entries = [favorite, entry("other", "目标.txt")];
        let mut request = query("目标");
        request.active_nav = "favorites".to_string();
        request.filter = "文本文件".to_string();
        request.group_ids = vec!["group-a".to_string()];
        request.tags = vec!["研究".to_string()];
        let result = search(&entries, &[], 2, &request).expect("filters should work");
        assert_eq!(result.matched_ids, ["favorite"]);
    }

    #[test]
    fn handles_a_twenty_thousand_entry_snapshot_with_bounded_results() {
        let entries = (0..20_000)
            .map(|index| entry(&format!("file-{index}"), &format!("资料-{index}.txt")))
            .collect::<Vec<_>>();
        let result = search(&entries, &[], 3, &query("资料")).expect("large search should work");
        assert_eq!(result.total, 20_000);
        assert_eq!(result.matched_ids.len(), 20_000);
        assert!(!result.truncated);
    }
}
