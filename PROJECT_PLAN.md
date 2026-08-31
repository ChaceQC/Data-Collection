# 本地资料工作台 0.3.x 功能、体验、代码与架构优化实施计划

> 计划类型：替换旧版 `PROJECT_PLAN.md` 的新总体优化计划
> 编制日期：2026-08-30
> 当前发布基线：`0.3.6`
> 计划版本线：从 `0.3.7` 开始，每个阶段完成后递增一个 `0.3.x` 版本
> 当前状态：阶段 A-D 的代码实现和阶段级自动验证已完成，尚未完成对应的 Windows 11 手工验收和候选版本提升
> 适用平台：Windows 11 x64，Tauri 2，Rust stable，React 19，Vite 6

## 1. 计划替换与目标

### 1.1 旧计划处理

- 旧版仅面向悬浮球悬停弹窗的阶段 A-F 计划已删除，不再作为后续执行入口。
- 本文件是仓库唯一的当前总体执行计划；历史实现、验收和 Release 事实继续保留在 `PROJECT_PROGRESS.md`、`README.md` 和 Git 历史中。
- 已完成的 `0.3.6` 悬浮球、托盘、主窗口生命周期和发布能力不重新实现；后续只处理本计划列出的缺陷、结构和扩展能力。
- 本计划的阶段版本是候选版本。没有完成对应阶段的代码、最小验证、文档同步和用户验收前，不得修改应用实际版本或创建 Release。

### 1.2 总体目标

本计划把上一次代码审查中的问题拆成四条主线：

1. 收紧路径授权、预览安全、索引恢复和物理文件操作的一致性边界。
2. 解决跨窗口同步、外部文件变化、最近资料语义和大文件预览的可靠性与性能问题。
3. 将前端状态、IPC 契约、文件类型注册、存储和预览任务逐步收敛到清晰的模块边界。
4. 提升资料库在窄窗口、键盘、屏幕阅读器、错误恢复和重复操作场景下的可用性，并补齐高价值资料管理能力。

### 1.3 不改变的基本原则

- 保持 local-first：默认不上传文件、路径、缩略图、日志或使用统计，不新增账号、云同步、在线搜索和遥测。
- 默认只保存路径、元数据、收藏、最近记录和设置，不自动复制、移动、重命名或删除用户原文件。
- 物理文件操作必须由用户明确触发，执行前展示影响范围，失败时说明已经完成和未完成的部分。
- 保留索引格式 v3、设置格式 v2、预览资源协议、系统托盘、悬浮球位置格式和主窗口拖动语义；确需升级时必须增加迁移和回退方案。
- Rust 负责路径校验、文件系统、持久化、外部转换器和任务生命周期；前端负责交互状态和安全内容渲染。
- 不用浏览器回退模式代替真实 Windows 桌面验收；不把构建成功或模型测试通过写成 Windows 手工验收通过。

## 2. 当前真实基线

### 2.1 当前已具备的能力

- `0.3.6` 已完成资料导入、文件夹登记、目录直接子项浏览、搜索、排序、分页、收藏、失效路径重新定位和预览入口。
- 已接入文本、Markdown、图片、视频、XLS/XLSX、DOCX、DOC 和 PDF 的受控只读预览。
- 已具备悬浮球最近五条记录、拖入记录、收藏同步、托盘菜单、关闭隐藏、主窗口拖动、位置恢复和多显示器/DPI 处理。
- 已使用原子写入保存索引和设置；已对符号链接、Windows reparse point、外部打开、回收站删除和 DOC 转换设置基础安全边界。
- `prototype/tests/` 已有资料库、设置、预览注册表、悬浮球、托盘和 Sites worker 的模型或协议测试。

### 2.2 当前主要模块

```text
prototype/src/
  App.jsx                              # 当前主页面和大部分业务协调
  features/library/                   # 资料库列表、筛选、排序、文件操作
  features/preview/                   # 预览注册、资源协议调用和各格式渲染
  features/settings/                  # 设置模型和设置弹窗
  features/floating-ball/             # 悬浮球状态、几何、拖动和最近记录
  features/tray/                      # 前端托盘模型测试辅助代码
  styles.css                          # 主窗口、弹窗和悬浮球样式

prototype/src-tauri/src/
  commands/                            # Tauri command 入口
  filesystem/                          # 类型判断、路径校验、文件操作
  preview/                             # 预览加载、转换、资源和协议
  storage/                             # 索引、设置和悬浮球位置持久化
  windows/                             # 托盘、窗口生命周期、监视器和悬浮球
```

