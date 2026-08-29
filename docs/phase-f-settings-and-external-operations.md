# 阶段 F：设置与显式外部操作

更新时间：2026-08-29

本文记录阶段 F 已纳入实现范围的设置模型、Tauri command 契约和安全边界。文件只保存应用配置，不保存用户文档正文、外部程序输出、访问令牌或完整调试日志。

## 1. 设置模型

设置文件位于 Tauri app data 目录的 `settings.json`，与 `index.json` 分开保存。当前设置格式版本为 `1`，写入使用临时文件和原子替换。

持久化 JSON 的结构为：

```json
{
  "version": 1,
  "settings": {
    "defaultSort": {
      "key": "addedAt",
      "direction": "desc"
    },
    "pageSize": 20,
    "confirmBeforeRemove": true
  }
}
```

允许的排序字段为 `addedAt`、`modifiedAt`、`name` 和 `size`；排序方向为 `asc` 或 `desc`；每页数量只允许 `10`、`20` 或 `50`。设置文件缺失时写入安全默认值，损坏、未知版本或非法值不会阻止应用启动，会在内存中回退到默认值，下一次用户保存时再原子替换。

`previewLimits` 只作为 `load_settings` 和 `update_settings` 的响应字段返回，不写入设置文件，也不接受前端更新。它来自 Rust 的统一预览配置，当前为纯文本/Markdown 2 MiB、DOCX/XLSX 20 MiB、PDF 50 MiB、图片 50 MiB 且最多 100 megapixels、视频 512 MiB。前端只能查看这些值，不能通过设置提高上限。

`confirmBeforeRemove` 只控制“从资料库移除索引记录”是否再次弹出确认框。删除原文件仍始终展示影响范围并要求明确确认，符合 `AGENT.md` 的物理文件操作规则。

浏览器/Sites 回退使用同一默认模型，但设置只在当前浏览器会话内生效，不伪装成 Tauri app data 持久化。

## 2. Command 契约

| Command | 输入 | 输出 | 约束 |
| --- | --- | --- | --- |
| `load_settings` | 无 | `AppSettings` | 只返回安全设置和只读预览上限 |
| `update_settings` | `settings.defaultSort`、`settings.pageSize`、`settings.confirmBeforeRemove` | 保存后的 `AppSettings` | Rust 再次校验所有可变字段并原子写入 |
| `open_indexed_file` | `fileId` | `{ name }` | 只允许索引中的普通文件 |
| `reveal_indexed_file` | `fileId` | `{ name }` | 允许索引中的普通文件或文件夹 |

两个外部 command 都从 Rust 的当前索引快照重新取得记录，不接受前端传入任意路径。普通文件会再次进行 canonical 路径、普通文件和符号链接/reparse point 校验；文件夹定位使用相同的目录校验。找不到路径、没有权限、记录不存在或外部程序不可用时返回有限的中文错误，不返回完整路径、命令行或堆栈。

`open_indexed_file` 在 Windows 通过 `ShellExecuteW` 调用系统文件关联；`reveal_indexed_file` 对文件调用系统资源管理器的选择参数，对文件夹直接打开已校验目录。前端没有 shell 能力，也不会拼接或执行任意命令。两个动作只能由资料行中的明确图标按钮触发；预览加载、索引刷新和浏览器回退不会隐式打开外部程序。

对应 capability 权限为：

- `allow-load-settings`
- `allow-update-settings`
- `allow-open-indexed-file`
- `allow-reveal-indexed-file`

## 3. 延后能力决策

### 标签和用户分组

本阶段只完成评估，不写入索引。后续若实现，建议在索引格式版本 3 中增加：

- `tags: string[]`：去重、规范化大小写和长度，标签内容只作为元数据。
- `groupId: string | null`：引用单独的用户分组表，不把分组名称复制到每条记录。
- `groups`：包含稳定 ID、名称、排序位置和创建时间的本地数据集合。

标签和分组需要先确定重命名、删除分组、记录移除和索引迁移的级联规则，再提供单条编辑。当前不提供批量入口，避免在没有撤销和影响范围预览时扩大操作半径。

### 批量收藏和批量移除

延期到单独阶段。实现前必须有选中集合的稳定 ID 快照、数量和受影响记录列表预览、全部成功/部分失败结果、重复点击去重和失败后的可重试策略。批量原文件操作继续禁止沿用此模型。

### 撤销、操作历史和失败恢复

收藏、设置和索引移除可以通过反向元数据操作恢复，但当前不伪装成通用撤销栈。重命名在索引写入失败时已有受限的自动回滚；回滚失败会明确提示人工检查。物理删除只进入 Windows 回收站，应用不保存文件副本、不承诺无条件恢复，也不实现“撤销删除”按钮。后续如增加操作历史，只记录操作类型、记录 ID、旧/新元数据和结果，不记录正文；历史项必须带有效期和清理策略。

## 4. 验收状态

截至 2026-08-29，用户已确认阶段 F 的 Windows 桌面手工验收完成，设置重启恢复、默认程序打开以及文件/文件夹资源管理器定位均通过。阶段 F 当前实现不再有用户验收阻塞；SheetJS、WebView2、LibreOffice、视频编码和安装包签名仍属于既有发布边界风险。
