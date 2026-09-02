use std::{collections::HashSet, fs, path::Path};

use serde::{Deserialize, Serialize};

use super::{
    build_file_entry, canonicalize_existing_path, is_path_within, is_unsafe_metadata,
    path_error_category, path_identity, sort_entries, type_info_for_path, validate_directory_path,
    IndexEntry, PathValidationError, MAX_INDEX_ENTRIES,
};

pub const DEFAULT_MAX_DEPTH: usize = 32;
pub const MAX_MAX_DEPTH: usize = 64;
pub const DEFAULT_MAX_ENTRIES: usize = MAX_INDEX_ENTRIES;
pub const MAX_SCAN_NODES: usize = 80_000;
pub const MAX_PATH_BYTES: usize = 32 * 1024;
pub const MAX_TRACKED_PATH_BYTES: usize = 16 * 1024 * 1024;
pub const MAX_PENDING_PATH_BYTES: usize = 8 * 1024 * 1024;
pub const MAX_ENTRY_METADATA_BYTES: usize = 32 * 1024 * 1024;
const MAX_SKIP_REASONS: usize = 32;

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecursiveImportPolicy {
    #[serde(default = "default_max_depth")]
    pub max_depth: usize,
    #[serde(default = "default_max_entries")]
    pub max_entries: usize,
    #[serde(default = "default_skip_hidden")]
    pub skip_hidden: bool,
    #[serde(default)]
    pub include_unsupported: bool,
}

impl Default for RecursiveImportPolicy {
    fn default() -> Self {
        Self {
            max_depth: DEFAULT_MAX_DEPTH,
            max_entries: DEFAULT_MAX_ENTRIES,
            skip_hidden: true,
            include_unsupported: false,
        }
    }
}

impl RecursiveImportPolicy {
    pub fn normalized(self) -> Self {
        Self {
            max_depth: self.max_depth.clamp(1, MAX_MAX_DEPTH),
            max_entries: self.max_entries.clamp(1, MAX_INDEX_ENTRIES),
            skip_hidden: self.skip_hidden,
            include_unsupported: self.include_unsupported,
        }
    }