### 2.3 审查问题编号

| 编号 | 优先级 | 问题 | 当前证据位置 |
| --- | --- | --- | --- |
| F-01 | P1 | `list_directory`、`can_preview`、`load_preview` 信任原始路径，未验证索引归属 | `prototype/src-tauri/src/commands/mod.rs`、`prototype/src-tauri/src/preview/operations.rs` |
| F-02 | P1 | “最近添加”实际筛选全部有效资料，改排序后语义失效 | `prototype/src/features/library/libraryModel.js` |
| F-03 | P1 | command 返回完整索引又发送 `index-changed`，导致全量重复刷新和响应竞态 | `prototype/src-tauri/src/commands/`、`prototype/src/App.jsx` |
| F-04 | P1 | 外部文件变化没有明确刷新入口；悬浮球和托盘刷新状态时未始终通知主窗口 | `prototype/src/App.jsx`、`prototype/src-tauri/src/commands/floating_ball.rs`、`windows/tray.rs` |
| F-05 | P1 | 物理删除成功后索引保存失败会留下半成功状态 | `prototype/src-tauri/src/commands/library.rs` |
| F-06 | P1 | Markdown sanitizer 将 `//host/path` 当作本地链接放行 | `prototype/src/features/preview/previewSecurity.js` |
| F-07 | P1/P2 | XLSX 先完整解析再截断；DOC 转换不可取消且输出没有二次大小限制 | `prototype/src/features/preview/xlsxWorker.js`、`src-tauri/src/preview/doc.rs`、`loaders.rs` |
| F-08 | P2 | 索引缺少结构校验、重复路径清理和用户可操作的损坏恢复入口 | `src-tauri/src/filesystem/mod.rs`、`storage/mod.rs`、`lib.rs` |
| F-09 | P2 | 文件类型表、预览表和显示类型分别维护，存在漂移风险 | `libraryModel.js`、`previewRegistry.js`、`filesystem/mod.rs` |
| F-10 | P2 | `App.jsx` 约千行，存储每次修改复制并完整写入 JSON | `src/App.jsx`、`src-tauri/src/storage/mod.rs` |
| F-11 | P1/P2 | 模拟表格语义、弹窗焦点、窄窗口横向滚动和破坏性操作识别不足 | `LibraryPanel.jsx`、`LibraryActions.jsx`、`styles.css` |
| F-12 | P2 | 缺少 UI/command 集成测试、lint/typecheck 和 Release 前置质量门禁 | `prototype/package.json`、`.github/workflows/release.yml` |

## 3. 目标架构

### 3.1 数据调用方向

```text
React 页面
  -> feature controller / state selector
  -> 类型化 API wrapper
  -> Tauri command
  -> Rust service / repository
  -> 文件系统、索引存储、预览任务或 Windows 集成
```

- 页面组件不再直接协调所有 IPC、业务错误和全量索引状态。
- 预览、资料库、设置、悬浮球和窗口生命周期各自拥有 feature controller；跨窗口同步由独立的同步层负责。
- command 接收业务 ID 和受限参数；Rust 从当前状态重新读取路径和元数据，不把前端传回的路径当作授权凭据。
- 目录浏览产生的临时子项必须带明确的来源目录和生命周期，不能伪装成已经持久化的一级索引记录。

### 3.2 统一索引同步模型

- `AppState` 维护单调递增的 `indexRevision`。
- 每次索引变更事件至少包含 `revision`、`ids` 和变更类型；事件不携带完整文件内容和完整路径。
- 变更 command 返回最小结果，例如变更项、统计信息和 revision；只有启动、手动恢复或版本迁移才返回完整快照。
- 前端收到旧 revision 时丢弃响应；同一时间的多个刷新请求合并为一个，保留当前选择、目录路径、页码和滚动位置。
- 悬浮球、托盘和主窗口使用同一个索引服务，不建立第二份资料数据。

### 3.3 统一预览任务模型

```text
idle -> loading -> ready
              -> unsupported
              -> missing / permission-denied
              -> too-large / converter-missing / parse-error
```

