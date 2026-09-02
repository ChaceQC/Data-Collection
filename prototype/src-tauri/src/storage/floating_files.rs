use std::{
    cmp::Ordering,
    collections::{HashMap, HashSet},
};

use serde::{Deserialize, Serialize};
use thiserror::Error;

use crate::filesystem::IndexEntry;

use super::Group;

pub const DEFAULT_LIMIT: usize = 50;
pub const MAX_LIMIT: usize = 100;
pub const MAX_OFFSET: usize = crate::filesystem::MAX_INDEX_ENTRIES;
pub const MAX_QUERY_CHARS: usize = 256;

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FloatingFilesQuery {
    #[serde(default)]
    pub query: String,
    #[serde(default = "default_filter")]
    pub filter: String,
    #[serde(default = "default_sort_key")]
    pub sort_key: String,
    #[serde(default = "default_direction")]
    pub direction: String,
    #[serde(default)]
    pub offset: usize,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

impl Default for FloatingFilesQuery {
    fn default() -> Self {
        Self {
            query: String::new(),
            filter: default_filter(),
            sort_key: default_sort_key(),
            direction: default_direction(),
            offset: 0,
            limit: default_limit(),
        }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingFilesResult {
    pub revision: u64,
    pub items: Vec<FloatingFileItem>,
    pub total: usize,
    pub offset: usize,
    pub limit: usize,
    pub has_more: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloatingFileItem {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub kind: String,
    pub status: String,
    pub invalid: bool,
    pub favorite: bool,
    pub size: Option<u64>,
    pub modified_at: Option<i64>,
    pub last_opened_at: Option<i64>,
    pub group_id: Option<String>,
    pub group_name: Option<String>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Error)]
pub enum FloatingFilesQueryError {
    #[error("文件库搜索内容无效")]
    Query,
    #[error("文件库筛选条件无效")]
    Filter,
    #[error("文件库排序字段无效")]
    SortKey,
    #[error("文件库排序方向无效")]
    Direction,
    #[error("文件库分页偏移无效")]
    Offset,
    #[error("文件库分页数量无效")]
    Limit,
}

impl FloatingFilesQueryError {
    pub fn code(self) -> &'static str {
        "invalid-floating-files-query"
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Filter {
    All,
    Favorite,
    Folder,
    Invalid,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum SortKey {
    Name,
    Type,
    ModifiedAt,
    LastOpenedAt,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum Direction {
    Asc,
    Desc,
}

struct NormalizedQuery {
    tokens: Vec<String>,
    filter: Filter,
    sort_key: SortKey,
    direction: Direction,
    offset: usize,
    limit: usize,
}

struct Candidate {
    item: FloatingFileItem,
    searchable: String,
}

pub fn query_floating_files(
    entries: &[IndexEntry],
    groups: &[Group],
    revision: u64,
    request: &FloatingFilesQuery,
) -> Result<FloatingFilesResult, FloatingFilesQueryError> {
    let query = normalize_query(request)?;
    let group_names = groups
        .iter()
        .map(|group| (group.id.as_str(), group.name.as_str()))
        .collect::<HashMap<_, _>>();
    let mut seen_ids = HashSet::with_capacity(entries.len());
    let mut candidates = entries
        .iter()
        .filter(|entry| matches_filter(entry, query.filter))
        .map(|entry| {
            let group_name = entry
                .group_id
                .as_deref()
                .and_then(|id| group_names.get(id).copied());
            Candidate {
                searchable: searchable_text(entry, group_name),
                item: project_entry(entry, &group_names),
            }
        })
        .filter(|candidate| {
            query
                .tokens
                .iter()
                .all(|token| candidate.searchable.contains(token))
        })
        .filter(|candidate| seen_ids.insert(candidate.item.id.clone()))
        .collect::<Vec<_>>();

    candidates
        .sort_by(|left, right| compare_candidates(left, right, query.sort_key, query.direction));
    let total = candidates.len();
    let items = candidates
        .into_iter()
        .skip(query.offset)
        .take(query.limit)
        .map(|candidate| candidate.item)
        .collect::<Vec<_>>();
    let has_more = query.offset.saturating_add(items.len()) < total;

    Ok(FloatingFilesResult {
        revision,
        items,
        total,
        offset: query.offset,
        limit: query.limit,
        has_more,
    })
}

pub fn validate_floating_files_query(
    request: &FloatingFilesQuery,
) -> Result<(), FloatingFilesQueryError> {
    normalize_query(request).map(|_| ())
}

fn normalize_query(
    request: &FloatingFilesQuery,
) -> Result<NormalizedQuery, FloatingFilesQueryError> {
    if request.query.chars().count() > MAX_QUERY_CHARS
        || request.query.chars().any(char::is_control)
    {
        return Err(FloatingFilesQueryError::Query);
    }
    let filter = match request.filter.as_str() {
        "all" => Filter::All,
        "favorite" => Filter::Favorite,
        "folder" => Filter::Folder,
        "invalid" => Filter::Invalid,
        _ => return Err(FloatingFilesQueryError::Filter),
    };
    let sort_key = match request.sort_key.as_str() {
        "name" => SortKey::Name,
        "type" => SortKey::Type,
        "modifiedAt" => SortKey::ModifiedAt,
        "lastOpenedAt" => SortKey::LastOpenedAt,
        _ => return Err(FloatingFilesQueryError::SortKey),
    };
    let direction = match request.direction.as_str() {
        "asc" => Direction::Asc,
        "desc" => Direction::Desc,
        _ => return Err(FloatingFilesQueryError::Direction),
    };
    if request.offset > MAX_OFFSET {
        return Err(FloatingFilesQueryError::Offset);
    }
    if !(1..=MAX_LIMIT).contains(&request.limit) {
        return Err(FloatingFilesQueryError::Limit);
    }
    Ok(NormalizedQuery {
        tokens: request
            .query
            .trim()
            .to_lowercase()
            .split_whitespace()
            .map(str::to_owned)
            .collect(),
        filter,
        sort_key,
        direction,
        offset: request.offset,
        limit: request.limit,
    })
}

fn matches_filter(entry: &IndexEntry, filter: Filter) -> bool {
    match filter {
        Filter::All => true,
        Filter::Favorite => entry.favorite,
        Filter::Folder => entry.kind == "folder",
        Filter::Invalid => entry.invalid,
    }
}

fn searchable_text(entry: &IndexEntry, group_name: Option<&str>) -> String {
    let mut fields = vec![entry.name.as_str(), entry.file_type.as_str()];
    fields.extend(entry.tags.iter().map(String::as_str));
    if let Some(group_name) = group_name {
        fields.push(group_name);
    }
    fields.join(" ").to_lowercase()
}

fn project_entry(entry: &IndexEntry, group_names: &HashMap<&str, &str>) -> FloatingFileItem {
    let group_id = entry
        .group_id
        .as_deref()
        .filter(|id| group_names.contains_key(id))
        .map(str::to_owned);
    let group_name = group_id
        .as_deref()
        .and_then(|id| group_names.get(id).copied())
        .map(str::to_owned);
    FloatingFileItem {
        id: entry.id.clone(),
        name: entry.name.clone(),
        file_type: entry.file_type.clone(),
        kind: match entry.kind.as_str() {
            "folder" => "folder",
            "other" => "other",
            _ => "file",
        }
        .to_string(),
        status: entry.status.clone(),
        invalid: entry.invalid,
        favorite: entry.favorite,
        size: (entry.kind != "folder").then_some(entry.size),
        modified_at: (entry.modified_at >= 0).then_some(entry.modified_at),
        last_opened_at: entry.last_opened_at.filter(|value| *value > 0),
        group_id,
        group_name,
    }
}

fn compare_candidates(
    left: &Candidate,
    right: &Candidate,
    key: SortKey,
    direction: Direction,
) -> Ordering {
    let primary = match key {
        SortKey::Name => compare_strings(&left.item.name, &right.item.name, direction),
        SortKey::Type => compare_strings(&left.item.file_type, &right.item.file_type, direction),
        SortKey::ModifiedAt => {
            compare_optional_numbers(left.item.modified_at, right.item.modified_at, direction)
        }
        SortKey::LastOpenedAt => compare_optional_numbers(
            left.item.last_opened_at,
            right.item.last_opened_at,
            direction,
        ),
    };
    primary.then_with(|| left.item.id.cmp(&right.item.id))
}

fn compare_strings(left: &str, right: &str, direction: Direction) -> Ordering {
    let ordering = left
        .to_lowercase()
        .cmp(&right.to_lowercase())
        .then_with(|| left.cmp(right));
    if direction == Direction::Desc {
        ordering.reverse()
    } else {
        ordering
    }
}

fn compare_optional_numbers(
    left: Option<i64>,
    right: Option<i64>,
    direction: Direction,
) -> Ordering {
    match (left, right) {
        (None, None) => Ordering::Equal,
        (None, Some(_)) => Ordering::Greater,
        (Some(_), None) => Ordering::Less,
        (Some(left), Some(right)) => {
            if direction == Direction::Desc {
                right.cmp(&left)
            } else {
                left.cmp(&right)
            }
        }
    }
}

fn default_filter() -> String {
    "all".to_string()
}

fn default_sort_key() -> String {
    "name".to_string()
}

fn default_direction() -> String {
    "asc".to_string()
}

fn default_limit() -> usize {
    DEFAULT_LIMIT
}

#[cfg(test)]
mod tests {
    use super::{query_floating_files, FloatingFilesQuery, MAX_LIMIT};
    use crate::filesystem::IndexEntry;

    fn entry(id: &str, name: &str, kind: &str) -> IndexEntry {
        IndexEntry {
            id: id.to_string(),
            path: format!("C:\\资料\\{name}"),
            name: name.to_string(),
            kind: kind.to_string(),
            file_type: "文本文件".to_string(),
            size: 8,
            modified_at: 10,
            status: "已登记".to_string(),
            invalid: false,
            favorite: false,
            added_at: 10,
            preview_status: "idle".to_string(),
            last_recorded_at: None,
            last_opened_at: None,
            tags: Vec::new(),
            group_id: None,
        }
    }

    #[test]
    fn returns_all_entries_without_paths_and_keeps_folder_size_null() {
        let mut entries = (0..6)
            .map(|index| {
                entry(
                    &format!("file-{index}"),
                    &format!("资料 {index}.txt"),
                    "text",
                )
            })
            .collect::<Vec<_>>();
        entries.push(entry("folder-1", "资料目录", "folder"));
        let result = query_floating_files(&entries, &[], 7, &FloatingFilesQuery::default())
            .expect("query should succeed");
        assert_eq!(result.total, 7);
        assert_eq!(result.items.len(), 7);
        assert_eq!(result.items.last().and_then(|item| item.size), None);
        let json = serde_json::to_string(&result).expect("result should serialize");
        assert!(!json.contains("C:\\\\资料"));
    }

    #[test]
    fn filters_searches_sorts_and_deduplicates_ids() {
        let mut favorite = entry("file-1", "Zeta.txt", "text");
        favorite.favorite = true;
        favorite.tags = vec!["项目 A".to_string()];
        let duplicate = favorite.clone();
        let folder = entry("folder-1", "项目目录", "folder");
        let mut request = FloatingFilesQuery {
            query: "项目".to_string(),
            filter: "favorite".to_string(),
            offset: 0,
            limit: 1,
            ..FloatingFilesQuery::default()
        };
        let result = query_floating_files(&[favorite, duplicate, folder], &[], 2, &request)
            .expect("query should succeed");
        assert_eq!(result.total, 1);
        assert_eq!(result.items[0].id, "file-1");
        request.limit = MAX_LIMIT + 1;
        assert!(query_floating_files(&[], &[], 2, &request).is_err());
    }
}