    fn node_budget(&self) -> usize {
        self.max_entries.saturating_mul(4).clamp(4, MAX_SCAN_NODES)
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecursiveScanProgress {
    pub scanned_count: usize,
    pub candidate_count: usize,
    pub accepted_count: usize,
    pub skipped_count: usize,
    pub current_name: Option<String>,
    pub truncated: bool,
}

#[derive(Debug, Default)]
pub struct RecursiveScanResult {
    pub entries: Vec<IndexEntry>,
    pub scanned_count: usize,
    pub candidate_count: usize,
    pub skipped_count: usize,
    pub skipped_reasons: Vec<String>,
    pub truncated: bool,
    pub stopped: bool,
}

pub fn scan_paths_recursive<Stop, Report>(
    raw_paths: &[String],
    policy: RecursiveImportPolicy,
    mut should_stop: Stop,
    mut report: Report,
) -> Result<RecursiveScanResult, PathValidationError>
where
    Stop: FnMut() -> bool,
    Report: FnMut(RecursiveScanProgress),
{
    let policy = policy.normalized();
    let mut result = RecursiveScanResult::default();
    let mut seen_paths = HashSet::new();
    let mut tracked_path_bytes: usize = 0;
    let mut roots = Vec::new();
    let mut directories = Vec::new();
    let mut pending_path_bytes: usize = 0;
    let mut entry_metadata_bytes: usize = 0;

    for raw_path in raw_paths {
        let root = validate_directory_path(raw_path)?;
        if !path_length_is_safe(&root) {
            return Err(PathValidationError::Invalid);
        }
        if !remember_path(&mut seen_paths, &root, &mut tracked_path_bytes)
            .map_err(|_| PathValidationError::Invalid)?
        {
            record_skipped(&mut result, "重复路径");
            continue;
        }
        let root_index = roots.len();
        pending_path_bytes += path_length(&root);
        roots.push(root.clone());
        directories.push((root_index, root, 0));
    }

    'walk: while let Some((root_index, directory, depth)) = directories.pop() {
        pending_path_bytes = pending_path_bytes.saturating_sub(path_length(&directory));
        if should_stop() {
            result.stopped = true;
            break;
        }

        let read_dir = match fs::read_dir(&directory) {
            Ok(read_dir) => read_dir,
            Err(error) => {
                record_skipped(
                    &mut result,
                    path_error_category(super::map_path_io_error(error)),
                );
                report_progress(&mut report, &result, None);
                continue;
            }
        };

        for child_result in read_dir {
            if should_stop() {
                result.stopped = true;
                break 'walk;
            }
            if result.scanned_count >= policy.node_budget() {
                result.truncated = true;
                record_skipped(&mut result, "达到扫描节点上限");
                break 'walk;
            }

            result.scanned_count += 1;
            let child = match child_result {
                Ok(child) => child.path(),
                Err(_) => {
                    record_skipped(&mut result, "目录项读取失败");
                    report_progress(&mut report, &result, None);
                    continue;
                }
            };
            let current_name = file_name(&child);

            if !path_length_is_safe(&child) {
                record_skipped(&mut result, "路径过长");
                report_progress(&mut report, &result, current_name);
                continue;
            }

            let link_metadata = match fs::symlink_metadata(&child) {
                Ok(metadata) => metadata,
                Err(error) => {
                    record_skipped(
                        &mut result,
                        path_error_category(super::map_path_io_error(error)),
                    );
                    report_progress(&mut report, &result, current_name);
                    continue;
                }
            };
            if is_unsafe_metadata(&link_metadata) {
                record_skipped(&mut result, "跳过符号链接或重解析点");
                report_progress(&mut report, &result, current_name);
                continue;
            }
            if policy.skip_hidden && is_hidden_or_system(&child, &link_metadata) {
                record_skipped(&mut result, "跳过隐藏或系统项");
                report_progress(&mut report, &result, current_name);
                continue;
            }

            let canonical = match canonicalize_existing_path(&child.to_string_lossy()) {
                Ok(path) => path,
                Err(error) => {
                    record_skipped(&mut result, path_error_category(error));
                    report_progress(&mut report, &result, current_name);
                    continue;
                }
            };
            if !path_length_is_safe(&canonical) {
                record_skipped(&mut result, "路径过长");
                report_progress(&mut report, &result, current_name);
                continue;
            }
            let Some(root) = roots.get(root_index) else {
                record_skipped(&mut result, "导入范围不可用");
                report_progress(&mut report, &result, current_name);
                continue;
            };
            if !is_path_within(root, &canonical) {
                record_skipped(&mut result, "路径跳出导入范围");
                report_progress(&mut report, &result, current_name);
                continue;
            }
            match remember_path(&mut seen_paths, &canonical, &mut tracked_path_bytes) {
                Ok(true) => {}
                Ok(false) => {
                    record_skipped(&mut result, "重复路径");
                    report_progress(&mut report, &result, current_name);
                    continue;
                }
                Err(()) => {
                    result.truncated = true;
                    record_skipped(&mut result, "达到路径记录内存上限");
                    report_progress(&mut report, &result, current_name);
                    break 'walk;
                }
            }

            let metadata = match fs::symlink_metadata(&canonical) {
                Ok(metadata) => metadata,
                Err(error) => {
                    record_skipped(
                        &mut result,
                        path_error_category(super::map_path_io_error(error)),
                    );
                    report_progress(&mut report, &result, current_name);
                    continue;
                }
            };
            if is_unsafe_metadata(&metadata) {
                record_skipped(&mut result, "跳过符号链接或重解析点");
                report_progress(&mut report, &result, current_name);
                continue;
            }

            if metadata.is_dir() {
                if depth >= policy.max_depth {
                    result.truncated = true;
                    record_skipped(&mut result, "达到递归深度上限");
                } else if directories.len() < policy.node_budget()
                    && pending_path_bytes.saturating_add(path_length(&canonical))
                        <= MAX_PENDING_PATH_BYTES
                {
                    pending_path_bytes += path_length(&canonical);
                    directories.push((root_index, canonical, depth + 1));
                } else {
                    result.truncated = true;
                    record_skipped(
                        &mut result,
                        if directories.len() >= policy.node_budget() {
                            "达到扫描队列上限"
                        } else {
                            "达到待扫描路径内存上限"
                        },
                    );
                }
                report_progress(&mut report, &result, current_name);
                continue;
            }

            if !metadata.is_file() {
                record_skipped(&mut result, "不是普通文件或文件夹");
                report_progress(&mut report, &result, current_name);
                continue;
            }
            if result.candidate_count >= policy.max_entries {
                result.truncated = true;
                record_skipped(&mut result, "达到导入条目上限");
                report_progress(&mut report, &result, current_name);
                break 'walk;
            }

            result.candidate_count += 1;
            if !policy.include_unsupported && type_info_for_path(&canonical).is_none() {
                record_skipped(&mut result, "文件类型不在导入范围");
                report_progress(&mut report, &result, current_name);
                continue;
            }

            match build_file_entry(canonical, &metadata) {
                Some(entry) => {
                    let entry_bytes = entry_metadata_size(&entry);
                    if entry_metadata_bytes.saturating_add(entry_bytes) > MAX_ENTRY_METADATA_BYTES {
                        result.truncated = true;
                        record_skipped(&mut result, "达到索引元数据内存上限");
                        report_progress(&mut report, &result, current_name);
                        break 'walk;
                    }
                    entry_metadata_bytes += entry_bytes;
                    result.entries.push(entry);
                }
                None => record_skipped(&mut result, "无法读取文件名称"),
            }
            report_progress(&mut report, &result, current_name);
        }
    }

    sort_entries(&mut result.entries);
    report_progress(&mut report, &result, None);
    Ok(result)
}

fn report_progress<Report>(
    report: &mut Report,
    result: &RecursiveScanResult,
    current_name: Option<String>,
) where
    Report: FnMut(RecursiveScanProgress),
{
    report(RecursiveScanProgress {
        scanned_count: result.scanned_count,
        candidate_count: result.candidate_count,
        accepted_count: result.entries.len(),
        skipped_count: result.skipped_count,
        current_name,
        truncated: result.truncated,
    });
}

fn record_skipped(result: &mut RecursiveScanResult, reason: &str) {
    result.skipped_count += 1;
    if result.skipped_reasons.len() < MAX_SKIP_REASONS
        && !result.skipped_reasons.iter().any(|item| item == reason)
    {
        result.skipped_reasons.push(reason.to_string());
    }
}

fn file_name(path: &Path) -> Option<String> {
    let value = path.file_name()?.to_string_lossy();
    let name = value
        .chars()
        .filter(|character| !character.is_control())
        .collect::<String>();
    (!name.is_empty()).then_some(name)
}

fn path_length_is_safe(path: &Path) -> bool {
    path_length(path) <= MAX_PATH_BYTES
}

fn path_length(path: &Path) -> usize {
    path.to_string_lossy().len()
}

fn remember_path(
    seen_paths: &mut HashSet<String>,
    path: &Path,
    tracked_path_bytes: &mut usize,
) -> Result<bool, ()> {
    let key = path_identity(&path.to_string_lossy());
    if seen_paths.contains(&key) {
        return Ok(false);
    }
    if tracked_path_bytes.saturating_add(key.len()) > MAX_TRACKED_PATH_BYTES {
        return Err(());
    }
    *tracked_path_bytes += key.len();
    seen_paths.insert(key);
    Ok(true)
}

fn entry_metadata_size(entry: &IndexEntry) -> usize {
    entry.path.len() + entry.name.len() + entry.file_type.len() + entry.kind.len()
}

fn is_hidden_or_system(path: &Path, metadata: &fs::Metadata) -> bool {
    if path
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with('.'))
    {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;

        const FILE_ATTRIBUTE_HIDDEN: u32 = 0x2;
        const FILE_ATTRIBUTE_SYSTEM: u32 = 0x4;
        metadata.file_attributes() & (FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM) != 0
    }
    #[cfg(not(windows))]
    {
        let _ = metadata;
        false
    }
}