- 每个任务有 `taskId`、取消状态、输入文件身份和输出资源身份。
- 新任务开始或预览关闭时，旧任务不能更新当前组件，也不能继续持有不必要的临时文件。
- 所有可渲染 HTML 继续经过 sanitization；所有资源 URL 必须来自受控的预览资源表。
- DOC 输出、PDF 页面渲染、图片解码和 XLSX 解压都使用独立的大小、像素、页数或单元格限制。

### 3.4 数据迁移策略

- v3 索引字段继续兼容；新增标签、分组、操作日志等字段时升级为明确的索引格式版本，不直接覆盖旧文件。
- 迁移使用临时文件加原子替换；迁移失败保留旧文件并显示可执行的恢复说明。
- 迁移前保留一份带时间戳的本地备份，不写入普通日志，不把真实路径复制到测试输出。
- 任何破坏性迁移必须有旧格式夹具、重复数据夹具、损坏数据夹具和回退测试。

## 4. 阶段执行规则

每个阶段固定按以下顺序执行：

1. 在独立分支完成本阶段代码和对应测试，先检查工作树，不覆盖用户无关改动。
2. 执行本阶段最小必要验证；只在修改范围确实涉及共享行为、原生能力或发布流程时扩大验证范围。
3. 同步 `prototype/package.json`、`package-lock.json` 根包、`src-tauri/tauri.conf.json`、`Cargo.toml`、`Cargo.lock` 根包以及受影响的 README/进度文档。
4. 检查版本入口、`git diff --check`、敏感文件和构建产物，生成候选版本供用户验收。
5. 等待用户明确回复本阶段 Windows 11 手工验收结果；失败项必须记录显示器、DPI、文件类型、路径和复现步骤。
6. 只有用户明确要求或明确授权发布时，才执行 commit、合并、推送、tag 和 Release；规划阶段不执行这些外部操作。

### 4.1 版本同步清单

每个阶段的版本号只能在本阶段门禁准备发布时统一更新，不能只改标题：

- `prototype/package.json` 的 `version`。
- `prototype/package-lock.json` 根 package 的 `version`。
- `prototype/src-tauri/tauri.conf.json` 的 `version`。
- `prototype/src-tauri/Cargo.toml` 的 package `version`。
- `prototype/src-tauri/Cargo.lock` 根 package 的 `version`。
- `README.md`、`prototype/README.md` 的当前版本、能力和限制说明。
- `PROJECT_PLAN.md` 的阶段状态和版本表。
- `PROJECT_PROGRESS.md` 的实际实现、验证、风险和下一步。

## 5. 分阶段实施计划

### 阶段 A：安全路径授权与预览链接边界（`0.3.7`）

**目标：** 让后端真正执行“只允许已登记资料或已登记目录下的子项”的授权边界，修复 Markdown 外部链接放行问题。

**主要文件：**

- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/preview/operations.rs`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src/features/preview/previewApi.js`
- `prototype/src/features/preview/previewSecurity.js`
- `prototype/tests/` 和 `prototype/src-tauri/src/preview/` 测试模块

**实施清单：**

- [x] 将 `can_preview`、`load_preview` 的输入改为 `fileId` 或受控的目录子项引用；Rust 从 `AppState` 读取最新索引条目。
- [x] 将 `list_directory` 改为接收已登记文件夹 ID，或同时验证请求路径是已登记文件夹的规范化子路径。
- [x] 在后端重新检查路径存在性、普通文件/文件夹类型、符号链接/reparse point 和当前索引身份。
- [x] 保留当前预览返回状态，不把路径、命令行或堆栈返回给界面。
- [x] 将 sanitizer 的本地引用规则改为明确允许片段链接和安全相对引用，拒绝 `//`、反斜杠变体、`http`、`https`、`data`、`javascript` 等协议。
- [x] 为 Markdown、DOCX HTML、预览资源和目录越界场景补充失败测试。

**完成门禁：**

- 未登记的绝对路径、相对路径和其他目录调用 command 均被拒绝。
- 登记文件夹的直接子项可以正常浏览和预览，但不能越过登记目录边界。
- 恶意 Markdown 中的外部链接不会被渲染成可导航外链，正常标题、片段链接和表格不回归。
- `0.3.7` 版本入口全部一致，`PROJECT_PROGRESS.md` 记录真实测试结果和未覆盖的 Windows 手工项。

**最小验证：** `npm.cmd run test:preview`、相关 Rust 单元测试、`cargo fmt --check`、`cargo check --tests`。

### 阶段 B：索引刷新、事件修订号与最近视图（`0.3.8`）

