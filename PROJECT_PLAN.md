# 本地资料工作台 0.3.x 界面与功能增强实施计划

> 计划状态：执行中
> 编制日期：2026-09-01
> 当前工作分支：dev
> 当前发布基线：0.3.16
> 下一阶段版本：0.3.17
> 适用平台：Windows 11 x64、Tauri 2、Rust stable、React 19、Vite 6
> 计划目的：在已完成的资料登记、目录浏览、预览、收藏、标签、分组、批量索引操作、悬浮球和托盘能力之上，继续改善日常整理效率、错误恢复、窄窗口使用和本地检索能力。

## 1. 计划替换说明

### 1.1 当前文件的职责

- 本文件已经替换旧版阶段计划，是仓库唯一的后续功能和体验执行入口。
- 旧版围绕早期悬浮球阶段 A-J 的计划内容不再作为执行依据；已经完成的历史事实保留在 PROJECT_PROGRESS.md、README.md、prototype/README.md 和 Git 历史中。
- 本计划从当前已发布的 0.3.16 继续编号，按 0.3.17 至 0.3.26 拆成独立阶段。
- 每个阶段都有独立的代码完成、最小自动验证、文档同步和版本更新门禁，不把所有版本号推迟到最终验收后统一修改。
- 0.3.26 只是当前规划中的最后一个阶段版本，不代表自动发布，也不构成新的最终验收版本。后续仍可在 0.3.x 范围内增加计划外修复阶段。

### 1.2 本轮代码审查形成的主要问题

| 编号 | 优先级 | 问题或机会 | 当前实现位置 | 计划阶段 |
| --- | --- | --- | --- | --- |
| U-01 | P1 | 多选资料后切换导航、搜索或筛选，隐藏的资料仍可能被批量操作 | prototype/src/features/library/LibraryPanel.jsx、useLibraryNavigation.js、App.jsx | 0.3.17 |
| U-02 | P1 | 行操作菜单位于表格滚动容器内部，靠近底部时菜单和危险操作会被裁切 | prototype/src/features/library/LibraryActions.jsx、prototype/src/styles.css | 0.3.18 |
| U-03 | P1 | 预览失败提示“请重试”，但没有重试、定位、复制位置或默认程序打开按钮 | prototype/src/features/preview/PreviewPane.jsx、UnsupportedPreviewer.jsx | 0.3.19 |
| U-04 | P1 | Rust 已有单条标签和分组 command，前端主要只提供批量入口，单条整理成本高 | prototype/src-tauri/src/commands/library.rs、libraryRepository.js、LibraryActions.jsx | 0.3.20 |
| U-05 | P1 | 导入、批量操作和部分成功结果主要依靠短时 toast，详细原因不易回看 | prototype/src/features/library/useLibraryActions.js、App.jsx | 0.3.21 |
| U-06 | P2 | 已有资料时导入区仍占据首屏较大空间，窄窗口下资料表下沉 | prototype/src/App.jsx、prototype/src/styles.css | 0.3.18 |
| U-07 | P2 | 活动筛选只在弹出菜单内显示，资料总数和当前结果数不够直观 | prototype/src/features/library/LibraryPanel.jsx | 0.3.18 |
| U-08 | P2 | 设置弹窗 draft 只在首次挂载时读取，外部设置变化后可能覆盖新状态 | prototype/src/features/settings/SettingsPanel.jsx、useSettingsController.js | 0.3.21 |
| U-09 | P2 | DOCX 的 Mammoth 转换在前端主线程执行，取消只覆盖下载阶段 | prototype/src/features/preview/OfficePreviewer.jsx | 0.3.24 |
| U-10 | P2/P3 | 当前没有最近打开、递归导入和全文检索 | prototype/src/features/library、prototype/src-tauri/src/storage、README.md | 0.3.23、0.3.25、0.3.26 |

### 1.3 当前基线中必须保持的能力

- 默认使用 local-first 方案，不上传文件、路径、缩略图、日志或使用统计，不新增账号、云同步、在线搜索和遥测。
- 当前的文件索引、设置、预览资源协议、系统托盘、悬浮球位置和窗口拖动行为保持兼容。
- 资料导入默认仍只保存路径和元数据，不自动复制、移动、重命名或删除原文件。
- “从资料库移除”和“删除原文件并移入回收站”继续使用不同的操作、文案、确认范围和错误状态。
- Rust 继续负责路径授权、文件系统、持久化、外部转换器和任务生命周期；前端只负责交互状态和安全内容渲染。
- 不使用浏览器回退模式代替 Windows 11/Tauri 原生验收。浏览器只能验证页面布局、前端状态和无真实文件副作用的演示流程。

## 2. 版本和 Git 执行规则

### 2.1 阶段版本总表

| 阶段 | 目标版本 | 交付主题 | 阶段完成后版本状态 |
| --- | --- | --- | --- |
| A | 0.3.17 | 多选范围、上下文切换和列表滚动状态 | 代码门禁通过后立即同步到 0.3.17 |
| B | 0.3.18 | 行菜单弹层、首屏布局和活动筛选反馈 | 代码门禁通过后立即同步到 0.3.18 |
| C | 0.3.19 | 预览错误恢复、预览快捷操作和连续浏览 | 代码门禁通过后立即同步到 0.3.19 |
| D | 0.3.20 | 单条标签、分组编辑和资料详情 | 代码门禁通过后立即同步到 0.3.20 |
| E | 0.3.21 | 导入/批量操作结果中心和设置一致性 | 代码门禁通过后立即同步到 0.3.21 |
| F | 0.3.22 | 键盘操作、范围选择、响应式和无障碍细节 | 代码门禁通过后立即同步到 0.3.22 |
| G | 0.3.23 | 最近打开和悬浮球到主窗口的连续工作流 | 代码门禁通过后立即同步到 0.3.23 |
| H | 0.3.24 | DOCX 和大型预览任务的性能与取消 | 代码门禁通过后立即同步到 0.3.24 |
| I | 0.3.25 | 递归导入、导入策略、进度和取消 | 代码门禁通过后立即同步到 0.3.25 |
| J | 0.3.26 | 本地全文检索和结果摘要 | 代码门禁通过后立即同步到 0.3.26 |

