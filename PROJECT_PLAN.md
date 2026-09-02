# 本地资料工作台悬浮球“文件库”改造实施计划

> 计划状态：阶段 A 代码候选已完成，Windows 原生验收待用户
> 编制日期：2026-09-02
> 当前工作分支：dev
> 当前发布基线：v0.3.26
> 计划候选版本：v0.3.27 - v0.3.32
> 适用平台：Windows 11 x64、Tauri 2、Rust stable、React 19、Vite 6
> 计划目的：将悬浮球弹窗从“最近记录”改造成可搜索、可筛选、可直接进入主窗口工作的轻量文件库，同时系统性优化悬浮球外观、状态反馈、弹窗布局、文件定位和预览入口。

## 1. 计划替换说明

### 1.1 新计划的职责

- 本文件替换仓库原有的后续阶段计划，旧计划中的阶段 A-J 不再作为后续执行依据。
- 原计划已经完成的功能、版本、验收和发布事实继续以 `PROJECT_PROGRESS.md`、`README.md`、`prototype/README.md` 和 Git 历史为准，不在本文件中重复保留。
- 本轮只规划悬浮球“文件库”改造，不重新规划主窗口已有的索引、预览、托盘、设置、操作中心和正文检索功能。
- 本轮从 `0.3.27` 开始编号，每个阶段都使用完整的 `0.3.x` 版本号，并在该阶段完成代码、最小验证和文档同步后更新版本入口。
- `0.3.32` 是本轮计划的收口版本。若后续仍需修复，必须新增一个明确的 `0.3.x` 阶段或补丁阶段，不直接修改已验收版本的计划结论。

### 1.2 “文件库”的定义

- 悬浮窗主列表展示资料索引中的全部登记条目，而不是只展示最近通过悬浮球拖入的记录。
- 列表包括普通文件、文件夹和路径已失效的条目；失效条目不能静默消失。
- 列表不受当前 `lastRecordedAt` 最近五项限制。`lastRecordedAt` 仍然保留给“最近记录”语义、托盘菜单或其他已有消费者使用。
- `lastOpenedAt` 与 `lastRecordedAt` 继续保持独立含义；“最近打开”可以作为排序项或筛选视图，但不能取代“全部文件库”。
- “文件库”默认理解为应用已经登记的本地资料集合，不等同于资源管理器当前目录，也不直接扫描任意未登记路径。

### 1.3 当前基线

当前实现的关键行为如下：

- `prototype/src/features/floating-ball/FloatingBallPanel.jsx` 使用 `recent` 属性，标题为“最近记录”，每条记录支持打开和收藏。
- `prototype/src/features/floating-ball/useFloatingBallRecords.js` 调用 `get_floating_recent`，并通过 `getRecentEntries` 限制和排序最近记录。
- `prototype/src-tauri/src/commands/floating_ball.rs` 的 `get_floating_recent` 返回 `storage::floating_recent`，后者只保留悬浮球记录过的最近条目。
- 悬浮球窗口当前约为 `64 x 64 DIP`；面板默认约为 `320 x 322 DIP`，现有几何模型已经处理左右展开、边缘吸附、工作区约束和混合 DPI。
- 现有拖放流程会登记路径和元数据，现有收藏动作通过 `set_favorite` 完成，现有 `open_main_from_floating` 通过不透明索引 ID 通知主窗口。
- 现有悬停状态机、拖拽、窗口位置保存、托盘生命周期和浏览器回退演示属于既有能力，本轮应在保持行为兼容的前提下扩展。

### 1.4 本轮必须保持的边界

- 继续采用 local-first 设计，不上传文件、路径、正文、缩略图、日志或使用统计，不增加账号、云同步、在线搜索和遥测。
- 前端只传递不透明索引 ID、受控查询条件和受控相对路径；不把完整本地路径作为普通 UI 数据、事件或日志输出。
- 悬浮窗中的“在资源管理器中显示”只能调用已有的受控索引 ID command，不能让前端拼接任意系统命令或任意路径。
- 文件点击、文件夹点击、预览和资源管理器定位都必须通过主窗口或已有 Rust command 完成，不能在悬浮窗中绕过 Tauri 权限直接读取本地文件。
- 默认不在悬浮窗中提供删除原文件、重命名原文件、复制原文件等高影响操作；这些操作继续交给主窗口的明确操作和确认流程。
- 不以浏览器回退模式代替 Windows 11/Tauri 原生验收。浏览器只验证布局、前端状态和无真实文件副作用的演示流程。

## 2. 目标、非目标和完成标准

### 2.1 目标

- 弹窗打开后首先看到“文件库”列表，能够浏览全部登记资料。
- 用户可以在小尺寸窗口内快速搜索、筛选、排序和滚动文件列表。
- 用户点击文件后，主窗口显示并获得焦点，定位到对应资料；支持预览的文件可以直接进入主窗口预览。
- 用户点击文件夹后，主窗口显示并进入对应目录视图。
- 用户可以从文件行进入“在资源管理器中显示”操作。
- 用户可以继续把文件或文件夹拖到悬浮球，拖放结果会反馈并刷新文件库，不改变文件库的主排序语义。
- 悬浮球能够用外观清楚表达普通、悬停、拖入、记录中、成功和失败状态，且不使用持续干扰性的动画。
- 索引、收藏、主窗口操作和悬浮窗之间通过 revision/event 保持一致，不因旧请求返回而覆盖新列表。
- 面板在四边、四角、混合 DPI、多显示器和窄工作区下仍能展开、收起、滚动和点击。

### 2.2 非目标

- 不把悬浮窗改造成完整的主窗口替代品。
- 不在悬浮窗内实现完整的多选、批量删除、批量重命名或批量物理文件操作。
- 不取消或重定义托盘“最近记录”功能；本轮只改变悬浮球弹窗的主展示内容。
- 不新增索引持久化格式版本，除非后续确实需要保存悬浮窗的筛选、排序或尺寸设置；若需要，必须单独记录迁移、备份和回滚策略。
- 不引入全局快捷键、后台服务、启动项、网络服务或新的系统运行时依赖。