**目标：** 建立可丢弃旧响应的同步模型，增加用户可触发的刷新入口，让“最近添加”和目录排序语义正确。

**主要文件：**

- `prototype/src/App.jsx`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/windows/tray.rs`
- `prototype/src-tauri/src/storage/mod.rs`

**实施清单：**

- [x] 增加 `refresh_index` 或等价 command，使用 `spawn_blocking` 执行文件元数据检查，返回变更 ID、统计信息和 revision。
- [x] 主窗口提供明确的刷新按钮、处理中状态、失败重试和“失效路径数量”反馈。
- [x] 悬浮球和托盘触发刷新后，对主窗口发送同一 revision 的 `index-changed` 事件。
- [x] 主窗口刷新使用 single-flight 和 revision 校验，避免多个 `load_file_index` 响应互相覆盖。
- [x] 将 `recent` 改为明确的最近窗口或最近 N 条；导航数量、排序和空状态与该定义一致。
- [x] 目录浏览使用名称/修改时间等合理排序，不能把临时生成的 `addedAt` 当作注册时间。
- [x] 刷新时保留当前选中项、目录面包屑、页码和滚动位置。

**完成门禁：**

- 在资源管理器外部移动、修改、删除文件后，用户点击刷新即可看到准确状态。
- 连续收藏、重命名、悬浮球记录和托盘刷新不会触发整份索引的重复传输，也不会出现旧状态覆盖新状态。
- “最近添加”不再等同于全部有效资料；目录子项顺序稳定且可解释。
- 20,000 条索引上限下，刷新不会阻塞界面线程，达到上限时界面给出明确提示。

**最小验证：** 资料库模型测试、事件/revision 模型测试、相关 Rust 存储测试；不运行无关的全项目测试。

### 阶段 C：索引校验、文件操作事务与故障恢复（`0.3.9`）

**目标：** 消除索引损坏、重复记录和物理文件操作半成功时的不可诊断状态。

**主要文件：**

- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/filesystem/operations.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src/features/library/LibraryActions.jsx`

**实施清单：**

- [x] 为索引条目增加结构校验：ID 非空且唯一、路径非空、类型和扩展名一致、状态值受控、时间和大小在合理范围内。
- [x] 启动时检测重复路径、重复 ID 和旧字段；迁移时保留用户收藏、添加时间、最近记录和预览状态。
- [x] 索引损坏或版本不支持时先备份旧文件，再进入可操作的恢复状态，提供重新建立空索引或导出诊断信息的入口。
- [x] 设置文件损坏时显示“已使用默认设置”的明确提示，并在条件允许时写入修复后的 v2 文件。
- [x] 为删除原文件建立待同步操作记录；删除成功但索引写入失败时，启动或刷新可以识别并清理半成功状态。
- [x] 物理删除、从资料库移除、回收站状态和失效记录继续使用不同的 command、文案和确认内容。
- [x] 统一返回结构化的操作错误类别，前端不再依靠任意字符串判断下一步。

**完成门禁：**

- 损坏索引不会直接让应用无提示退出，用户可以保留旧文件并完成恢复。
- 删除、重命名、移除索引的成功、失败和部分成功状态均可诊断，原文件不会因普通索引错误被误删。
- 重复路径和重复 ID 有稳定迁移结果，收藏和悬浮球引用不会随机指向另一条记录。

**最小验证：** Rust 存储/文件操作测试、损坏索引和写入失败夹具、前端确认弹窗状态测试。

### 阶段 D：预览任务取消与大文件资源治理（`0.3.10`）

**目标：** 降低 XLSX、DOC、PDF、图片和视频预览对界面、内存、临时文件和外部转换器的影响。

**主要文件：**