### 2.2 版本更新时机

每个阶段的版本更新不等待最终 Windows 验收，具体顺序固定为：

1. 完成该阶段的代码、契约、测试和必要的界面状态。
2. 执行该阶段列出的最小自动验证，修复阻断问题。
3. 同步 README.md、prototype/README.md、PROJECT_PROGRESS.md 和相关技术文档，明确区分“已实现”“部分支持”“外部依赖”和“计划实现”。
4. 检查 git diff --check、工作树状态、版本入口和未提交文件范围。
5. 将以下五个版本入口统一改为该阶段目标版本：
   - prototype/package.json
   - prototype/package-lock.json 的根包版本
   - prototype/src-tauri/tauri.conf.json
   - prototype/src-tauri/Cargo.toml
   - prototype/src-tauri/Cargo.lock 的根 package 版本
6. 在 PROJECT_PROGRESS.md 记录该阶段版本、代码完成状态、自动验证结果、尚未完成的 Windows 验收项和下一阶段入口，然后提交阶段变更。

阶段版本更新表示“该阶段已完成代码交付并形成候选版本”，不表示已经创建 Tag、GitHub Release 或完成 Windows 11 手工验收。只有用户明确授权时，才执行推送、Tag、安装包构建、Release 或远程操作。

### 2.3 分支规则

- 当前执行分支为 dev，本计划的阶段开发从 dev 基线开始。
- 每个阶段建议使用 feature/0.3.17-selection、feature/0.3.18-overlay 等短生命周期分支，完成后合并回 dev。
- 阶段合并前确认 dev 没有无关改动，检查分支方向和祖先关系，不使用强制推送、硬重置或覆盖用户工作树。
- 阶段代码完成并同步版本后，dev 可以继续进入下一阶段；Windows 手工验收记录单独维护，不阻塞下一阶段的计划编写和代码准备。
- 如果候选版本已经发布后才发现问题，修复必须按新的 0.3.x 补丁版本处理；未发布候选的修复可留在当前阶段版本中。

## 3. 目标架构

### 3.1 列表和选择状态

将当前列表中的三个概念明确分开：

- activeNav、搜索词、类型/标签/分组筛选和目录面包屑组成“列表上下文”。
- selectedId 表示当前键盘焦点或当前预览对象。
- selectedIds 表示批量操作对象，只允许作用于用户当前明确看到并选择的上下文，除非界面明确提示存在跨上下文选择。

上下文切换时默认清空 selectedIds，刷新索引时保留仍存在的选择、预览对象、目录面包屑和滚动位置。搜索、筛选、导航和目录切换时重置表格滚动到顶部，避免新列表从旧滚动位置开始显示。

### 3.2 统一弹层和焦点管理

- Dialog 继续复用 prototype/src/components/Dialog.jsx 的焦点陷阱、Escape、背景点击和关闭后焦点返回。
- 行操作菜单使用受控状态和独立的弹层定位逻辑，不能被 .file-table-scroll 或表格单元格的 overflow 裁切。
- 所有弹层都要定义打开触发点、初始焦点、关闭触发点、窗口边界和窄窗口布局。
- 菜单使用完整的键盘行为：打开后聚焦第一项，方向键切换，Home/End 跳转，Escape 返回触发按钮。

### 3.3 预览会话

统一由 PreviewPane 管理以下状态：

- 当前资料身份、当前列表上下文和相邻资料 ID。
- loading、ready、unsupported、missing、permission-denied、too-large、converter-missing、parse-error、cancelled。
- 重试、关闭、切换资料、打开原文件、定位文件、复制位置和收藏动作。
- 旧任务取消和旧响应丢弃，任何预览错误都不能影响索引和当前选择。

预览操作只能传递索引 ID 或已登记文件夹 ID 加受控相对路径，不能重新开放任意本地路径。

### 3.4 资料元数据编辑

- 单条标签和分组编辑复用已有的 set_entry_tags、set_entry_group command 和 IPC validator。
- 批量标签/分组操作继续使用批量 command，不复制单条操作逻辑。
- 标签、分组、收藏和原文件状态更新后只刷新受影响条目或使用 revision 事件，不无条件重载整份索引。
- 目录临时子项没有稳定的主索引条目时保持只读，不允许通过详情面板绕过授权。

### 3.5 操作结果中心

操作中心只保存必要的本地元数据，不保存正文、缩略图、完整命令行或不必要的真实路径。建议字段包括：操作 ID、操作类型、开始/结束时间、状态、成功/跳过/失败数量、可重试数量、revision 和错误类别。

单项资料名称可以从当前索引按 ID 显示；不把正文和完整路径写入普通日志。持久化历史最多保留 50 条，支持用户清除，损坏不阻塞应用启动。

## 4. 阶段 A：多选范围和列表状态（0.3.17）

### 4.1 目标

让批量操作永远作用于用户能够理解的选择范围，解决切换导航、搜索、筛选、目录和分页后的隐藏选择问题。