### 2.3 端到端完成标准

只有同时满足以下条件，才可以把本轮标记为完成：

- 弹窗标题、空状态、计数和列表内容不再以“最近记录”作为主语义。
- 列表能够展示超过五项的索引资料，并且滚动、搜索、筛选和排序结果正确。
- 点击文件能够打开主窗口并定位到该文件；支持格式能够直接进入预览。
- 点击文件夹能够打开主窗口对应目录；文件和文件夹都能执行资源管理器定位。
- 拖放新增、重复、跳过、失效、收藏变更和主窗口索引变更都能同步到悬浮窗。
- 球体和面板视觉状态在浏览器检查和 Windows 11 原生检查中都没有遮挡、跳动、无法点击或焦点丢失问题。
- 相关前端模型、IPC 契约、Rust command、构建和必要的 Windows 原生验收证据完整记录。

## 3. 目标交互和视觉规格

### 3.1 悬浮球外观

悬浮球继续保持桌面工具的克制风格，强调识别、状态和拖放目标，不做大面积装饰：

- 保持约 `64 x 64 DIP` 的固定球体尺寸，保证拖拽和触控命中区域稳定。
- 普通状态使用文件堆、资料库或文件夹类图标，避免仅使用容易被理解为“归档”的图标。
- 右下角增加轻量文件数量徽标；数字为当前文件库条目数，超过两位数使用 `99+`，读取失败时隐藏徽标而不是显示错误数字。
- 普通状态使用现有绿色主色，悬停可增加轻微外环和阴影，不持续放大，不持续闪烁。
- 拖入状态切换为蓝色或蓝绿色，并使用加号、文件落入或明显外环表达可放置状态。
- 记录中显示受控的旋转指示或短暂呼吸效果；成功后短暂显示勾，失败后显示错误标记。
- 状态动画只服务于状态变化，必须支持 `prefers-reduced-motion`，不能影响窗口拖拽、点击和边缘吸附。
- 保留键盘焦点可见样式；焦点环不能被球体阴影或窗口裁切。
- 悬浮球的 `aria-label`、`title` 和屏幕阅读器文本随状态变化，但不能泄露完整文件路径。

### 3.2 文件库面板布局

面板以“标题 + 工具条 + 列表 + 状态反馈”为固定结构，建议默认尺寸约为 `360 x 420 DIP`，具体值由窄工作区几何模型约束：

- 标题区：产品名称、标题“文件库”、总数量、关闭按钮。
- 搜索区：文件名和元数据搜索输入框，带清空操作；打开面板时不因悬停自动抢走输入焦点。
- 筛选区：使用紧凑的分段控制，至少提供“全部、收藏、文件夹、失效”。
- 列表区：固定行高、内部滚动、加载骨架、空结果和错误重试状态。
- 反馈区：显示导入数量、跳过原因、同步中或失败信息；反馈出现和消失不能改变列表主体高度。
- 关闭按钮继续支持鼠标、键盘和 `Escape`；关闭后焦点回到悬浮球。
- 面板与球体保持连续的交互区域，鼠标从球体移动到面板时不因短暂离开而误收起。
- 面板左右方向继续由可用空间决定；上下位置必须在当前工作区内约束，不能遮挡屏幕边界外的重要内容。

### 3.3 文件行结构

每一行保持稳定尺寸，避免文件名、状态或图标加载导致列表跳动：

- 左侧显示文件或文件夹类型图标。
- 主文本显示名称，单行省略并通过 `title` 或可访问名称提供完整显示名。
- 次文本显示类型、大小、所属分组或父目录摘要；文件夹不显示无意义的文件大小。
- 失效条目显示明确的失效状态；失效条目的打开和预览动作不可执行，但仍可进入主窗口重新定位流程。
- 收藏按钮独立存在，支持悬停、键盘焦点、忙碌和失败状态。
- 预览入口使用预览图标；只对支持预览的文件启用，或允许点击后进入主窗口并显示统一的“不支持预览”状态。
- “在资源管理器中显示”使用独立的定位图标或行操作菜单，不与打开主窗口动作混淆。
- 文件名或主行点击是主要工作流入口，不能要求用户先打开一个难以发现的菜单。

### 3.4 四个必须提供的快捷工作流

以下四项是硬性验收要求，不得只写在设计说明中：

1. 点击文件直接打开主窗口并定位到该文件。主窗口需要显示、获得焦点、选中对应条目，并滚动或切换到能够看见该条目的列表上下文。
2. 点击文件夹后打开主窗口对应目录。主窗口需要进入该索引文件夹的目录视图，显示目录面包屑和可浏览的子项。
3. 增加“在资源管理器中显示”快捷操作。该操作只能使用登记条目的安全 ID，文件或文件夹路径失效时显示可执行错误和重新定位入口。
4. 增加直接预览入口。支持预览的文件从悬浮窗触发后，主窗口直接打开并进入对应预览会话；不支持、损坏、权限不足或文件过大的情况使用主窗口已有的明确错误状态和下一步动作。

点击文件的默认行为应优先保证“主窗口显示、定位和焦点”成立；直接预览可以作为行内图标或操作菜单入口。若产品最终决定点击文件同时自动预览，必须保留可验证的定位状态，不能只切换到预览而让用户失去当前列表位置。

### 3.5 键盘、焦点和无障碍

- 悬浮球支持 `Enter`、`Space` 打开或收起，`Escape` 收起，现有拖拽快捷行为保持不变。
- 面板打开后，鼠标悬停展开不自动抢焦点；键盘打开或用户点击搜索框时才进入面板交互。
- 搜索框支持清空；列表支持 `ArrowUp`、`ArrowDown`、`Home`、`End` 和 `Enter`。
- `Enter` 在文件行上执行主工作流，在预览按钮、收藏按钮和资源管理器按钮上执行对应动作，不触发行点击两次。
- `Escape` 按层级关闭操作菜单、清除临时焦点状态并最终收起面板。
- 弹窗关闭后焦点返回关闭按钮的触发点或悬浮球；失败时焦点不能跳到不可见元素。
- 图标按钮必须有可访问名称和 tooltip；状态提示使用 `aria-live`，但不重复播报同一结果。
- `prefers-reduced-motion` 下不依赖动画传达成功、失败或拖放状态。

