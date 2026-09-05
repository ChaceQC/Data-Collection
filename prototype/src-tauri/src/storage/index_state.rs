//! 索引内存状态和公开快照。
//!
//! 该模块只负责一致快照、revision 和恢复状态的内存表达，不包含 JSON
//! 持久化或单条 mutation，避免把磁盘格式误当成运行时状态模型。

use super::{
    Group, IndexRecoveryStatus, IndexSnapshot, PendingOperation, RecoveryInfo, UndoRecord,
};
use crate::filesystem::IndexEntry;
use std::collections::HashMap;

#[derive(Clone, Debug, Default)]
pub(crate) struct IndexStateData {
    pub(crate) entries: Vec<IndexEntry>,
    pub(crate) groups: Vec<Group>,
    pub(crate) undo_log: Vec<UndoRecord>,
    pub(crate) recovery: Option<RecoveryInfo>,
    pub(crate) pending_operations: Vec<PendingOperation>,
    pub(crate) revision: u64,
    pub(crate) source_revisions: HashMap<String, u64>,
}

impl IndexStateData {
    pub(crate) fn recovery_status(&self) -> Option<IndexRecoveryStatus> {
        if self.recovery.is_none() && self.pending_operations.is_empty() {
            return None;
        }
        Some(IndexRecoveryStatus {
            required: true,
            issue: self
                .recovery
                .as_ref()
                .map(|value| value.issue.clone())
                .unwrap_or_else(|| "删除结果或来源尚待核对。请刷新；仍待核对时检查回收站，再重新定位资料或从资料库移除对应记录".to_string()),
            backup_created: self
                .recovery
                .as_ref()
                .map(|value| value.backup_created)
                .unwrap_or(false),
            pending_operations: self.pending_operations.len(),
            index_blocked: self.recovery.is_some(),
            pending_file_ids: self.pending_operations.iter().map(|operation| operation.file_id.clone()).collect(),
        })
    }

    pub(crate) fn public_snapshot(&self) -> IndexSnapshot {
        let undo = self
            .undo_log
            .last()
            .filter(|record| record.revision == self.revision)
            .map(|record| super::UndoStatus {
                id: record.id.clone(),
                operation: record.operation.clone(),
                count: record.entries.len() + record.groups.len(),
            });
        IndexSnapshot {
            entries: self.entries.clone(),
            groups: self.groups.clone(),
            revision: self.revision,
            recovery: self.recovery_status(),
            undo,
        }
    }
}