### 4.2 主要文件

- prototype/src/App.jsx
- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/features/library/useLibraryNavigation.js
- prototype/src/features/library/useIndexController.js
- prototype/src/features/library/libraryModel.js
- prototype/src/styles.css
- prototype/tests/library-model.test.mjs
- 新增必要的列表选择模型测试或浏览器检查脚本

### 4.3 实现清单

- [ ] 抽取纯函数，计算列表上下文 key，并提供 clearSelectionOnContextChange 或等价模型。
- [ ] 切换“资料库、最近添加、收藏、失效路径”时清空 selectedIds。
- [ ] 搜索词、类型/标签/分组筛选和目录面包屑变化时清空 selectedIds。
- [ ] 保留 selectedId 的预览/键盘焦点语义，不让清空批量选择导致当前预览丢失。
- [ ] 刷新索引和跨窗口 revision 更新时，只移除已不存在的批量选择，保留仍有效的选择。
- [ ] 将表格滚动容器保存为 ref；列表上下文变化时滚动到顶部，刷新索引时保留当前位置。
- [ ] 批量工具栏显示当前可见选择数量和总选择数量；默认策略下二者保持一致。
- [ ] 页眉全选只作用于当前页，取消选择按钮清空整个当前上下文的选择。
- [ ] 选择状态变化不触发预览窗口打开，复选框事件继续阻止行点击冒泡。

### 4.4 验证

- [ ] 选择非收藏资料后切换到“收藏”，工具栏不再保留隐藏选择。
- [ ] 选择资料后输入搜索词、清除搜索、选择类型、切换目录，批量选择均被明确收束。
- [ ] 刷新索引后有效选中项、当前预览和目录路径保持不变。
- [ ] 分页全选不会误选其他页，返回上一页后状态可解释。
- [ ] 运行 npm.cmd run test:library。
- [ ] 运行 npm.cmd run test:contracts 和 npm.cmd run build。
- [ ] 在 1280px、680px、360px 检查表格滚动位置、复选框和批量工具栏。

### 4.5 阶段版本门禁

阶段 A 的代码、最小测试和文档通过后，立即将五个版本入口同步为 0.3.17，在 PROJECT_PROGRESS.md 记录“代码候选已完成、Windows 手工验收状态单独记录”，再进入阶段 B。不得等到整个计划最终验收才更新 0.3.17。

## 5. 阶段 B：行菜单弹层和首屏布局（0.3.18）

### 5.1 目标

解决单项操作菜单被表格裁切的问题，并把已有资料场景的首屏空间优先让给搜索和资料列表。

### 5.2 主要文件

- prototype/src/features/library/LibraryActions.jsx
- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/App.jsx
- prototype/src/components/Dialog.jsx 或新增局部 OverlayPortal.jsx
- prototype/src/styles.css
- 新增菜单定位模型测试和响应式浏览器检查

### 5.3 实现清单

- [ ] 将行菜单从表格滚动容器中移到 document overlay 层，或者使用可靠的 fixed 定位方案。
- [ ] 根据触发按钮的 getBoundingClientRect() 计算菜单位置，自动判断向下或向上展开。
- [ ] 对左右边界进行约束，菜单宽度不超过当前窗口可用空间。
- [ ] 监听窗口 resize、表格滚动和页面上下文变化，关闭或重新定位菜单。
- [ ] 菜单关闭时恢复触发按钮焦点，菜单内点击不触发行点击和预览。
- [ ] 增加方向键、Home、End、Escape 和 Tab 行为，保持 role=menu 语义完整。
- [ ] 文件存在时将大拖放区收缩为紧凑导入条；仍保留“导入文件夹、选择文件和拖放”入口。
- [ ] 搜索框在桌面宽度下使用剩余空间，不再固定为过窄的 260px，长 placeholder 不被过早截断。
- [ ] 筛选菜单外显示活动条件摘要，例如类型、标签和分组 chip，并支持逐项清除。
- [ ] 结果数同时显示当前结果和总索引数，例如“显示 2 项 / 共 4 项”。
- [ ] 360px 下将设置等低频导航收进“更多”入口或提供明显的导航滚动状态，不让入口只依赖用户猜测横向滚动。

### 5.4 验证

- [ ] 第一行、最后一行和表格滚动到底部时打开菜单，所有菜单项都可见并可点击。
- [ ] 菜单打开后滚动表格、改变窗口宽度或切换筛选，菜单不会悬浮在错误位置。
- [ ] 键盘打开菜单后，焦点和 Escape 返回行为正确。
- [ ] 已有资料的 1280px 首屏能看到更多列表内容；360px 下导入条和表格不互相覆盖。
- [ ] 活动筛选 chip 与结果数在搜索、清除、刷新后保持一致。
- [ ] 运行 npm.cmd run test:library、npm.cmd run test:contracts 和 npm.cmd run build。

### 5.5 阶段版本门禁

阶段 B 的菜单定位、响应式布局、键盘检查、测试和文档通过后，立即同步五个版本入口到 0.3.18，并在进度文档记录菜单裁切问题已由代码修复、Windows 原生窗口尺寸验收仍单独记录。

## 6. 阶段 C：预览错误恢复和连续浏览（0.3.19）

### 6.1 目标

让用户在预览窗口内完成“失败后恢复、查看相邻资料和执行常用操作”，不必频繁关闭预览再回到列表。

### 6.2 主要文件