## 4. 数据、IPC 和状态架构

### 4.1 推荐的数据方向

新增独立的文件库查询 command，不直接把 `get_floating_recent` 改造成全量文件接口：

```text
悬浮球面板
  -> useFloatingBallFiles
  -> floatingBallApi.getFloatingFiles
  -> get_floating_files
  -> 索引快照和受控元数据投影
```

原因如下：

- `get_floating_recent` 已被托盘和最近记录语义使用，直接改变会造成跨功能行为漂移。
- 文件库需要搜索、筛选、排序、分页和总数，和最近五项不是同一个返回契约。
- 新 command 可以只返回悬浮窗需要的字段，不暴露完整路径，也避免每次搜索都传输主窗口完整索引和正文数据。
- revision 可以明确绑定查询结果，避免旧请求覆盖新列表。

### 4.2 `get_floating_files` 请求契约

建议请求字段如下，具体命名以实现时的 IPC 约定为准：

```text
{
  query: string,
  filter: "all" | "favorite" | "folder" | "invalid",
  sortKey: "name" | "type" | "modifiedAt" | "lastOpenedAt",
  direction: "asc" | "desc",
  offset: number,
  limit: number
}
```

约束要求：

- `query` 长度有上限，按名称、类型、标签和必要的分组元数据搜索，不搜索正文。
- `filter` 和 `sortKey` 只能使用白名单枚举，不能接收任意字段名或表达式。
- `offset` 和 `limit` 必须是安全的非负整数，`limit` 设置硬上限，防止一次返回异常大的列表。
- 默认排序使用名称升序，确保“文件库”首先表现为完整、稳定的文件列表；“最近打开”只是可选排序。
- 搜索和排序不改变索引持久化内容，不写入用户文件目录。

### 4.3 `get_floating_files` 返回契约

建议返回字段如下：

```text
{
  revision: number,
  items: [
    {
      id: string,
      name: string,
      type: string,
      kind: "file" | "folder" | other,
      status: string,
      invalid: boolean,
      favorite: boolean,
      size: number | null,
      modifiedAt: number | null,
      lastOpenedAt: number | null,
      groupId: string | null,
      groupName: string | null
    }
  ],
  total: number,
  offset: number,
  limit: number,
  hasMore: boolean
}
```

- 返回中不包含完整文件路径、正文、缩略图、命令行或外部程序输出。
- 文件夹的 `size` 使用 `null` 或统一空值语义，不显示为误导性的 `0`。
- `invalid` 条目仍返回 `id`、名称和必要的状态字段，供主窗口重新定位。
- 后端排序和分页结果必须稳定；同一排序值使用 `id` 作为确定性次排序键。
- 若第一版选择一次加载全部条目，也必须保留 `revision` 和受控数量上限，并在索引规模达到边界前切换到分页；不能让 UI 永久依赖无上限全量返回。

### 4.4 既有接口兼容策略

- `get_floating_recent` 保持原有最近记录语义，继续服务托盘或其他已有消费者。
- `record_floating_paths` 可以继续返回最近记录字段以兼容现有调用方；悬浮窗收到记录结果后，重新请求文件库列表，不把返回的 `recent` 当作主列表。
- `open_main_from_floating(fileId)` 继续使用不透明 ID，并扩展主窗口事件处理，使其能够区分文件与文件夹。
- “在资源管理器中显示”优先复用已有 `reveal_indexed_file(fileId)` command；若现有返回状态不足，再补充受控错误类型，不新增前端任意路径能力。
- 直接预览优先复用主窗口已有预览入口、`floating-open-file` 事件和预览会话管理；不能在悬浮窗中复制一套预览加载器。
- 收藏动作继续复用 `set_favorite`，成功后只更新受影响条目并等待 revision 事件校正列表。

### 4.5 事件和并发规则

- `index-changed` 到达时，若事件 revision 不大于当前 revision，则丢弃；否则刷新当前查询上下文。
- 搜索词、筛选、排序或分页改变时生成查询序号；旧查询完成后不能覆盖新查询。
- 拖放记录进行中时，列表显示记录中状态；记录完成后刷新文件库并显示新增、刷新、跳过和截断结果。
- 多次快速拖放继续使用现有去重队列，不能因为文件库刷新而重复登记路径。
- 收藏、主窗口重命名、重新定位、索引移除和最近打开事件到达后，列表要保留当前查询条件并更新可见条目。
- 面板关闭不取消已经提交的索引写入，但可以取消尚未开始的查询或丢弃过期查询结果。

## 5. 阶段总表

| 阶段 | 目标版本 | 主题 | 交付重点 | 状态 |
| --- | --- | --- | --- | --- |
| A | 0.3.27 | 文件库数据契约 | 新查询 command、返回投影、IPC 校验、文件库模型 | 代码、自动验证和 NSIS 候选已完成；Windows 原生验收待用户 |
| B | 0.3.28 | 悬浮球外观和面板骨架 | 球体状态视觉、数量徽标、文件库标题、面板尺寸和稳定布局 | 待开始 |
| C | 0.3.29 | 文件列表交互 | 全量列表、搜索、筛选、排序、分页、加载和空状态 | 待开始 |
| D | 0.3.30 | 主窗口连续工作流 | 文件定位、文件夹目录、资源管理器显示和直接预览 | 待开始 |
| E | 0.3.31 | 同步和稳定性 | 拖放反馈、revision 同步、竞态、混合 DPI、窄窗口和性能 | 待开始 |
| F | 0.3.32 | 完整验收和候选发布 | 文档收口、自动验证、Windows 11 验收、安装包候选 | 待开始 |

