use super::*;

const MAX_FAILURE_REASONS: usize = 16;

impl ContentIndexState {
    pub(super) fn sync_entries_internal(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        replace_all: bool,
        epoch: u64,
        should_stop: &dyn Fn() -> bool,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        let _guard = self
            .mutation_lock
            .lock()
            .map_err(|_| ContentIndexError::Unavailable)?;
        let current = self.state_snapshot()?;
        let outcome = self.build_entries(
            entries,
            source_revision,
            replace_all,
            epoch,
            should_stop,
            &current,
        );
        if replace_all
            && (outcome.as_ref().is_err() || outcome.as_ref().is_ok_and(|result| result.cancelled))
        {
            let mut restored = (*current).clone();
            restored.status.last_error = Some(match &outcome {
                Err(error) => error.to_string(),
                Ok(_) => "正文索引重建已取消".to_string(),
            });
            self.replace_snapshot(restored)?;
        }
        outcome
    }

    #[allow(clippy::too_many_arguments)]
    fn build_entries(
        &self,
        entries: &[filesystem::IndexEntry],
        source_revision: u64,
        replace_all: bool,
        epoch: u64,
        should_stop: &dyn Fn() -> bool,
        current: &Arc<ContentIndexSnapshot>,
    ) -> Result<ContentSyncResult, ContentIndexError> {
        let should_stop = &|| should_stop() || epoch != self.mutation_epoch.load(Ordering::Acquire);
        let current_status = current.status.clone();
        if source_revision < current_status.source_revision {
            return Err(ContentIndexError::Stale);
        }
        if should_stop() {
            return Ok(ContentSyncResult {
                cancelled: true,
                ..ContentSyncResult::default()
            });
        }
        if current_status.state == "recovery" && !replace_all {
            return Err(ContentIndexError::RecoveryRequired);
        }
        if replace_all {
            let mut indexing = (**current).clone();
            indexing.status.state = "indexing".to_string();
            self.replace_snapshot(indexing)?;
        }
        let path = self.index_path()?;
        let existing = current.documents.clone();
        let mut next = if replace_all {
            HashMap::new()
        } else {
            (*existing).clone()
        };
        let mut result = ContentSyncResult::default();
        // 先移除失效、删除和待替换正文，容量判断不受条目遍历顺序影响。
        let mut prepared = Vec::new();
        let mut source_ids = HashSet::new();
        for entry in entries.iter().filter(|entry| is_indexable_entry(entry)) {
            if should_stop() {
                break;
            }
            source_ids.insert(entry.id.clone());
            let checked = filesystem::validate_regular_file_path(&entry.path);
            let unchanged = checked.as_ref().ok().is_some_and(|(path, metadata)| {
                next.get(&entry.id).is_some_and(|doc| {
                    filesystem::same_path(&doc.path, &path.to_string_lossy())
                        && doc.size == metadata.len()
                        && doc.modified_at_nanos == modified_timestamp_nanos(metadata)
                })
            });
            if !unchanged {
                next.remove(&entry.id);
            }
            prepared.push((entry, checked, unchanged));
        }
        next.retain(|id, _| source_ids.contains(id));
        result.removed_count = existing
            .keys()
            .filter(|id| !source_ids.contains(*id))
            .count();
        let mut total_bytes = next
            .values()
            .map(|document| document.content.len() as u64)
            .sum();
        let mut failed_reasons = Vec::new();

        for (entry, checked, unchanged) in prepared {
            if should_stop() {
                result.cancelled = true;
                break;
            }
            if unchanged {
                continue;
            }
            let previous = existing.get(&entry.id);
            let (path_value, metadata) = match checked {
                Ok(value) => value,
                Err(error) => {
                    remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                    record_failure(&mut result, &mut failed_reasons, path_error_reason(error));
                    continue;
                }
            };
            let modified_at_nanos = modified_timestamp_nanos(&metadata);
            let canonical_path = path_value.to_string_lossy().into_owned();
            let old_size = 0;
            if next.len() >= MAX_CONTENT_INDEX_ENTRIES {
                result.truncated = true;
                record_failure(&mut result, &mut failed_reasons, "已达到正文索引条目数上限");
                continue;
            }

            let content = match read_content(&path_value, &metadata) {
                Ok(content) => content,
                Err(reason) => {
                    remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                    record_failure(&mut result, &mut failed_reasons, reason);
                    continue;
                }
            };
            if content_size_exceeds_limit(total_bytes, old_size, content.len() as u64) {
                remove_document(&mut next, &entry.id, &mut total_bytes, &mut result);
                result.truncated = true;
                record_failure(&mut result, &mut failed_reasons, "已达到正文索引总大小上限");
                continue;
            }
            let document = ContentDocument {
                file_id: entry.id.clone(),
                path: canonical_path,
                size: metadata.len(),
                modified_at_nanos,
                modified_at: (modified_at_nanos / 1_000_000_000).min(i64::MAX as u128) as i64,
                content,
            };
            total_bytes = total_bytes
                .saturating_sub(old_size)
                .saturating_add(document.content.len() as u64);
            if previous.is_some() {
                result.updated_count += 1;
            } else {
                result.indexed_count += 1;
            }
            validate_entry(&document).map_err(|_| ContentIndexError::Corrupt)?;
            next.insert(entry.id.clone(), Arc::new(document));
        }

        if should_stop() {
            result.cancelled = true;
        }
        if result.cancelled {
            return Ok(result);
        }

        if should_stop() {
            result.cancelled = true;
            return Ok(result);
        }
        result.skipped_reasons = failed_reasons.into_iter().map(str::to_string).collect();
        result.removed_count = existing.keys().filter(|id| !next.contains_key(*id)).count();
        let last_error = (result.skipped_count > 0).then(|| {
            format!(
                "跳过 {} 项：{}",
                result.skipped_count,
                result.skipped_reasons.join("；")
            )
        });
        save_document(
            &path,
            source_revision,
            &next,
            result.skipped_count,
            last_error.clone(),
        )?;
        self.replace_snapshot(ContentIndexSnapshot {
            status: make_status(
                "ready",
                source_revision,
                &next,
                result.skipped_count,
                last_error,
            ),
            documents: Arc::new(next),
        })?;
        Ok(result)
    }
}

