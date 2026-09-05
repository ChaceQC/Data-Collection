use regex::{Regex, RegexBuilder};

use super::content_index::{ContentDocuments, ContentIndexError, MAX_CONTENT_QUERY_CHARS};

pub(crate) const MAX_REGEX_PROGRAM_BYTES: usize = 64 * 1024;
const MAX_MATCHES_PER_DOCUMENT: usize = 64;
const MAX_SNIPPETS_PER_RESULT: usize = 3;
const SNIPPET_CONTEXT_CHARS: usize = 72;
const MAX_SNIPPET_CHARS: usize = 240;

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentSearchResult {
    pub file_id: String,
    pub match_count: usize,
    pub matches_truncated: bool,
    pub snippets: Vec<ContentSnippet>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentSnippet {
    pub text: String,
    pub ranges: Vec<ContentTextRange>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ContentTextRange {
    pub start: usize,
    pub end: usize,
}

#[derive(Clone, Copy, Debug)]
struct MatchRange {
    start: usize,
    end: usize,
}

#[cfg(test)]
pub(crate) fn search(
    documents: &ContentDocuments,
    query: &str,
    use_regex: bool,
) -> Result<Vec<ContentSearchResult>, ContentIndexError> {
    search_checked(documents, query, use_regex, &|| Ok(()))
}

pub(crate) fn search_checked(
    documents: &ContentDocuments,
    query: &str,
    use_regex: bool,
    check: &dyn Fn() -> Result<(), ContentIndexError>,
) -> Result<Vec<ContentSearchResult>, ContentIndexError> {
    check()?;
    let patterns = compile_patterns(query, use_regex)?;
    let mut ordered_documents = documents.values().collect::<Vec<_>>();
    ordered_documents.sort_by(|left, right| left.file_id.cmp(&right.file_id));

    let mut results = Vec::new();
    for document in ordered_documents {
        check()?;
        let Some((ranges, match_count, matches_truncated)) =
            find_matches(&document.content, &patterns, check)?
        else {
            continue;
        };
        results.push(ContentSearchResult {
            file_id: document.file_id.clone(),
            match_count,
            matches_truncated,
            snippets: make_snippets(&document.content, &ranges),
        });
    }
    Ok(results)
}

fn compile_patterns(query: &str, use_regex: bool) -> Result<Vec<Regex>, ContentIndexError> {
    let normalized = query.trim();
    if normalized.is_empty()
        || normalized.chars().count() > MAX_CONTENT_QUERY_CHARS
        || normalized.chars().any(char::is_control)
    {
        return Err(ContentIndexError::InvalidQuery);
    }

    let expressions = if use_regex {
        vec![normalized.to_string()]
    } else {
        normalized
            .split_whitespace()
            .map(regex::escape)
            .collect::<Vec<_>>()
    };
    expressions
        .into_iter()
        .map(|expression| {
            RegexBuilder::new(&expression)
                .case_insensitive(true)
                .multi_line(true)
                .size_limit(MAX_REGEX_PROGRAM_BYTES)
                .dfa_size_limit(MAX_REGEX_PROGRAM_BYTES)
                .build()
                .map_err(|_| ContentIndexError::InvalidQuery)
        })
        .collect()
}

fn find_matches(
    content: &str,
    patterns: &[Regex],
    check: &dyn Fn() -> Result<(), ContentIndexError>,
) -> Result<Option<(Vec<MatchRange>, usize, bool)>, ContentIndexError> {
    let mut ranges = Vec::new();
    let mut match_count: usize = 0;
    let mut matches_truncated = false;

    for pattern in patterns {
        check()?;
        let mut pattern_matches = 0;
        for matched in pattern.find_iter(content) {
            check()?;
            if matched.start() == matched.end() {
                continue;
            }
            pattern_matches += 1;
            match_count = match_count.saturating_add(1);
            if pattern_matches > MAX_MATCHES_PER_DOCUMENT {
                matches_truncated = true;
                break;
            }
            if ranges.len() < MAX_MATCHES_PER_DOCUMENT {
                ranges.push(MatchRange {
                    start: matched.start(),
                    end: matched.end(),
                });
            }
        }
        if pattern_matches == 0 {
            return Ok(None);
        }
    }

    ranges.sort_by_key(|range| (range.start, range.end));
    let mut merged: Vec<MatchRange> = Vec::with_capacity(ranges.len());
    for range in ranges {
        if let Some(previous) = merged.last_mut() {
            if range.start <= previous.end {
                previous.end = previous.end.max(range.end);
                continue;
            }
        }
        merged.push(range);
    }
    // 字节坐标排序后单次前向换算，避免每个命中反复扫描正文前缀。
    let mut byte_offset = 0;
    let mut char_offset = 0;
    for range in &mut merged {
        char_offset += content[byte_offset..range.start].chars().count();
        let start = char_offset;
        char_offset += content[range.start..range.end].chars().count();
        byte_offset = range.end;
        range.start = start;
        range.end = char_offset;
    }
    Ok(Some((
        merged,
        match_count.min(MAX_MATCHES_PER_DOCUMENT),
        matches_truncated || match_count > MAX_MATCHES_PER_DOCUMENT,
    )))
}

fn make_snippets(content: &str, ranges: &[MatchRange]) -> Vec<ContentSnippet> {
    let characters = content.chars().collect::<Vec<_>>();
    let mut snippets = Vec::new();
    let mut previous_end = 0;

    for range in ranges {
        if snippets.len() >= MAX_SNIPPETS_PER_RESULT || range.start < previous_end {
            continue;
        }
        let mut start = range.start.saturating_sub(SNIPPET_CONTEXT_CHARS);
        let mut end = (range.end + SNIPPET_CONTEXT_CHARS).min(characters.len());
        if end.saturating_sub(start) > MAX_SNIPPET_CHARS {
            let match_length = range.end.saturating_sub(range.start);
            let available_context = MAX_SNIPPET_CHARS.saturating_sub(match_length) / 2;
            start = range.start.saturating_sub(available_context);
            end = (range.end + available_context).min(characters.len());
            if end.saturating_sub(start) > MAX_SNIPPET_CHARS {
                start = end.saturating_sub(MAX_SNIPPET_CHARS);
            }
        }

        let prefix_text = if start > 0 { "..." } else { "" };
        let suffix_text = if end < characters.len() { "..." } else { "" };
        let prefix = prefix_text.chars().count();
        let text = format!(
            "{}{}{}",
            prefix_text,
            characters[start..end].iter().collect::<String>(),
            suffix_text,
        );
        let snippet_end = prefix + end.saturating_sub(start);
        let snippet_ranges = ranges
            .iter()
            .filter(|candidate| candidate.end > start && candidate.start < end)
            .map(|candidate| ContentTextRange {
                start: prefix + candidate.start.max(start) - start,
                end: prefix + candidate.end.min(end) - start,
            })
            .filter(|candidate| candidate.start < candidate.end && candidate.end <= snippet_end)
            .collect();
        snippets.push(ContentSnippet {
            text,
            ranges: snippet_ranges,
        });
        previous_end = end;
    }
    snippets
}

#[cfg(test)]
mod tests {
    use super::search;
    use crate::storage::content_index::ContentDocument;
    use std::collections::HashMap;

    #[test]
    fn snippet_contract_matches_rendered_unicode_fixtures_and_exact_match_cap() {
        let cases: serde_json::Value =
            serde_json::from_str(include_str!("../../../shared/content-snippet-cases.json"))
                .unwrap();
        for case in cases.as_array().unwrap() {
            let documents = HashMap::from([(
                "file-a".to_string(),
                std::sync::Arc::new(document("file-a", case["content"].as_str().unwrap())),
            )]);
            let result = search(
                &documents,
                case["query"].as_str().unwrap(),
                case["useRegex"].as_bool().unwrap(),
            )
            .unwrap();
            let serialized = serde_json::to_value(&result[0]).unwrap();
            assert_eq!(serialized["snippets"], case["snippets"], "{}", case["name"]);
            assert_eq!(serialized["matchCount"], case["matchCount"]);
            assert_eq!(serialized["matchesTruncated"], case["matchesTruncated"]);
        }
        for count in [64, 65] {
            let documents = HashMap::from([(
                "file-a".to_string(),
                std::sync::Arc::new(document("file-a", &"中 ".repeat(count))),
            )]);
            let results = search(&documents, "中", false).unwrap();
            assert_eq!(results[0].match_count, 64);
            assert_eq!(results[0].matches_truncated, count > 64);
            assert!(search(&documents, "^", true).unwrap().is_empty());
        }
    }

    fn document(id: &str, content: &str) -> ContentDocument {
        ContentDocument {
            file_id: id.to_string(),
            path: format!("C:\\资料\\{id}.md"),
            size: content.len() as u64,
            modified_at_nanos: 1_000_000_000,
            modified_at: 1,
            content: content.to_string(),
        }
    }

    #[test]
    fn searches_plain_text_as_case_insensitive_terms_and_returns_ranges() {
        let documents = HashMap::from([(
            String::from("file-a"),
            std::sync::Arc::new(document("file-a", "标题\nRust 本地检索")),
        )]);
        let results = search(&documents, "rust 检索", false).expect("query should work");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].match_count, 2);
        assert!(!results[0].snippets[0].ranges.is_empty());
    }

    #[test]
    fn supports_linear_time_regular_expressions_and_rejects_invalid_queries() {
        let documents = HashMap::from([(
            String::from("file-a"),
            std::sync::Arc::new(document("file-a", "编号 A-1024\n编号 B-2048")),
        )]);
        let results = search(&documents, r"[A-Z]-\d+", true).expect("regex should work");
        assert_eq!(results[0].match_count, 2);
        assert!(search(&documents, "[", true).is_err());
    }
}