每个阶段必须先完成代码和最小验证，再更新该阶段版本；不能先把所有版本入口统一改成 `0.3.32`。

## 6. 阶段 A：文件库数据契约和查询模型（0.3.27）

### 6.1 目标

建立与“最近记录”分离的文件库数据来源，确保悬浮窗可以取得全部登记条目，并为后续搜索、筛选、排序、分页和同步提供稳定契约。

### 6.2 主要文件

- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/repository.rs`
- `prototype/src/lib/ipcContracts.js`
- `prototype/src/lib/ipcContracts.d.ts`
- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/floatingLibraryModel.js`（如需要，新增）
- `prototype/src-tauri/capabilities/` 或自动生成权限声明（仅在 command 需要时）
- `prototype/tests/floating-ball-model.test.mjs`
- `prototype/tests/floating-library-model.test.mjs`（新增）
- `prototype/tests/ipc-contracts.test.mjs`
- `prototype/tests/floating-ball-contracts.test.mjs`（新增或并入既有契约测试）

### 6.3 实现清单

- [x] 定义 `get_floating_files` 的请求、返回和错误契约。
- [x] 从索引快照投影悬浮窗需要的安全元数据，不返回完整路径和正文。
- [x] 默认返回全部索引条目，不应用 `lastRecordedAt` 最近五项限制。
- [x] 保留文件夹和失效条目，并对不存在或无效字段使用明确状态。
- [x] 实现白名单筛选、稳定排序、数量统计和分页边界。
- [x] 增加前端 IPC 解析器，拒绝缺少 revision、items、total 或错误类型字段的返回值。
- [x] 增加纯模型函数，覆盖搜索匹配、筛选、排序、分页、重复 ID 和空列表。
- [x] 继续保留并测试 `get_floating_recent`，证明本轮没有破坏最近记录消费者。
- [x] 评估 Tauri 权限声明；只增加实际需要的 command 权限。

### 6.4 验证

- [x] 一个索引包含超过五项时，文件库结果不被截断到五项。
- [x] 只被主窗口导入、从未通过悬浮球拖入的条目也能出现在文件库。
- [x] 文件夹、失效文件、收藏文件和普通文件的字段投影稳定。
- [x] 搜索、筛选、排序和分页不会返回重复 ID 或越过数量边界。
- [x] 不合法 query、filter、sort、offset、limit 和 IPC 返回值都会被拒绝。
- [x] 运行 `npm.cmd run test:contracts`。
- [x] 运行新增文件库模型测试和 `npm.cmd run test:floating-ball`。
- [x] 在 Rust 侧运行与 command/storage 相关的最小 `cargo test` 和 `cargo check`。

### 6.5 阶段版本门禁

- [x] 更新 `prototype/package.json`、`prototype/package-lock.json` 根包、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml` 和 `prototype/src-tauri/Cargo.lock` 的版本入口到 `0.3.27`。
- [x] 在 `PROJECT_PROGRESS.md` 记录数据契约、测试结果、未完成的 Windows 原生验收和阶段 B 入口。
- [x] 执行 `git diff --check`、检查工作树范围并提交阶段变更。

## 7. 阶段 B：悬浮球外观和文件库面板骨架（0.3.28）

### 7.1 目标

在不破坏现有透明窗口、拖拽、边缘吸附和悬停状态机的前提下，完成悬浮球外观升级和文件库面板的稳定骨架，为后续列表交互提供固定布局。

### 7.2 主要文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/floatingBallGeometryModel.js`
- `prototype/src/features/floating-ball/useFloatingBallWindowGeometry.js`
- `prototype/src/styles.css`
- `prototype/src/main.jsx`
- `prototype/tests/floating-ball-model.test.mjs`
- `prototype/tests/floating-ball-hover.test.mjs`
- 新增必要的浏览器检查或组件状态测试

### 7.3 实现清单：球体外观

- [ ] 将普通状态图标调整为文件库/文件堆语义，保留现有图标库，不手写重复 SVG。
- [ ] 增加当前文件库数量徽标，数量加载中、读取失败、超过上限时分别有稳定表现。
- [ ] 设计普通、悬停、拖入、记录中、记录成功、部分成功和失败状态的颜色、图标和外环。
- [ ] 成功和失败标记不遮挡球体主图标，且在窗口边缘、缩放和混合 DPI 下仍在球体范围内。
- [ ] 控制动画时长和触发频率，加入 `prefers-reduced-motion` 降级。
- [ ] 保证 `64 x 64 DIP` 命中区域、拖拽手势、键盘焦点和 tooltip 不发生回归。

### 7.4 实现清单：面板骨架

- [ ] 将标题从“最近记录”改为“文件库”或“全部资料”，移除 `recent` 语义命名。
- [ ] 将数量显示从 `n / 5` 改为总条目数，并处理加载中和读取失败状态。
- [ ] 将默认面板尺寸调整为约 `360 x 420 DIP`，由几何模型在窄工作区中压缩到安全最小值。
- [ ] 增加标题区、搜索区、筛选区、列表占位区和反馈区的固定结构。
- [ ] 为列表行定义稳定的最小高度、图标尺寸、文本截断和右侧动作空间。
- [ ] 增加加载骨架、空列表、空搜索结果和查询错误的视觉占位，不依赖内容高度改变窗口尺寸。
- [ ] 保持面板左右方向、球体锚点和窗口工作区约束不变。
- [ ] 为文件库面板建立独立 class 命名，避免把主窗口表格样式直接复制进悬浮窗。

### 7.5 验证

- [ ] 在普通、悬停、拖入、记录中、成功和失败状态下检查图标、颜色、徽标和提示一致。
- [ ] 浏览器演示模式能显示文件库标题、数量徽标、固定行骨架和空状态。
- [ ] 在 1280px、680px、360px 视口检查面板不溢出、文本不遮挡、列表仍可滚动。
- [ ] 检查左侧和右侧展开、四角位置、工作区不足时的面板压缩。
- [ ] 运行 `npm.cmd run test:floating-ball` 和 `npm.cmd run build`。
- [ ] 运行几何模型、悬停状态机和窗口尺寸相关的最小 Rust/前端检查。