- prototype/src/features/preview/PreviewPane.jsx
- prototype/src/features/preview/UnsupportedPreviewer.jsx
- prototype/src/features/preview/previewApi.js
- prototype/src/features/preview/previewTypes.js
- prototype/src/features/library/libraryRepository.js
- prototype/src/features/library/useLibraryActions.js
- prototype/src/App.jsx
- prototype/src/styles.css
- prototype/tests/preview-*.test.mjs
- prototype/tests/ipc-contracts.test.mjs

### 6.3 实现清单

- [ ] 为 PreviewPane 增加显式的 onRetry、onOpenDefault、onReveal、onCopyLocation、onFavorite 和相邻资料导航回调。
- [ ] 重试时生成新的 task ID，取消旧任务并清理旧 preview resource，不复用已失效的资源 ID。
- [ ] 在 unsupported、missing、permission-denied、too-large、converter-missing 和 parse-error 状态显示对应的可执行动作。
- [ ] “文件过大”显示系统默认程序打开和关闭预览；“路径失效”显示返回列表和重新定位入口；“缺少 DOC 转换器”显示本地依赖说明和默认程序打开入口。
- [ ] 预览头部增加上一项、下一项、收藏、定位和默认程序打开按钮；目录临时子项只能执行被授权的定位或预览动作。
- [ ] 相邻资料由当前可见列表快照计算，不能跨搜索、筛选或导航上下文误跳转。
- [ ] 保持 Markdown 渲染/原文切换、图片缩放旋转、PDF 分页缩放、XLSX Sheet 切换和视频控制行为不变。
- [ ] 浏览器回退模式仍不读取真实本地文件，但应将状态标记为“浏览器演示限制”，不要与格式不支持混为一谈。

### 6.4 验证

- [ ] 模拟所有预览失败状态，确认每个状态都有下一步。
- [ ] 快速切换资料、连续点击上一项/下一项，旧内容不会覆盖新内容。
- [ ] 关闭预览后 preview resource、任务和 Worker 都会释放。
- [ ] 运行 npm.cmd run test:preview、npm.cmd run test:contracts 和 npm.cmd run build。
- [ ] 使用测试夹具检查 TXT、Markdown、DOCX、XLSX、PDF、图片和视频的成功/失败状态。
- [ ] Windows 手工验收单独检查默认程序打开、资源管理器定位、DOC 转换器缺失和文件被移动后的恢复路径。

### 6.5 阶段版本门禁

阶段 C 的预览状态、重试、连续浏览、最小测试、README 限制说明和进度记录通过后，立即同步版本到 0.3.19。Windows 11 真实文件预览的结果在版本更新后补录，不作为版本入口更新的前置条件。

## 7. 阶段 D：单条标签、分组和详情面板（0.3.20）

### 7.1 目标

把批量整理能力下沉到单条资料，降低用户只想整理一两个资料时的操作成本，并为后续操作结果和最近打开提供稳定的详情区域。

### 7.2 主要文件

- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/features/library/LibraryActions.jsx
- prototype/src/features/library/useLibraryActions.js
- prototype/src/features/library/libraryRepository.js
- prototype/src/features/library/libraryControllerModel.js
- prototype/src-tauri/src/commands/library.rs
- prototype/src-tauri/src/storage/mod.rs
- prototype/src/lib/ipcContracts.js
- prototype/src/lib/ipcContracts.d.ts
- prototype/src/styles.css
- prototype/tests/library-controller.test.mjs
- prototype/tests/ipc-contracts.test.mjs

### 7.3 实现清单

- [ ] 在行菜单增加“编辑标签”和“设置分组”，只对主索引条目显示。
- [ ] 标签编辑支持查看现有标签、添加、删除、去重、空值校验、最大数量和最大长度提示。
- [ ] 分组编辑提供“未分组”和已有分组，保存后立即更新当前行并同步 revision。
- [ ] 复用 setEntryTags、setEntryGroup 和现有错误映射，不在前端重复实现 Rust 校验规则。
- [ ] 将常用元数据放入可选的右侧详情面板或资料详情弹窗，显示完整名称、类型、大小、修改时间、来源位置、收藏、标签、分组和状态。
- [ ] 详情面板提供收藏、预览、复制位置、定位和默认程序打开等快捷操作。
- [ ] 详情面板关闭和切换资料时正确恢复列表焦点，不丢失当前筛选和滚动位置。
- [ ] 删除分组前显示受影响资料数量，明确“只解除归属，不删除资料记录和原文件”；支持取消。
- [ ] 标签 chip 可点击进入该标签筛选，但不把展示 chip 误当成删除按钮。

### 7.4 验证

- [ ] 单条添加、删除和替换标签后重启应用，状态仍正确。
- [ ] 单条设置、解除和重命名分组后，筛选、详情、列表和批量工具栏一致。
- [ ] 分组删除只解除归属，不改变资料记录和原文件。
- [ ] 目录临时子项没有可绕过授权的编辑入口。
- [ ] 运行 npm.cmd run test:library、npm.cmd run test:contracts、npm.cmd run test:settings 和 npm.cmd run build。
- [ ] 在窄窗口下详情区域不遮挡表格，必要时改为底部或全屏弹层。

### 7.5 阶段版本门禁

阶段 D 的单条编辑、详情面板、分组删除确认、契约测试和文档通过后，立即同步版本到 0.3.20。索引格式不变时不升级索引版本；如发现需要新增字段，必须在本阶段记录迁移方案后再改版本。

## 8. 阶段 E：操作结果中心和设置一致性（0.3.21）

### 8.1 目标

把短时 toast 改造成可回看的操作反馈，保留批量部分成功、失败、取消、重试和导入跳过原因，并避免设置弹窗覆盖跨窗口产生的新设置。

### 8.2 主要文件