- `prototype/src-tauri/src/preview/operations.rs`
- `prototype/src-tauri/src/preview/loaders.rs`
- `prototype/src-tauri/src/preview/doc.rs`
- `prototype/src-tauri/src/preview/resources.rs`
- `prototype/src-tauri/src/preview/resource_protocol.rs`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/features/preview/xlsxWorker.js`
- `prototype/src/features/preview/SpreadsheetPreviewer.jsx`
- `prototype/src/features/preview/ImagePreviewer.jsx`
- `prototype/src/features/preview/VideoPreviewer.jsx`
- `prototype/src/features/preview/PdfPreviewer.jsx`

**实施清单：**

- [x] 建立可取消的预览任务注册表，关闭预览、切换资料和退出应用时取消未完成任务。
- [x] DOC 转换使用隔离的 LibreOffice 临时用户配置，继续限制输入路径、输出目录、超时、退出码和临时目录清理。
- [x] 检查转换后的 PDF 大小、页数和资源目录；超过限制时不注册资源并清理产物。
- [x] XLSX 优先评估替换当前存在已知风险的 SheetJS；短期采用按工作表/首屏惰性解析、总单元格数、解压后体积和 Worker 超时限制。
- [x] PDF 页面渲染增加页面尺寸和 canvas 像素上限；图片旋转、缩放和视频元数据事件使用任务序号，旧事件不能覆盖新资料。
- [x] 预览资源增加活动/过期清理策略，不只在下一次请求到来时清理；删除索引或关闭窗口时及时撤销相关资源。
- [x] 保持资源协议的 Range、HEAD、Content-Length、路径再次校验和不执行文档脚本的行为。

**完成门禁：**

- 关闭预览后，DOC 转换、XLSX Worker、PDF 渲染和媒体事件不会继续更新当前页面。
- 超大、损坏、加密和转换器缺失的文件显示可执行的错误状态，不产生长期临时目录。
- 切换不同资料时不会显示旧文件内容；预览状态和资源数量可通过测试确认最终释放。

**最小验证：** 预览状态/资源协议测试、XLSX Worker 测试、DOC 转换器可用/缺失/超时夹具；不在没有测试样本时读取用户真实文件。

### 阶段 E：共享契约与前端职责拆分（`0.3.11`）

**目标：** 在不改变现有用户行为和存储格式的前提下，降低 `App.jsx`、重复类型表和字符串 IPC 的维护成本。

**主要文件：**

- `prototype/src/App.jsx`
- `prototype/src/features/library/`
- `prototype/src/features/preview/`
- `prototype/src/features/settings/`
- `prototype/src/features/floating-ball/`
- `prototype/src-tauri/src/commands/`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/windows/tray_model.rs`
- `prototype/src/features/tray/trayModel.js`

**实施清单：**

- [ ] 把索引加载、事件同步、目录浏览、文件操作、窗口生命周期和弹窗协调从 `App.jsx` 拆到职责明确的 controller/hook。
- [ ] 建立共享文件类型 manifest，统一扩展名、kind、显示类型、媒体类型、预览器和限制；前端与 Rust 不再各自维护完整列表。
- [ ] 清理只被测试使用、与实际 Rust 托盘逻辑重复的前端托盘模型，或明确它作为跨层契约测试的唯一用途。
- [ ] 在 IPC/API 边界逐步使用 TypeScript 类型和运行时校验，优先覆盖 command 参数、事件 payload、预览状态和操作结果，不要求一次性重写所有 JSX。
- [ ] 抽取索引 repository/service，使 JSON 存储、未来 SQLite 和事件发布不会继续耦合在 command 函数中。
- [ ] 统一错误映射、路径身份、时间单位、空值和状态常量，删除没有实际用途的 options 或重复转换。

**完成门禁：**

- 单个普通前端文件不再继续扩大；主页面只组合页面区域和 feature controller。
- 新增文件类型只需修改 manifest 和对应预览器，不再修改三套扩展名判断。
- IPC 契约变化可以在一个位置查到，并有至少一个成功和一个失败测试。
- 本阶段不改变索引 v3、设置 v2、快捷键、托盘行为和用户数据目录。

**最小验证：** 现有模型测试、共享 manifest 一致性测试、前端构建、`cargo check --tests`。

### 阶段 F：界面语义、弹窗焦点与窄窗口体验（`0.3.12`）

**目标：** 让资料库、预览、设置和破坏性操作在键盘、屏幕阅读器、窄窗口和重复操作场景中清晰可用。

**主要文件：**

- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src/features/settings/SettingsPanel.jsx`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/features/preview/ImagePreviewer.jsx`
- `prototype/src/features/preview/VideoPreviewer.jsx`
- `prototype/src/styles.css`

**实施清单：**