### 7.6 阶段版本门禁

- [ ] 同步五个版本入口到 `0.3.28`。
- [ ] 在 `PROJECT_PROGRESS.md` 记录外观、面板尺寸、浏览器截图检查和待进行的 Windows 原生窗口验收。
- [ ] 执行 `git diff --check`，确认没有加入构建产物、截图临时文件或真实资料。
- [ ] 提交阶段变更后进入阶段 C。

## 8. 阶段 C：文件列表、搜索、筛选和排序（0.3.29）

### 8.1 目标

将文件库面板从骨架变成可日常使用的索引列表，确保用户看到的是完整文件集合，而不是最近拖入历史。

### 8.2 主要文件

- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`（新增或从 records hook 拆分）
- `prototype/src/features/floating-ball/useFloatingBallRecords.js`
- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/src/features/floating-ball/floatingLibraryModel.js`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/styles.css`
- `prototype/src/lib/ipcContracts.js`
- `prototype/src/lib/ipcContracts.d.ts`
- `prototype/tests/floating-library-model.test.mjs`
- `prototype/tests/floating-library-overlay.test.mjs`（新增或并入现有 UI 检查）
- `prototype/tests/floating-ball-model.test.mjs`

### 8.3 实现清单

- [ ] 将面板主数据从 `recent` 调整为 `files` 或等价文件库语义，禁止继续通过 `getRecentEntries` 限制主列表。
- [ ] 初次打开面板时读取文件库，显示加载中、成功、空列表、无搜索结果和错误重试状态。
- [ ] 实现文件名和元数据搜索；查询输入采用受控长度，必要时增加轻量 debounce。
- [ ] 实现“全部、收藏、文件夹、失效”筛选，并显示当前筛选状态。
- [ ] 实现名称、类型、修改时间和最近打开时间排序，默认名称升序。
- [ ] 实现受控分页或增量加载；列表内部滚动，不能把主窗口滚动条带入悬浮窗。
- [ ] 显示文件/文件夹图标、名称、类型、大小、分组摘要和失效状态。
- [ ] 收藏按钮保留现有行为，收藏更新后不清除搜索、筛选、排序和滚动上下文。
- [ ] 空列表提供打开主窗口资料库或导入入口；空搜索结果提供清除搜索入口。
- [ ] 浏览器回退使用多条无敏感信息的演示文件项，覆盖文件、文件夹、收藏、失效和长文件名。
- [ ] 拖放成功后刷新当前文件库；新条目若不符合当前筛选，不强行插入当前视图。

### 8.4 验证

- [ ] 1、5、6、50 和超过分页上限的文件条目都能显示并正确滚动。
- [ ] 主窗口导入的文件会出现在悬浮窗文件库，不要求再次拖到悬浮球。
- [ ] 最近没有拖放记录但索引已有资料时，文件库仍然有内容。
- [ ] 搜索、清空、切换筛选、切换排序、翻页和刷新后的列表、数量和空状态一致。
- [ ] 长中文文件名、空格文件名、同名文件、文件夹和失效路径不会导致布局横向溢出。
- [ ] 收藏成功、收藏失败和收藏忙碌时，按钮状态、提示和列表内容一致。
- [ ] 运行 `npm.cmd run test:floating-ball`、新增文件库模型测试和 `npm.cmd run test:contracts`。
- [ ] 运行 `npm.cmd run build`，确认 Sites 产物仍然生成。

### 8.5 阶段版本门禁

- [ ] 同步五个版本入口到 `0.3.29`。
- [ ] 在 `PROJECT_PROGRESS.md` 记录文件库列表、搜索、筛选、排序和分页验证结果。
- [ ] 同步 `README.md` 和 `prototype/README.md` 中关于悬浮球“最近记录”的描述，明确区分当前已实现和下一阶段未完成的快捷操作。
- [ ] 提交阶段变更后进入阶段 D。

## 9. 阶段 D：主窗口连续工作流和四项快捷操作（0.3.30）

### 9.1 目标

让悬浮窗成为主窗口的快速入口。用户不需要先打开主窗口再重新搜索，就能完成文件定位、文件夹进入、资源管理器显示和直接预览。

### 9.2 主要文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`
- `prototype/src/App.jsx`
- `prototype/src/features/library/useLibraryNavigation.js`
- `prototype/src/features/library/useIndexController.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/libraryRepository.js`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/lib/ipcContracts.js`
- `prototype/src/lib/ipcContracts.d.ts`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src/styles.css`
- `prototype/tests/floating-library-actions.test.mjs`（新增）
- `prototype/tests/library-controller.test.mjs`
- `prototype/tests/ipc-contracts.test.mjs`
- 相关预览和主窗口事件测试

### 9.3 实现清单：点击文件和文件夹

- [ ] 文件行主点击调用 `open_main_from_floating(fileId)`，主窗口显示、获得焦点并接收 `floating-open-file` 事件。
- [ ] 主窗口收到文件 ID 后，切换到包含该条目的有效列表上下文，保留搜索/目录边界的可解释行为。
- [ ] 主窗口选中对应文件并滚动到可见位置，确保“定位到该文件”不是只打开一个不可见的预览层。
- [ ] 点击文件夹后，主窗口进入该索引文件夹的目录视图，更新面包屑并显示目录子项。
- [ ] 文件夹不存在、权限不足或路径失效时，不进入空目录；显示主窗口已有的失效/重新定位状态。
- [ ] 文件和文件夹的点击行为使用同一个安全 ID 入口，由主窗口根据索引条目的 `kind` 区分处理。
- [ ] 操作成功后悬浮面板按既有交互规则收起或保持可解释状态，不能留下失焦的透明窗口。

### 9.4 实现清单：资源管理器显示