- prototype/src/App.jsx
- prototype/src/features/library/useLibraryActions.js
- prototype/src/features/library/useIndexController.js
- prototype/src/features/library/LibraryActions.jsx
- prototype/src/features/settings/SettingsPanel.jsx
- prototype/src/features/settings/useSettingsController.js
- prototype/src/features/settings/settingsModel.js
- prototype/src/features/window/useWindowController.js
- prototype/src-tauri/src/storage/ 下新增或拆分的操作记录模块
- prototype/src-tauri/src/commands/ 下新增的操作历史 command
- prototype/src/lib/ipcContracts.js、ipcContracts.d.ts
- prototype/src/styles.css

### 8.3 实现清单

- [ ] 建立 OperationRecord 模型，区分导入、刷新、批量收藏、标签、分组、索引移除和撤销。
- [ ] 操作中心展示进行中、成功、部分成功、失败、已取消和超时状态。
- [ ] 导入结果显示新增、更新、跳过、跳过原因和达到上限；批量结果显示成功、跳过、失败和可重试项。
- [ ] 为部分成功结果提供“查看详情”和“重试失败项”，取消和超时结果保留已完成项。
- [ ] toast 只做短确认，不再承担唯一的错误详情来源。
- [ ] 批量操作仍保持现有最大选择数量、取消标记、10 秒任务边界和逐项结果，不因为 UI 改造开放批量物理删除。
- [ ] 操作历史只保存必要元数据，限制记录数量，提供清除入口；损坏时回退为空历史而不阻塞启动。
- [ ] SettingsPanel 在打开时记录设置 revision 或快照；外部 settings-changed 到来时提示草稿已过期，避免静默覆盖。
- [ ] 设置保存采用合并或冲突提示，确保只修改用户实际编辑的字段。

### 8.4 验证

- [ ] 导入含重复、不可读和超过上限内容的文件夹，结果可在 toast 消失后再次查看。
- [ ] 批量操作模拟成功、跳过、失败、取消、超时和重试，详情与当前索引一致。
- [ ] 关闭并重启应用，操作历史按限制恢复；损坏历史文件不阻塞启动。
- [ ] 打开设置后从托盘改变悬浮窗状态，再保存资料库设置，不会把悬浮窗状态改回旧值。
- [ ] 运行 npm.cmd run test:library、npm.cmd run test:contracts、npm.cmd run test:settings 和 npm.cmd run build。
- [ ] Rust 侧新增存储或 command 后运行对应 cargo test、cargo check 和 cargo clippy。

### 8.5 阶段版本门禁

阶段 E 的操作记录、结果中心、设置冲突处理、测试和文档通过后，立即同步版本到 0.3.21。操作历史新增持久化结构时，必须在版本说明中记录数据迁移和清理策略。

## 9. 阶段 F：键盘、范围选择和响应式细节（0.3.22）

### 9.1 目标

让高频整理流程不依赖鼠标，并把 360px、680px、缩放和键盘焦点下的界面状态收敛到可预测行为。

### 9.2 主要文件

- prototype/src/App.jsx
- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/features/library/useLibraryNavigation.js
- prototype/src/features/library/libraryModel.js
- prototype/src/features/library/LibraryActions.jsx
- prototype/src/components/Dialog.jsx
- prototype/src/features/preview/PreviewPane.jsx
- prototype/src/features/settings/SettingsPanel.jsx
- prototype/src/styles.css
- 新增快捷键和范围选择模型测试

### 9.3 实现清单

- [ ] Ctrl+F 聚焦搜索框，F5 刷新索引，Ctrl+O 选择文件，Ctrl+Shift+O 选择文件夹，Ctrl+Z 撤销可撤销索引操作。
- [ ] Escape 按层级关闭菜单、详情、预览和设置，不触发危险操作。
- [ ] 快捷键只在主窗口内部生效，输入框、选择框、文本编辑区域中不抢占用户输入；不在本阶段引入全局系统快捷键。
- [ ] 支持 Shift 选择连续资料，保留复选框和当前页全选；范围选择以当前列表上下文为边界。
- [ ] 预览窗口增加左右方向键切换资料，焦点在输入框或预览内容编辑区域时不抢占。
- [ ] 行菜单打开后焦点进入菜单，菜单关闭后回到触发按钮。
- [ ] 检查表格、状态文字、图标按钮和错误提示的颜色对比；颜色不能成为判断状态的唯一方式。
- [ ] 360px 下导航增加清晰的滚动/更多入口，设置、刷新和清除选择仍可到达。
- [ ] 检查浏览器缩放 125%、150% 和系统字体增大后的标题、按钮、表格和 Dialog，不允许文字溢出或互相覆盖。
- [ ] 保留 prefers-reduced-motion，新增动画不得把任务状态只交给动画表达。

### 9.4 验证

- [ ] 键盘完成搜索、筛选、选择、预览、关闭、刷新和撤销流程。
- [ ] Shift 范围选择、跨页、筛选变化和刷新后的选择范围可解释。
- [ ] Tab 顺序不会进入隐藏输入框，Dialog、菜单和预览的焦点不会跑出当前层。
- [ ] 运行 1280px、960px、680px、360px 的浏览器检查，并保存失败状态截图。
- [ ] 运行 npm.cmd run test:library、npm.cmd run test:contracts、npm.cmd run test:preview 和 npm.cmd run build。
- [ ] Windows 原生环境检查无边框窗口拖动区域没有被快捷键或弹层覆盖。

### 9.5 阶段版本门禁