pub(super) fn content_size_exceeds_limit(total_bytes: u64, old_size: u64, next_size: u64) -> bool {
    total_bytes
        .saturating_sub(old_size)
        .saturating_add(next_size)
        > MAX_CONTENT_INDEX_BYTES
}

fn is_indexable_entry(entry: &filesystem::IndexEntry) -> bool {
    if entry.invalid {
        return false;
    }
    let Some(info) = filesystem::type_info_for_path(Path::new(&entry.path)) else {
        return false;
    };
    (info.kind == "text" || info.kind == "markdown") && info.kind == entry.kind
}

fn read_content(path: &Path, metadata: &fs::Metadata) -> Result<String, &'static str> {
    if metadata.len() > MAX_CONTENT_FILE_BYTES {
        return Err("超过正文索引单文件上限");
    }
    let mut file = fs::File::open(path).map_err(|_| "无法读取纯文本文件")?;
    if !filesystem::same_file_snapshot(
        metadata,
        &file.metadata().map_err(|_| "无法读取纯文本文件")?,
    ) {
        return Err("纯文本来源已变化，请刷新后重试");
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_CONTENT_FILE_BYTES.saturating_add(1))
        .read_to_end(&mut bytes)
        .map_err(|_| "无法读取纯文本文件")?;
    if bytes.len() as u64 > MAX_CONTENT_FILE_BYTES || bytes.contains(&0) {
        return Err("文件不是可安全读取的纯文本");
    }
    let (_, after) = filesystem::validate_regular_file_path(&path.to_string_lossy())
        .map_err(|_| "纯文本来源已变化，请刷新后重试")?;
    if bytes.len() as u64 != metadata.len()
        || !filesystem::same_file_snapshot(metadata, &after)
        || !filesystem::same_file_snapshot(
            metadata,
            &file.metadata().map_err(|_| "无法读取纯文本文件")?,
        )
    {
        return Err("纯文本来源已变化，请刷新后重试");
    }
    let decoded = preview::text::decode(&bytes).map_err(|_| "文本编码无法可靠识别")?;
    validate_text(bytes.len() as u64, &decoded.value)?;
    Ok(decoded.value)
}

fn remove_document(
    documents: &mut ContentDocuments,
    file_id: &str,
    total_bytes: &mut u64,
    result: &mut ContentSyncResult,
) {
    if let Some(document) = documents.remove(file_id) {
        *total_bytes = total_bytes.saturating_sub(document.content.len() as u64);
        result.removed_count += 1;
    }
}

fn record_failure(
    result: &mut ContentSyncResult,
    reasons: &mut Vec<&'static str>,
    reason: &'static str,
) {
    if reasons.len() < MAX_FAILURE_REASONS && !reasons.contains(&reason) {
        reasons.push(reason);
    }
    result.skipped_count += 1;
}

fn path_error_reason(error: filesystem::PathValidationError) -> &'static str {
    match error {
        filesystem::PathValidationError::Missing => "纯文本文件已失效",
        filesystem::PathValidationError::PermissionDenied => "没有读取纯文本文件的权限",
        filesystem::PathValidationError::Invalid => "纯文本文件路径不可用",
    }
}

fn modified_timestamp_nanos(metadata: &fs::Metadata) -> u128 {
    metadata
        .modified()
        .ok()
        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}