fn default_max_depth() -> usize {
    DEFAULT_MAX_DEPTH
}

fn default_max_entries() -> usize {
    DEFAULT_MAX_ENTRIES
}

fn default_skip_hidden() -> bool {
    true
}

#[cfg(test)]
mod tests {
    use super::{scan_paths_recursive, RecursiveImportPolicy, DEFAULT_MAX_ENTRIES};
    use std::path::PathBuf;

    #[test]
    fn scans_supported_files_within_the_selected_root() {
        let root = fixture_root();
        let mut names = Vec::new();
        let result = scan_paths_recursive(
            &[root.to_string_lossy().into_owned()],
            RecursiveImportPolicy::default(),
            || false,
            |progress| {
                if let Some(name) = progress.current_name {
                    names.push(name);
                }
            },
        )
        .expect("fixture root should be readable");

        assert!(result.entries.iter().any(|entry| entry.name == "普通.txt"));
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.name == "空格 文件.txt"));
        assert!(result.entries.iter().any(|entry| entry.name == "重复.txt"));
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.name == "深层资料.txt"));
        assert!(result
            .entries
            .iter()
            .any(|entry| entry.name == "损坏文档.pdf"));
        assert!(!result
            .entries
            .iter()
            .any(|entry| entry.name == "暂不支持.bin"));
        assert!(!names
            .iter()
            .any(|name| name.contains(root.to_string_lossy().as_ref())));
        assert!(result
            .skipped_reasons
            .iter()
            .any(|reason| reason == "文件类型不在导入范围"));
        assert!(result
            .skipped_reasons
            .iter()
            .any(|reason| reason == "跳过隐藏或系统项"));
    }

    #[test]
    fn supports_cancellation_and_entry_limits_without_partial_index_writes() {
        let root = fixture_root();
        let mut stop_checks = 0;
        let cancelled = scan_paths_recursive(
            &[root.to_string_lossy().into_owned()],
            RecursiveImportPolicy::default(),
            || {
                stop_checks += 1;
                stop_checks > 2
            },
            |_| {},
        )
        .expect("cancelled scan should return its partial result");
        assert!(cancelled.stopped);

        let limited = scan_paths_recursive(
            &[root.to_string_lossy().into_owned()],
            RecursiveImportPolicy {
                max_entries: 1,
                ..RecursiveImportPolicy::default()
            },
            || false,
            |_| {},
        )
        .expect("limited scan should return its partial result");
        assert!(limited.entries.len() <= 1);
        assert!(limited.truncated);

        let shallow = scan_paths_recursive(
            &[root.to_string_lossy().into_owned()],
            RecursiveImportPolicy {
                max_depth: 2,
                ..RecursiveImportPolicy::default()
            },
            || false,
            |_| {},
        )
        .expect("shallow scan should return its bounded result");
        assert!(shallow.truncated);
        assert!(!shallow
            .entries
            .iter()
            .any(|entry| entry.name == "深层资料.txt"));

        let missing = root.join("不存在的文件夹");
        assert!(matches!(
            scan_paths_recursive(
                &[missing.to_string_lossy().into_owned()],
                RecursiveImportPolicy::default(),
                || false,
                |_| {},
            ),
            Err(super::PathValidationError::Missing)
        ));
    }

    #[test]
    fn deduplicates_roots_and_can_include_other_regular_files_explicitly() {
        let root = fixture_root();
        let raw_root = root.to_string_lossy().into_owned();
        let duplicate = scan_paths_recursive(
            &[raw_root.clone(), raw_root.clone()],
            RecursiveImportPolicy::default(),
            || false,
            |_| {},
        )
        .expect("duplicate roots should be accepted");
        assert!(duplicate
            .skipped_reasons
            .iter()
            .any(|reason| reason == "重复路径"));

        let all_files = scan_paths_recursive(
            &[raw_root],
            RecursiveImportPolicy {
                include_unsupported: true,
                skip_hidden: false,
                ..RecursiveImportPolicy::default()
            },
            || false,
            |_| {},
        )
        .expect("explicit all-file scan should succeed");
        assert!(all_files
            .entries
            .iter()
            .any(|entry| entry.name == "暂不支持.bin"));
        assert!(all_files
            .entries
            .iter()
            .any(|entry| entry.name == ".隐藏.txt"));
    }

    #[test]
    fn normalizes_untrusted_policy_to_backend_limits() {
        let policy = RecursiveImportPolicy {
            max_depth: usize::MAX,
            max_entries: usize::MAX,
            skip_hidden: true,
            include_unsupported: false,
        }
        .normalized();
        assert_eq!(policy.max_depth, super::MAX_MAX_DEPTH);
        assert_eq!(policy.max_entries, DEFAULT_MAX_ENTRIES);
    }

    fn fixture_root() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/recursive-import")
    }
}
