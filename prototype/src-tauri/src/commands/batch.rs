//! 批量 command 的公共边界说明。
//!
//! 具体批量 mutation 位于 `commands::library`，本模块集中保留取消入口的
//! 模块边界，避免未来把批量状态、逐项结果和普通单条 mutation 混在一起。

use tauri::State;

use super::{BatchState, CommandError};

#[tauri::command]
pub fn cancel_batch_operation(
    operation_id: String,
    state: State<'_, BatchState>,
) -> Result<(), CommandError> {
    super::library::cancel_batch_operation(operation_id, state)
}