- [ ] 文件行增加“在资源管理器中显示”图标或操作菜单项，提供明确的 tooltip 和可访问名称。
- [ ] 操作调用已有 `reveal_indexed_file(fileId)` 或等价安全 command，不向前端暴露任意路径拼接能力。
- [ ] 文件和文件夹都覆盖资源管理器定位；文件夹定位到文件夹本身，文件定位到文件或其父目录的既有约定。
- [ ] 路径失效、权限拒绝、资源管理器启动失败时显示明确错误，并提供返回主窗口或重新定位入口。
- [ ] 快捷操作的点击事件阻止行点击冒泡，避免同时触发预览、定位和资源管理器三个动作。
- [ ] 该操作保持外部程序启动边界：只在用户明确点击时执行，不在悬浮窗打开或刷新时静默启动资源管理器。

### 9.5 实现清单：直接预览

- [ ] 文件行增加直接预览入口，支持 `.md`、`.txt`、图片、视频、`.docx`、`.xlsx`、`.doc`、`.pdf` 等已有登记格式。
- [ ] 直接预览入口通过主窗口已有预览会话和资源协议启动，不在悬浮窗复制格式判断、文件读取或渲染实现。
- [ ] 支持预览的文件从悬浮窗触发后，主窗口显示、获得焦点、定位条目并进入 `loading` 到 `ready` 的预览流程。
- [ ] 不支持、损坏、加密、过大、权限不足、缺少 DOC 转换器和路径失效的情况使用已有明确状态，不显示空白预览。
- [ ] 预览入口在不支持时可以打开主窗口并显示错误详情和默认程序打开/资源管理器定位等下一步，不直接静默失败。
- [ ] 预览打开后继续支持关闭、相邻浏览、收藏、重试和资源释放，悬浮窗关闭不能泄露 preview resource。
- [ ] 若文件行主点击也自动预览，必须与直接预览入口使用同一事件和状态模型，避免两套行为不一致。

### 9.6 验证

- [ ] 点击普通文件后，主窗口显示、聚焦、选中并定位到该文件。
- [ ] 点击文件夹后，主窗口进入对应目录，面包屑和子项列表正确。
- [ ] 点击“在资源管理器中显示”后，只启动一次资源管理器，不触发行点击或预览。
- [ ] 通过直接预览入口打开正常文本、Markdown、图片、XLSX、DOCX 和 PDF 测试夹具，主窗口进入对应预览。
- [ ] 通过直接预览入口检查不支持、损坏、失效和缺少转换器状态，确认错误可诊断且资源被释放。
- [ ] 快速连续点击不同文件时，旧的打开/预览结果不能覆盖新选中项。
- [ ] 运行 `npm.cmd run test:preview`、`npm.cmd run test:contracts`、`npm.cmd run test:library` 和新增快捷操作模型测试。
- [ ] Rust 侧运行 `cargo fmt --check`、`cargo check` 和相关 `cargo test`。

### 9.7 阶段版本门禁

- [ ] 同步五个版本入口到 `0.3.30`。
- [ ] 在 `PROJECT_PROGRESS.md` 逐条记录四项快捷工作流的自动验证和 Windows 原生验收状态。
- [ ] 同步 README 中悬浮球能力描述，不能把浏览器回退或模型测试写成真实资源管理器/预览验收。
- [ ] 提交阶段变更后进入阶段 E。

## 10. 阶段 E：同步、拖放反馈、性能和窗口稳定性（0.3.31）

### 10.1 目标

处理文件库化之后的真实使用边界：索引变化、收藏变化、拖放记录、快速查询、旧请求竞态、混合 DPI、多显示器和窄工作区。

### 10.2 主要文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`
- `prototype/src/features/floating-ball/useFloatingBallRecords.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/floatingBallHoverController.js`
- `prototype/src/features/floating-ball/floatingBallGeometryModel.js`
- `prototype/src/features/floating-ball/useFloatingBallWindowGeometry.js`
- `prototype/src/features/floating-ball/useFloatingBallDrag.js`
- `prototype/src/styles.css`
- `prototype/src-tauri/src/windows/monitor.rs`
- `prototype/src-tauri/src/windows/floating_ball.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/tests/floating-ball-*.test.mjs`
- `prototype/tests/keyboard-model.test.mjs`
- `prototype/tests/library-controller.test.mjs`

### 10.3 实现清单

- [ ] `index-changed`、`floating-recorded`、收藏变化、重命名、重新定位和索引移除都能刷新文件库当前上下文。
- [ ] 刷新时保留搜索词、筛选、排序、当前页和可解释的滚动位置；当前条目消失时显示空状态而不是旧内容。
- [ ] 使用 revision 和查询序号丢弃过期返回，覆盖快速搜索、快速切换筛选、连续收藏和拖放期间刷新。
- [ ] 拖入悬浮球时球体和面板都显示明确拖入态；记录中禁止重复提交同一路径，完成后只显示结果反馈并刷新文件库。
- [ ] 反馈信息区分新增、刷新、跳过、达到上限、失败和路径失效，不把“最近记录”重新渲染成主列表。
- [ ] 对大索引使用分页或增量加载，搜索输入不触发无节制的全量 command 调用。
- [ ] 面板打开和关闭时不产生明显跳动；几何尺寸改变不能导致球体锚点漂移。
- [ ] 检查左、右、上、下边缘以及四角的面板方向、工作区约束、阴影和点击区域。
- [ ] 检查不同 DPI 和多显示器切换下球体位置、面板尺寸、徽标和成功/失败标记。
- [ ] 关闭主窗口、退出应用、隐藏到托盘、销毁悬浮球时清理监听器、定时器、未完成查询和预览资源引用。
- [ ] 使用 `prefers-reduced-motion` 检查动画降级和状态文本仍然完整。

### 10.4 验证