- [ ] 将资料列表改为语义化 `<table>` 或完整 ARIA grid；列标题、行状态、文件名和行操作需要有清晰关系。
- [ ] 抽取统一 Dialog 基础组件，实现打开焦点、Tab 限制、Escape、关闭后返回触发点、`aria-labelledby` 和 `aria-describedby`。
- [ ] 对重命名文件名做内联校验，显示非法字符、扩展名变化、冲突和空值原因，不只依靠 toast。
- [ ] 将“从资料库移除”和“删除原文件”放进清晰的操作菜单或分组，避免两个相似垃圾桶图标并排导致误操作。
- [ ] 窄窗口将 918px 固定表格切换为紧凑列表/卡片或可展开行；保留文件名、类型、状态和高频操作，次要操作进入菜单。
- [ ] 为图片和视频补充有意义的可访问名称；检查状态文本、按钮、排序方向、分页和错误提示的键盘可达性。
- [ ] 集中颜色、间距、圆角、阴影和控件尺寸 token，增加 `prefers-reduced-motion`、深色模式或高对比度的明确策略。

**完成门禁：**

- 仅使用键盘可以导入、搜索、排序、选择、预览、关闭弹窗和完成确认操作。
- 屏幕阅读器能分辨表头、文件行、状态和行操作；弹窗不会把焦点留在背景内容中。
- 在目标最小窗口尺寸下，文件名、状态、操作按钮和确认文案不互相覆盖。

**最小验证：** 组件级交互测试、键盘焦点测试、固定桌面窗口尺寸和窄窗口截图检查；若用户要求不运行，则只保留代码审查记录，不宣称视觉验收通过。

### 阶段 G：资料位置与检索体验（`0.3.13`）

**目标：** 让用户能快速判断资料来源、区分同名文件，并在不打开原文的前提下找到目标记录。

**主要文件：**

- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src/App.jsx`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `README.md`、`prototype/README.md`

**实施清单：**

- [ ] 在资料行或详情区域显示可复制、可省略并可展开查看的来源目录/路径。
- [ ] 搜索覆盖文件名、类型、状态、路径和必要的文件夹层级；仍不读取全文内容。
- [ ] 对同名资料显示父目录摘要，并提供资源管理器定位入口。
- [ ] 明确“最近添加”“最近记录”“最近打开”是否为不同概念；只有实现对应时间字段后才展示对应入口。
- [ ] 为搜索无结果、失效路径、空目录和索引上限设计具体的下一步操作。

**完成门禁：**

- 同名文件可以通过位置区分；路径搜索不会泄露到普通日志或无关事件 payload。
- 搜索、目录浏览、收藏和失效筛选可以组合使用，返回结果数量和空状态正确。
- README 的当前能力、限制和隐私说明与实际实现一致。

**最小验证：** 资料库模型测试、中文/空格/深层路径夹具、搜索组合测试。

### 阶段 H：标签、分组与可组合筛选（`0.3.14`）

**目标：** 在不引入云端服务的前提下，为资料库增加用户维护的轻量组织能力。

**主要文件：**

- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src/features/library/`
- `prototype/src/features/settings/`
- `PROJECT_PROGRESS.md`、`README.md`

**实施清单：**

- [ ] 为索引格式增加经过版本化的 `tags` 和可选 `groupId` 字段，旧索引迁移时默认为空。
- [ ] 提供创建、重命名、删除分组和添加/移除标签的 command；Rust 校验名称长度、控制字符和重复项。
- [ ] 资料库支持标签、多选分组、收藏、失效路径和类型的组合筛选。
- [ ] 标签和分组的修改只更新相关条目，不返回完整索引；使用 revision 事件同步。
- [ ] 删除分组默认只解除归属，不删除资料记录和原文件；在文案中区分两种行为。

**完成门禁：**

- v3 索引可以安全迁移到新格式，升级失败不会丢失收藏、路径和最近记录。
- 标签/分组的增删改在重启、托盘、悬浮球和主窗口中保持一致。
- 过滤、搜索、排序和分页组合时状态稳定，刷新后不会跳回第一项。

**最小验证：** 索引迁移、标签字符校验、组合筛选、重启恢复和事件同步测试。

### 阶段 I：批量操作与可控撤销（`0.3.15`）

**目标：** 降低重复收藏、移除索引和整理标签的操作成本，同时避免批量物理操作造成不可逆误删。

**主要文件：**

- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/filesystem/operations.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src/App.jsx`

**实施清单：**

- [ ] 支持多选资料和批量收藏、移除索引、添加/移除标签；批量结果报告成功、失败、跳过和原因。
- [ ] 批量物理复制、重命名或删除必须先展示数量、文件名范围和冲突策略，默认不覆盖、不执行文件夹删除。
- [ ] 建立有限的本地操作日志，只记录可撤销的索引变更和必要的文件身份，不记录文件内容。
- [ ] “撤销”优先覆盖收藏、标签、分组和移除索引；物理删除只提供回收站/资源管理器恢复入口，除非另有经过验证的 Windows 恢复实现。
- [ ] 对批量任务增加取消、超时、部分成功和重试策略，避免一个失败阻塞全部结果。

**完成门禁：**

- 批量操作不会因选中状态变化、分页或跨窗口刷新而误作用于另一批资料。
- 物理删除仍始终需要影响范围确认；批量失败后能明确知道每个条目的最终状态。
- 撤销不会越过当前索引版本或恢复到已经被用户再次修改的旧状态。

**最小验证：** 批量模型、操作日志、冲突/取消/部分成功测试；使用无敏感测试夹具。

### 阶段 J：质量门禁、依赖和发布加固（`0.3.16`）

**目标：** 让后续版本在合并和发布前有稳定的自动质量门禁，并降低已知依赖和未签名安装包带来的风险。

**主要文件：**

- `prototype/package.json`
- `prototype/` 下新增或现有 lint/typecheck 配置
- `prototype/tests/`
- `prototype/src-tauri/src/` 集成测试入口
- `.github/workflows/`
- `README.md`、`PROJECT_PROGRESS.md`

**实施清单：**

- [ ] 增加前端 lint、格式检查和 IPC 类型检查命令；命令必须能在干净 checkout 中复现。
- [ ] 增加 React 组件/键盘交互测试、command 集成测试、索引事件竞态测试和预览资源生命周期测试。
- [ ] 将 Release workflow 拆为质量检查、构建、资源校验和发布依赖链；Release 构建不得跳过格式检查、测试和依赖审计。
- [ ] 明确 SheetJS、WebView2 Runtime、LibreOffice、视频编码和 Windows Shell 的支持边界与替代策略。
- [ ] 为 Windows 安装包增加代码签名评估、SHA-256 校验和发布说明；私钥、签名密码和本地配置不能进入仓库或日志。
- [ ] 发布前验证版本入口、x64 架构、NSIS、便携 ZIP、loader、卸载和首次启动；CI 不能代替 Windows 11 手工验收。

**完成门禁：**

- Pull Request 可以阻断 lint、类型、单元测试、集成测试或构建失败。
- Release job 只在质量 job 全部通过且 tag 与全部版本入口一致时运行。
- 用户可以从 Release 说明中知道 WebView2、LibreOffice、签名和各预览格式的实际要求。

**最小验证：** 先执行新增的阶段级命令；发布候选再执行 `npm.cmd run build`、Rust 检查和 Tauri 构建，不在普通功能修改中无条件运行完整安装包构建。

## 6. 阶段版本与门禁总表

| 阶段 | 候选版本 | 交付重点 | 必须保留的行为 |
| --- | --- | --- | --- |
| A | `0.3.7` | 路径授权、目录边界、Markdown 链接安全 | 预览协议、路径安全、浏览器回退 |
| B | `0.3.8` | revision 同步、刷新、最近视图、目录排序 | 选择、分页、托盘/悬浮球同步 |
| C | `0.3.9` | 索引恢复、文件操作事务、部分成功诊断 | 原文件操作语义、回收站确认 |
| D | `0.3.10` | 预览取消、XLSX/DOC/PDF/资源治理 | 预览格式和错误状态契约 |
| E | `0.3.11` | 前端拆分、共享类型、IPC 契约 | 索引 v3、设置 v2、窗口行为 |
| F | `0.3.12` | 表格语义、Dialog 焦点、窄窗口和样式 token | 桌面主流程、拖动和快捷操作 |
| G | `0.3.13` | 路径展示、位置搜索、检索反馈 | local-first 和隐私边界 |
| H | `0.3.14` | 标签、分组和组合筛选 | 旧索引可迁移，原文件不受影响 |
| I | `0.3.15` | 批量操作、有限撤销、部分成功 | 物理删除明确确认，不默认恢复原文件 |
| J | `0.3.16` | CI、依赖、签名和发布质量门禁 | Windows 11 手工验收仍为最终条件 |

版本进入下一阶段的统一条件：代码完成、阶段级最小验证通过、文档已同步、候选版本入口一致、用户完成对应手工验收并记录结果。任何一项缺失，版本保持上一阶段，不得提前宣传为完成。

## 7. 验证矩阵

### 7.1 前端模型和组件

- 资料库：搜索、导航计数、最近语义、排序、分页、目录排序、选择保持和批量选择。
- 预览：状态转换、快速切换、关闭释放、链接清理、图片/视频旧事件、XLSX Worker 超时。
- 设置：非法值回退、版本迁移、损坏提示、默认值和窗口设置同步。
- 悬浮球：最近记录、收藏、拖动、展开/收起、事件 revision 和错误恢复。
- Dialog/UI：Escape、Tab、焦点返回、键盘触发、空状态、错误状态和窄宽度布局。

### 7.2 Rust 和文件系统

- 路径：中文名、空格、长路径、相对路径、符号链接、reparse point、权限拒绝和路径越界。
- 索引：原子写入、写入失败、损坏 JSON、未知版本、重复 ID、重复路径和迁移回退。
- 文件操作：冲突、扩展名变化、非法名称、重命名回滚、回收站失败、索引同步失败和取消。
- 预览：文件缺失、权限拒绝、超限、损坏容器、加密工作簿、DOC 转换器缺失/超时、资源过期和 Range 请求。
- Windows：托盘、关闭隐藏、悬浮球窗口创建/重建、主窗口拖动、多显示器、负坐标和 DPI。

### 7.3 发布和文档

- 每个版本的 package、Tauri、Rust crate 和锁文件版本一致。
- README 区分已实现、部分支持、外部依赖和计划能力。
- `PROJECT_PROGRESS.md` 记录日期、完成项、进行中、风险、下一步、涉及文件和实际验证结果。
- `.gitignore` 不包含用户资料、真实路径调试输出、日志、缓存、构建产物、签名私钥和本地配置。
- Release 构建只在用户明确授权后执行，并保留 Windows 11 手工验收证据。

## 8. 回退、暂停与数据保护

- 阶段实现必须保持可回退到上一稳定 tag；不使用 `git reset --hard`、强制推送或覆盖用户未提交改动。
- 如果某阶段失败，保留失败项、复现步骤、候选版本和上一版本入口，不把失败功能半隐藏在默认流程中。
- 如果用户要求暂停，立即在 `PROJECT_PROGRESS.md` 记录当前分支、HEAD、已验证状态、未完成项、风险和准确恢复命令；不主动提交、推送、重置或清理工作树。
- 数据迁移先备份后替换；任何无法确认的物理文件状态都显示“状态未确认”，不自动重试破坏性操作。
- 所有测试使用 `tests/fixtures/` 中无敏感样本，禁止读取或写入用户真实资料作为验收证据。

## 9. 总体 Definition of Done

本计划的 `0.3.x` 优化线只有在以下条件全部满足后才可关闭：

- [ ] F-01 至 F-12 的 P1 问题已修复或有明确的风险接受记录。
- [ ] 索引、预览、文件操作和跨窗口事件拥有可验证的身份、版本、错误和取消语义。
- [ ] 索引损坏、迁移失败、文件移动/删除、权限拒绝和外部转换器异常都有用户可执行的恢复路径。
- [ ] 文件类型、IPC payload、预览状态和操作错误不再由多个模块无约束地重复定义。
- [ ] 主页面、资料表格、预览弹窗、设置弹窗和悬浮球通过键盘和辅助技术检查，窄窗口没有关键内容覆盖。
- [ ] 资料位置搜索、标签/分组、批量操作和有限撤销的实现状态与 README、进度和 Release 说明一致。
- [ ] UI/command 集成测试、Rust 检查、构建、依赖审计和 Release 质量门禁均可在干净环境复现。
- [ ] Windows 11 实机完成安装、启动、托盘、悬浮球、预览、文件操作、升级/回退和卸载验收。
- [ ] 每个已发布阶段的版本入口一致，未提交真实资料、密钥、日志、缓存、签名私钥或无关改动。

### 当前执行入口

当前仍以 `0.3.6` 为已发布基线，阶段 A-D 的代码实现和阶段级自动验证已完成；下一步等待用户按阶段完成 Windows 11 手工验收，再决定是否将候选版本入口依次提升到 `0.3.7`-`0.3.10`。在用户验收和明确发布授权前，不修改应用实际版本，不执行发布流程，不把自动验证写成桌面验收。
