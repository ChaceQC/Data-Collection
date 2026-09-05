//! 物理文件操作待同步状态的持久化出口。

#![allow(dead_code)]

use std::path::Path;

use super::{PendingOperation, StorageError};

pub(crate) fn load(path: &Path) -> Result<Vec<PendingOperation>, StorageError> {
    super::load_pending_operations(path)
}

pub(crate) fn save(path: &Path, operations: &[PendingOperation]) -> Result<(), StorageError> {
    super::save_pending_operations(path, operations)
}