- [ ] 主窗口新增文件、移除索引、收藏、重命名和重新定位后，悬浮窗列表最终一致。
- [ ] 连续输入搜索词并快速清空时，最终列表只对应最后一次查询。
- [ ] 连续拖入相同和不同路径时，索引写入不重复，文件库刷新不丢条目。
- [ ] 在面板打开、关闭、拖动、边缘吸附、拖入和文件打开之间切换，悬停状态机没有卡在 `opening`、`closing` 或 `dragging`。
- [ ] 在小工作区中面板能压缩到安全最小值，列表仍可滚动，操作按钮不会被裁切。
- [ ] 运行 `npm.cmd run test:floating-ball`、`npm.cmd run test:library`、`npm.cmd run test:contracts` 和 `npm.cmd run build`。
- [ ] Rust 侧运行 `cargo fmt --check`、`cargo check`、`cargo test` 和必要的 `cargo clippy --all-targets --all-features -- -D warnings`。
- [ ] 使用 Playwright 或等价浏览器检查记录桌面/移动视口截图和核心交互；截图只使用测试演示数据。

### 10.5 阶段版本门禁

- [ ] 同步五个版本入口到 `0.3.31`。
- [ ] 在 `PROJECT_PROGRESS.md` 记录并发、同步、窗口几何、拖放和性能验证结果。
- [ ] 明确列出仍需用户在 Windows 11 桌面端验证的项目，不以浏览器结果代替原生验收。
- [ ] 提交阶段变更后进入阶段 F。

## 11. 阶段 F：完整验收、文档收口和候选发布（0.3.32）

### 11.1 目标

完成端到端回归、文档同步、候选版本验证和 Windows 11 原生验收准备，形成可发布的 `v0.3.32` 候选，但不在未获授权时执行远程推送或 GitHub Release。

### 11.2 主要文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- `README.md`
- `prototype/README.md`
- `prototype/src/features/floating-ball/`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/windows/`
- `prototype/src-tauri/src/storage/`
- `prototype/tests/`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`

### 11.3 文档收口清单

- [ ] `README.md` 和 `prototype/README.md` 将悬浮球主功能描述为“文件库”，明确写出文件列表、搜索、筛选、文件定位、文件夹目录、资源管理器显示和直接预览。
- [ ] 文档单独说明“最近记录”仍属于保留的历史/托盘语义，不再是悬浮球弹窗主列表。
- [ ] 文档区分自动化验证、浏览器回退检查和 Windows 11/Tauri/WebView2 原生验收。
- [ ] 文档说明支持预览格式、失效路径、外部程序和 LibreOffice 等既有依赖边界，不扩大“已支持”声明。
- [ ] `PROJECT_PROGRESS.md` 记录每个阶段的版本、主要文件、验证命令、候选安装包和未完成的用户验收。
- [ ] 若新增 IPC command、权限或数据结构，记录接口兼容性和安全边界。

### 11.4 自动验证清单

- [ ] 运行 `npm.cmd run test:floating-ball`。
- [ ] 运行 `npm.cmd run test:library`。
- [ ] 运行 `npm.cmd run test:contracts`。
- [ ] 运行 `npm.cmd run test:preview`。
- [ ] 运行 `npm.cmd run test:settings`、`npm.cmd run test:operations` 和必要的 `npm.cmd run test:content`。
- [ ] 运行 `npm.cmd run build`。
- [ ] 在 `prototype/src-tauri` 运行 `cargo fmt --check`、`cargo check`、`cargo check --tests`、`cargo test`。
- [ ] 适用时运行 `cargo clippy --all-targets --all-features -- -D warnings`。
- [ ] 运行 `git diff --check`，确认版本入口、文档和代码没有编码或空白错误。

### 11.5 Windows 11 原生验收清单

以下项目必须在真实 Windows 11/Tauri 环境中验证，不能用浏览器回退模式替代：

- [ ] 应用启动后悬浮球显示、置顶、透明背景和位置恢复正常。
- [ ] 悬停展开、点击展开、从球体移动到面板、延迟收起和 `Escape` 行为正常。
- [ ] 球体拖拽、边缘吸附、四角展开、面板方向和多显示器切换正常。
- [ ] 混合 DPI 下球体大小、面板尺寸、数量徽标、成功/失败标记和点击区域正确。
- [ ] 从资源管理器拖入文件和文件夹，记录结果、跳过原因和文件库刷新正确。
- [ ] 文件库展示超过五项资料；搜索、筛选、排序和滚动不丢失条目。
- [ ] 点击文件能够打开主窗口并定位到该文件。
- [ ] 点击文件夹能够打开主窗口对应目录。
- [ ] “在资源管理器中显示”能够定位文件和文件夹；失效路径显示正确错误。
- [ ] 直接预览至少覆盖一个文本/Markdown、一个图片、一个 Office 文件和一个 PDF 流程；失败状态可恢复。
- [ ] 主窗口导入、收藏、移除、重命名、重新定位后悬浮窗最终同步。
- [ ] 隐藏到托盘、显示/隐藏悬浮球、主窗口关闭和真正退出时生命周期清理正常。
- [ ] 重启应用后文件库、收藏、失效状态和悬浮球位置符合持久化约定。

### 11.6 候选版本门禁

- [ ] 同步五个版本入口到 `0.3.32`，确认所有版本一致。
- [ ] 若用户要求安装包，运行 `npm.cmd run tauri:build` 并运行 `npm.cmd run verify:loader`，记录 NSIS 安装包路径、架构和校验信息。
- [ ] 安装包验证必须单独记录安装、首次启动、升级、卸载、托盘和悬浮球行为，不能只记录构建成功。
- [ ] 未经用户明确要求，不执行 `git push`、创建 tag、发布 GitHub Release 或修改远程仓库。
- [ ] `v0.3.32` 只有在用户确认 Windows 11 原生验收后才可以标记为正式发布；自动测试通过只能标记为候选。

## 12. 版本、分支和提交规则

### 12.1 版本入口

每个阶段版本更新时，以下五个入口必须保持一致：