阶段 F 的快捷键、范围选择、焦点、缩放和窄窗口检查通过后，立即同步版本到 0.3.22。系统级全局快捷键、开机启动和托盘新行为不在本阶段默认引入，避免扩大原生验收范围。

## 10. 阶段 G：最近打开和悬浮球连续工作流（0.3.23）

### 10.1 目标

区分“最近添加”“最近记录”和“最近打开”，让用户从悬浮球、预览和主窗口之间连续返回正在处理的资料。

### 10.2 主要文件

- prototype/src/App.jsx
- prototype/src/features/library/libraryModel.js
- prototype/src/features/library/useLibraryNavigation.js
- prototype/src/features/library/useLibraryActions.js
- prototype/src/features/preview/PreviewPane.jsx
- prototype/src/features/floating-ball/FloatingBallWindow.jsx
- prototype/src/features/floating-ball/FloatingBallPanel.jsx
- prototype/src/features/floating-ball/useFloatingBallRecords.js
- prototype/src/features/floating-ball/floatingBallModel.js
- prototype/src-tauri/src/storage/mod.rs
- prototype/src-tauri/src/commands/library.rs
- prototype/src-tauri/src/commands/floating_ball.rs
- prototype/src-tauri/src/windows/tray.rs
- prototype/src/lib/ipcContracts.js、ipcContracts.d.ts

### 10.3 实现清单

- [ ] 将索引格式从 v4 迁移到 v5，新增可选的 lastOpenedAt，迁移前备份，迁移失败保留旧索引。
- [ ] 只有预览成功或默认程序打开 command 成功后才更新 lastOpenedAt；点击失效资料不能伪造最近打开记录。
- [ ] 主窗口新增“最近打开”导航，按最近打开时间倒序，显示数量和空状态。
- [ ] “最近添加”继续基于 addedAt，悬浮球和托盘继续基于 lastRecordedAt，三者文案和计数严格区分。
- [ ] 最近打开、收藏、失效状态和重命名通过 revision 事件同步到悬浮球和托盘。
- [ ] 从悬浮球打开主窗口时，主窗口直接定位到目标资料并打开预览或文件夹目录。
- [ ] 最近打开列表限制数量，不保存正文，不在日志中输出完整路径。

### 10.4 验证

- [ ] v4 索引迁移后收藏、标签、分组、添加时间、最近记录和路径不丢失。
- [ ] 预览失败、默认程序打开失败、资料移除和原文件失效不会错误写入最近打开。
- [ ] 重启应用后最近打开排序和数量正确。
- [ ] 主窗口、托盘、悬浮球之间的收藏、移除、重命名和失效状态一致。
- [ ] 运行迁移、索引、IPC、预览和悬浮球测试，并执行 npm.cmd run build。
- [ ] Windows 11 手工检查托盘菜单、悬浮球、预览焦点和关闭/重启行为。

### 10.5 阶段版本门禁

阶段 G 的 v4 到 v5 迁移、最近打开、跨窗口同步、自动验证和文档通过后，立即同步版本到 0.3.23。迁移失败和用户数据保护证据必须先写入进度记录，再进入下一阶段。

## 11. 阶段 H：DOCX 和大型预览性能（0.3.24）

### 11.1 目标

减少大型 DOCX 或复杂文档转换对界面线程的阻塞，使取消、超时、关闭和快速切换真正能够结束旧任务。

### 11.2 主要文件

- prototype/src/features/preview/OfficePreviewer.jsx
- 新增 prototype/src/features/preview/docxWorker.js 或 Rust 侧 DOCX 任务适配器
- prototype/src/features/preview/PreviewPane.jsx
- prototype/src/features/preview/previewApi.js
- prototype/src/features/preview/previewTypes.js
- prototype/src-tauri/src/preview/、commands/、storage/ 中相关任务生命周期模块
- prototype/shared/file-types.json
- prototype/package.json、package-lock.json 或 prototype/src-tauri/Cargo.toml、Cargo.lock
- prototype/tests/preview-*.test.mjs

### 11.3 实现清单

- [ ] 先用 2 MiB、10 MiB、20 MiB、复杂表格/图片/目录测试夹具测量当前转换耗时、内存和取消行为。
- [ ] 评估 Mammoth 在 Worker 中运行的兼容性；可行时使用可终止的 DOCX Worker，不可行时将转换移至 Rust 受控任务。
- [ ] 取消覆盖下载、解析、转换、HTML 清理和资源释放，而不是只取消 fetch。
- [ ] 对转换输出增加二次大小和节点数量限制，超过限制显示明确状态。
- [ ] 显示解析阶段、耗时过长、取消和超时状态；关闭预览时确保 Worker/子进程退出。
- [ ] 保持 HTML sanitization、脚本/外链/嵌入对象禁止和 DOCX 只读语义。
- [ ] 与 XLSX Worker、PDF.js 任务和预览资源 TTL 统一任务 ID、取消和 dispose 处理。
- [ ] 依赖升级必须检查许可证、维护状态、锁文件和 WebView2 兼容性，不为了性能绕过成熟解析器。

### 11.4 验证

- [ ] 大型 DOCX 转换时主界面仍能关闭、切换资料和响应取消。
- [ ] 快速切换多个 DOCX，旧结果不会渲染到新资料。
- [ ] 超时、输出过大、损坏文档和加密文档均有可执行下一步。
- [ ] 运行 npm.cmd run test:preview、npm.cmd run build；如修改 Rust 则运行 cargo test、cargo check、cargo clippy。
- [ ] 使用无敏感测试夹具做 Windows WebView2 手工验证，不读取用户真实文档。

### 11.5 阶段版本门禁

