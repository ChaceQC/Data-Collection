//! 索引 JSON 持久化的窄边界。
//!
//! 迁移、备份和原子替换仍由兼容实现执行；本模块提供唯一的领域入口，
//! 让后续拆分不会把磁盘格式逻辑重新散落到 command 或 repository。

#![allow(dead_code, unused_imports)]

use std::path::Path;

use crate::filesystem::IndexEntry;

use super::{Group, StorageError};

#[cfg(test)]
pub(crate) fn load(path: &Path) -> Result<Vec<IndexEntry>, StorageError> {
    super::load_entries(path)
}

#[cfg(test)]
pub(crate) fn save(path: &Path, entries: &[IndexEntry]) -> Result<(), StorageError> {
    super::save_entries(path, entries)
}

pub(crate) fn validate_groups(groups: &[Group]) -> Result<(), StorageError> {
    super::validate_groups(groups)
}