- `prototype/package.json`
- `prototype/package-lock.json` 的根包版本
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock` 的本地 package 版本

版本更新顺序固定为：

1. 完成阶段代码、IPC 契约、测试和必要界面状态。
2. 执行该阶段的最小自动验证并修复阻断问题。
3. 同步 README、`prototype/README.md`、`PROJECT_PROGRESS.md` 和受影响技术文档。
4. 检查五个版本入口、`git status`、`git diff --check` 和构建产物范围。
5. 更新为该阶段的 `0.3.x` 候选版本并提交。
6. 将 Windows 11 原生验收单独记录；未验收完成时不能把候选描述成正式发布。

### 12.2 分支

- 默认以 `dev` 为开发基线，阶段分支可以使用 `codex/` 前缀。
- 建议分支命名为 `codex/floating-library-contract`、`codex/floating-ball-visual`、`codex/floating-library-actions` 等，完成后合并回 `dev`。
- 不使用强制推送、硬重置或覆盖用户工作树的命令。
- 每个阶段形成一个可定位的提交，提交说明使用 `feat:`、`fix:`、`test:` 或 `docs:` 前缀，冒号后的说明使用中文。
- 未得到明确要求时不修改 remote、不推送、不创建发布 tag。

### 12.3 变更范围

- 本轮允许修改悬浮球 feature、必要的主窗口事件接收、已有安全 command 的复用、对应契约、样式、测试和计划/进度文档。
- 本轮不顺手重构无关的资料库、预览器、设置、托盘或存储代码。
- 若一个阶段发现超出悬浮球文件库范围的缺陷，先记录在 `PROJECT_PROGRESS.md` 的风险项，不自动扩大阶段目标。

## 13. 测试和验收矩阵

| 范围 | 重点 | 最小证据 |
| --- | --- | --- |
| 纯模型 | 搜索、筛选、排序、分页、状态映射、查询序号 | Node test |
| IPC 契约 | 请求白名单、返回字段、ID、revision、错误边界 | `npm.cmd run test:contracts` |
| 前端构建 | JSX、CSS、Sites 产物、浏览器回退 | `npm.cmd run build` |
| 悬浮状态 | 悬停、拖拽、打开/关闭、反馈、几何和 DPI 转换 | `npm.cmd run test:floating-ball` |
| 主窗口工作流 | 文件定位、目录进入、预览事件、焦点和上下文 | library/preview/controller tests |
| Rust | command、索引投影、路径安全、窗口模块 | `cargo fmt`、`cargo check`、`cargo test` |
| 浏览器视觉 | 文件库标题、球体状态、列表布局、窄视口、空状态 | 临时高位端口 + 浏览器检查 |
| Windows 原生 | 真实拖放、资源管理器、预览、DPI、托盘、退出 | 用户 Windows 11 手工记录 |
| 安装包 | 仅在用户要求时验证安装器、loader、卸载和升级 | `npm.cmd run tauri:build` + loader 检查 |

测试数据必须使用 `prototype/tests/fixtures/` 中无敏感信息的夹具，覆盖中文文件名、空格路径、文件夹、失效路径、长名称和多种预览格式。不得把用户真实资料、真实路径、日志或密钥写入测试、截图、诊断导出或提交记录。

## 14. 风险和决策记录

### 14.1 全量索引性能

如果索引规模较小，第一阶段可以先由 Rust 返回受控数量的元数据并在前端完成轻量过滤；一旦列表规模可能明显增长，必须采用 Rust 侧搜索、排序和分页。不能通过无限扩大悬浮窗高度解决大列表问题。

### 14.2 最近记录兼容性

最近记录、最近打开和文件库是三个不同概念：

- 最近记录：由 `lastRecordedAt` 表达，表示通过悬浮球记录的最近资料。
- 最近打开：由 `lastOpenedAt` 表达，表示成功预览或成功默认程序打开的最近资料。
- 文件库：表示全部登记资料，是本轮悬浮窗主列表。

实现时不能因为界面改名而删除或复用错误的时间字段。

### 14.3 主窗口定位和预览竞态

文件点击可能同时触发主窗口显示、列表上下文切换和预览加载。必须使用不透明 ID、当前 revision 和预览任务 ID，确保旧列表或旧预览结果不覆盖新选择。定位成功不能只依据“窗口已经显示”，还要验证条目被选中并可见。

### 14.4 外部程序边界

资源管理器显示和默认程序打开都属于用户明确触发的外部操作。命令失败时应显示通用、可诊断的错误，不展示完整命令行、临时目录或内部堆栈。

### 14.5 窗口尺寸和视觉密度

面板扩大后可能影响边缘展开空间和多 DPI 几何。必须以 `PhysicalPosition`、`PhysicalSize` 处理 Tauri 运行时窗口调用，以 DIP 处理几何模型和持久化位置；浏览器的 CSS 尺寸检查不能替代原生窗口验收。

## 15. 最终 Definition of Done

- [ ] 旧的“最近记录”主面板计划和主语义已被本计划替换；当前 `PROJECT_PLAN.md` 只保留文件库改造路线。
- [ ] `0.3.27` 至 `0.3.32` 每个阶段都有明确目标、文件边界、实现清单、验证方式和版本门禁。
- [ ] 悬浮球外观升级已完成：图标、数量徽标、状态颜色、拖入反馈、成功/失败提示、动画降级和焦点样式均可验证。
- [ ] 悬浮窗已显示全部文件库条目，支持搜索、筛选、排序、分页、空状态、错误重试和失效状态。
- [ ] 点击文件直接打开主窗口并定位到该文件。
- [ ] 点击文件夹打开主窗口对应目录。
- [ ] 文件和文件夹都提供“在资源管理器中显示”快捷操作。
- [ ] 支持格式提供直接预览入口，预览失败有明确下一步并释放资源。
- [ ] 拖放记录、收藏、索引变更、主窗口操作和悬浮窗列表保持 revision 一致。
- [ ] 自动化验证与 Windows 11/Tauri/WebView2 原生验收分别记录，未完成的原生验收不被描述为已完成。
- [ ] 所有版本入口、项目文档、进度文档和 Git 状态一致，未提交真实资料、构建缓存、密钥或临时产物。