阶段 H 的性能基线、取消、资源清理、依赖评估和自动验证通过后，立即同步版本到 0.3.24。如果引入新的运行时依赖，必须同时更新 README 的安装条件和进度记录，不能先改版本后补说明。

## 12. 阶段 I：递归导入和导入策略（0.3.25）

### 12.1 目标

解决“导入文件夹只登记文件夹本身，子文件只能进入目录查看”的预期差异，同时保留当前按需浏览的低成本默认行为。

### 12.2 主要文件

- prototype/src/features/library/useLibraryActions.js
- prototype/src/features/library/libraryRepository.js
- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/App.jsx
- prototype/src-tauri/src/commands/mod.rs
- prototype/src-tauri/src/commands/library.rs
- prototype/src-tauri/src/filesystem/mod.rs
- prototype/src-tauri/src/storage/、windows/ 中事件和任务模块
- prototype/src/lib/ipcContracts.js、ipcContracts.d.ts
- prototype/src/styles.css
- prototype/tests/ 下新增递归扫描、取消和上限夹具

### 12.3 实现清单

- [ ] 文件夹选择后显示明确选项：“登记文件夹”与“导入文件夹内资料”。
- [ ] 保持“登记文件夹”为默认选项，当前目录浏览行为不改变。
- [ ] 递归导入必须明确扫描范围、文件类型、排除规则、最大条目数和预计影响范围。
- [ ] 扫描任务支持进度、取消、超时、跳过原因、重复路径和部分成功结果。
- [ ] Rust 对每个路径重新执行 canonical、symlink/reparse point、普通文件类型和权限校验。
- [ ] 不跟随符号链接、Windows reparse point 或目录外跳转；递归深度、总条目、单次任务和内存上限全部受限。
- [ ] 重复路径保留现有 ID、收藏、标签、分组、添加时间和预览状态，不产生重复条目。
- [ ] 导入策略可以记录在本次任务或设置中，但不允许静默修改用户原文件。
- [ ] 结果中心提供扫描摘要、跳过原因和重试入口，不能只靠 toast。

### 12.4 验证

- [ ] 当前默认“登记文件夹”行为完全保持兼容。
- [ ] 递归导入包含中文、空格、深层目录、同名文件、损坏文件、权限拒绝、符号链接和 reparse point 的测试夹具。
- [ ] 达到条目上限、取消、超时和部分失败后，索引没有重复或半写状态。
- [ ] 递归导入不会把真实文件内容和路径写入普通日志或测试输出。
- [ ] 运行前端契约/库测试、Rust filesystem/storage/command 测试、cargo clippy 和 npm.cmd run build。
- [ ] Windows 11 手工检查文件夹选择器、进度、取消、重启恢复和长路径显示。

### 12.5 阶段版本门禁

阶段 I 的递归导入、取消、上限、安全边界、测试和文档通过后，立即同步版本到 0.3.25。递归导入不应通过修改默认行为来“顺便完成”，必须保留用户可选择的导入模式。

## 13. 阶段 J：本地全文检索（0.3.26）

### 13.1 目标

在不引入云端服务和隐藏网络请求的前提下，让用户能够检索文本和 Markdown 正文，逐步扩大“可检索本地库”的实际价值。

### 13.2 设计前置决策

- [ ] 先统计典型索引数量、文本总大小、增量修改频率和启动耗时，决定继续使用 JSON + 独立内容索引，还是引入 SQLite/FTS 等本地依赖。
- [ ] 依赖选型必须评估许可证、维护状态、安装体积、Windows/Tauri 兼容性和锁文件复现。
- [ ] 正文索引与 index.json 分离，支持清除和重建，不让内容索引损坏阻塞元数据索引启动。
- [ ] 首期只支持 TXT/Markdown；DOCX、PDF、XLSX 是否抽取正文必须另行评估，不把格式支持写成默认承诺。

### 13.3 主要文件

- prototype/src/features/library/LibraryPanel.jsx
- prototype/src/features/library/libraryModel.js
- prototype/src/features/library/useIndexController.js
- prototype/src/features/library/useLibraryActions.js
- prototype/src/lib/ipcContracts.js、ipcContracts.d.ts
- prototype/src-tauri/src/storage/ 新增本地内容索引模块
- prototype/src-tauri/src/commands/ 新增搜索、重建和清除 command
- prototype/src/features/preview/ 复用已验证的文本读取边界
- prototype/src/styles.css
- prototype/tests/ 新增全文索引和隐私边界测试

### 13.4 实现清单

- [ ] 搜索界面增加“文件名和元数据 / 正文”模式，默认仍使用现有元数据搜索。
- [ ] 正文索引在导入、刷新和文件修改后后台增量更新，支持取消和失败重试。
- [ ] 搜索结果显示命中字段、短摘要和高亮，但不把完整正文写入日志、toast 或 URL。
- [ ] 搜索结果与现有导航、收藏、失效路径、类型、标签、分组和目录上下文组合使用。
- [ ] 文件删除、移除索引、重命名、失效和清除索引后，正文索引及时删除或标记无效。
- [ ] 内容索引设置提供重建、清除、大小统计和失败状态，不提供上传或远程分析选项。
- [ ] 对单文件大小、总索引大小、文本长度、词数和任务时间设定上限。
- [ ] 索引损坏时只影响全文检索，元数据资料库和预览仍可正常使用。

### 13.5 验证

