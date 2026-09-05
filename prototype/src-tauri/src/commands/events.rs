//! IPC 事件契约的集中出口。
//!
//! 事件发送仍由兼容实现负责，但其他 command 只能通过这些显式 re-export
//! 访问，便于后续把 event payload 与 command DTO 分离。

#![allow(unused_imports)]

pub(crate) use super::{
    emit_content_index_status, emit_index_changed, persist_preview_outcome, record_entry_opened,
    schedule_content_index_sync, IndexChangedEvent,
};