- [ ] 中文、英文、数字、标点、代码块和 Markdown 表格搜索结果正确。
- [ ] 通过文件名、标签和正文同时搜索时，结果范围和高亮来源明确。
- [ ] 取消、超时、索引损坏、重建和删除后的清理状态可恢复。
- [ ] 断网环境运行不产生外部请求；日志、诊断导出和测试输出不包含正文。
- [ ] 运行新增全文索引测试、IPC 测试、Rust 存储测试、cargo clippy 和 npm.cmd run build。
- [ ] 对大规模无敏感测试夹具进行启动耗时、搜索耗时和内存检查，再决定是否扩大格式覆盖。

### 13.6 阶段版本门禁

阶段 J 的索引方案、依赖、安全边界、增量更新、失败恢复、测试和文档通过后，立即同步版本到 0.3.26。该版本仍是开发候选版本，是否发布必须由用户单独确认，不把“计划完成”写成 Release 已发布。

## 14. 跨阶段质量门禁

质量检查在每个阶段执行，不集中到最后一个阶段：

### 14.1 前端

- [ ] 组件状态具备加载、成功、空列表、无结果、失败和重试路径。
- [ ] 所有输入、筛选、菜单、Dialog、预览和批量操作均有明确的键盘焦点和关闭行为。
- [ ] 资料行操作不把文件系统副作用藏在普通点击或导入流程中。
- [ ] 页面不依赖颜色、动画或图标单独表达状态。
- [ ] 1280px、960px、680px、360px 和至少 125% 浏览器缩放下没有关键文字覆盖、按钮裁切和不可达入口。
- [ ] 不为单次需求引入无必要的全局状态或通用抽象；组件超过 300 行时评估拆分职责。

### 14.2 Rust、文件系统和预览

- [ ] 所有新增路径仍通过索引 ID、登记文件夹 ID 和受控相对路径授权。
- [ ] 不跟随符号链接、Windows reparse point 或目录外跳转。
- [ ] 外部进程处理超时、退出码、标准错误、取消和临时目录清理。
- [ ] 索引、设置、内容索引和操作历史写入采用临时文件加原子替换或等价方案。
- [ ] 预览任务在成功、失败、取消、切换和关闭时释放资源。
- [ ] 错误返回结构化类别、用户可执行下一步和不泄露内部路径/命令行的消息。

### 14.3 文档和版本

- [ ] 每个阶段完成后立即同步 README.md、prototype/README.md 和 PROJECT_PROGRESS.md。
- [ ] 五个版本入口始终一致，版本更新不等待最终验收。
- [ ] 新增索引、设置、预览、快捷键、依赖、Tauri capability 或数据目录时，记录版本影响。
- [ ] 不将浏览器回退、模型测试、Rust 编译或构建成功写成 Windows 11 手工验收完成。
- [ ] git status、git diff --check 和改动范围在每个阶段提交前完成。

## 15. 测试命令矩阵

根据阶段风险执行最小必要命令，不在纯文档或窄范围前端改动中无条件执行完整安装包构建。

| 变更范围 | 最小验证 |
| --- | --- |
| 选择、搜索、排序、筛选、分页、布局 | npm.cmd run test:library、npm.cmd run test:contracts、npm.cmd run build |
| 预览 UI、预览状态、资源释放 | npm.cmd run test:preview、npm.cmd run test:contracts、npm.cmd run build |
| 设置和跨窗口设置同步 | npm.cmd run test:settings、npm.cmd run test:contracts、npm.cmd run build |
| 悬浮球、托盘和事件 | npm.cmd run test:floating-ball、npm.cmd run test:tray，必要时再运行 Rust 检查 |
| Rust command、存储、路径和外部进程 | cargo fmt --check、cargo test、cargo check、cargo clippy --all-targets --all-features -- -D warnings |
| 版本、Tauri 配置、安装能力和发布流程 | 前端构建、Rust 检查、必要时 npm.cmd run tauri:build 和 loader 验证 |
| Windows 原生行为 | 用户在 Windows 11/Tauri/WebView2 环境执行安装、启动、托盘、窗口、预览和文件操作验收 |

## 16. 风险和回退

- 任何阶段失败时保留当前候选版本、失败项、复现步骤、测试输出和上一稳定版本，不把失败功能半隐藏在默认流程中。
- 索引迁移始终先备份后替换；迁移失败保持旧索引可恢复。
- 原文件删除、重命名、复制和递归导入都不能因为 UI 优化而扩大默认权限或绕过 Rust 校验。
- 新增全文索引、操作历史或 DOCX Worker 时，损坏的附属数据不能阻塞元数据索引和主窗口启动。
- 任何无法确认的物理文件状态都显示“状态未确认”，不自动重复执行破坏性操作。
- 如果阶段改动影响悬浮球位置、无边框拖动、托盘退出、WebView2 loader 或安装目录，必须重新安排对应 Windows 手工验收。
- 不使用 git reset --hard、强制推送、覆盖用户未提交改动或删除未确认的构建/测试产物。

## 17. 当前执行入口

当前已完成：

- 已切换到 dev 分支，基线为 0.3.16。
- 已删除旧版总体计划内容并建立本文件。
- 新计划从 0.3.17 阶段 A 开始，首先处理多选范围和列表滚动状态。

当前未完成：

- 阶段 A 尚未开始实现，版本入口暂时保持 0.3.16。
- 本计划中的所有 0.3.17 至 0.3.26 都是待执行阶段，不应在代码尚未完成时提前修改版本或宣传为已发布。

下一步：

1. 按阶段 A 修改选择状态、上下文切换和表格滚动行为。
2. 执行阶段 A 的最小前端测试、契约测试、构建和浏览器状态检查。
3. 同步文档并立即将五个版本入口更新为 0.3.17，记录 Windows 手工验收尚未执行或仍待复核的项目。
