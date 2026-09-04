# 项目进度

## 2026-09-04

### 阶段 B：索引快照原子一致性（0.3.34 代码候选，已本地合并）

#### 已完成

- 完成 B1：`AppState` 将 entries、groups、undo、recovery、pending 操作和 revision 收敛到 `IndexStateData` 单一 `RwLock`；`snapshot()` 一次读取并返回同一提交点的完整索引快照，`IndexRepository` 只通过一致快照和明确 mutation API 访问索引。
- 完成 B2：更新、撤销、恢复重建和 pending delete reconciliation 都先构造并校验下一状态，完成索引原子持久化后再整体替换内存快照；失败写入不会递增 revision 或改变旧快照，groups 与 entries/undo 一起提交。pending 文件提交失败时优先回滚已提交的索引，回滚失败则让内存状态与已提交索引保持一致并保留 pending 状态。
- 完成 B3：`SettingsState` 使用统一 settings/warning/revision 快照，`ContentIndexState` 使用统一 documents/status 快照；正文搜索结果与 status 由同一次只读快照返回，未改变 settings v3 或 content index v1 的用户可见语义。
- 完成 B4：主窗口、悬浮球、托盘、刷新、启动同步和记录打开路径均改用统一索引快照；前端以纯模型判定事件和响应的 revision，丢弃低版本、重复和乱序结果并等待跳跃版本，事件只触发 reload，不直接写入 entries。
- 新增索引同点提交、分组/undo 组合提交、失败写入保持完整快照、正文失败提交和 settings warning/revision 快照测试；磁盘格式保持 `index.json v5`、`settings.json v3`、`content-index.json v1`，无迁移或格式版本变化。
- 五个版本入口已同步为 `0.3.34`：`prototype/package.json`、`prototype/package-lock.json` 根包、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml` 和 `prototype/src-tauri/Cargo.lock` 根 package。

#### 进行中

- 无；阶段 B 代码、自动验证、版本同步、本地 NSIS 候选和本地 Git 收口已完成，待用户在 Windows 11/Tauri/WebView2 环境执行原生验收。

#### 用户验收

- 尚未执行。本阶段不能用 Rust/前端测试、生产构建、NSIS 生成或浏览器回退结果替代 Windows 11/Tauri/WebView2 原生验收。

#### 阻塞与风险

- 安装包未签名且不内置 WebView2 Runtime；目标 Windows 11 机器需要已有 WebView2。DOC 预览仍依赖目标机 LibreOffice。
- 本阶段没有改变持久化格式，未新增迁移风险；浏览器仅覆盖 revision 模型，跨窗口索引最终一致性、应用重启恢复和安装行为仍需用户原生验收。

#### 下一步

- 由用户执行主窗口/悬浮球/托盘操作、重启恢复和 Windows 11/Tauri/WebView2 安装验收；验收通过后再单独决定是否创建 Tag、push 或 Release。

#### 涉及文件

- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/repository.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/storage/content_index.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/windows/tray.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/useIndexController.js`
- `prototype/tests/library-controller.test.mjs`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`、`PROJECT_PROGRESS.md`
- 五个版本入口文件

#### 验证

- `npm.cmd run test:contracts`：17 项通过。
- `npm.cmd run test:library`：23 项通过；`npm.cmd run test:floating-ball`：30 项通过；`npm.cmd run test:content`：5 项通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --all -- --check`：通过；`cargo check --locked`、`cargo check --tests --locked`、`cargo test --locked`：通过，Rust 共 85 项测试通过；`cargo clippy --all-targets --all-features --locked -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，完成前端构建、Rust release 编译、Windows x64 NSIS 打包和 loader 检查。安装器绝对路径为 `E:\Project\test\prototype\src-tauri\target\release\bundle\nsis\本地资料工作台_0.3.34_x64-setup.exe`，大小 `8847122` bytes，SHA-256 `997F674D01EECC779025F58444E98E2C0DBE1CCFA9A9BE721BCD8BDC20E35487`。
- release 主程序 `E:\Project\test\prototype\src-tauri\target\release\local-material-workbench.exe`：`35749433` bytes，FileVersion/ProductVersion `0.3.34`，SHA-256 `3BADB4F5F034827DCA6C29CF5CDC00FC59E24050D861C59B2DDE2402637CAB94`。
- `WebView2Loader.dll` 与 release 主程序同目录：`E:\Project\test\prototype\src-tauri\target\release\WebView2Loader.dll`，`160320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；loader 校验通过，确认 Windows x64。
- 单独执行 `npm.cmd run verify:loader`：通过，确认 loader 与 release 主程序同目录且为 Windows x64。
- 未执行新的浏览器截图或服务检查；revision 乱序、重复和跳跃行为由前端纯模型测试覆盖，不宣称为桌面原生验收。
- 阶段分支为 `codex/phase-0.3.34-index-snapshot`，阶段 HEAD 为 `528a9055aacce1db1c7a8121e18a400c6c705acd`；开始阶段的 `dev` 基线为 `61ec93d367439f878c4322d9700b7a589c067da0`，已通过 `git merge-base --is-ancestor dev codex/phase-0.3.34-index-snapshot`。合并前 `dev` HEAD 为 `61ec93d367439f878c4322d9700b7a589c067da0`，已执行 `git merge --ff-only codex/phase-0.3.34-index-snapshot`，合并后为 `528a9055aacce1db1c7a8121e18a400c6c705acd`。
- 阶段分支已通过合并确认并执行 `git branch -d codex/phase-0.3.34-index-snapshot` 删除；删除后本地阶段分支仅保留 `dev`、`main`，未执行 push、Tag 或 Release。

## 2026-09-04

### 阶段 A：确定性功能和契约修复（0.3.33 已完成）

#### 已完成

- 按当前 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 A 的 A1-A4：Rust 图片校验同时接受 `jpg`/`jpeg`；预览层明确区分主索引条目和目录临时子项；悬浮球数量超过两位数字显示 `99+`，数量读取失败时隐藏徽标；JS/Rust 文件库查询统一 NFKC、空白、大小写、空时间和确定性 Unicode 排序语义。
- JPG 仍然经过共享 manifest、普通文件、真实图片格式和像素上限校验；新增 Rust 测试覆盖真实 JPEG 内容和 `.jpg` 扩展名内容不匹配，未放宽预览安全边界。
- 目录临时子项只保留其实际可用的预览失败恢复、返回和资源管理器定位能力，不再显示收藏、复制位置、重命名、删除或默认程序打开入口；主索引文件的收藏、复制位置、默认打开和定位能力保持不变。
- 新增前端预览能力模型、JS 文件库 NFKC/空时间/Unicode 排序回归样本，以及 Rust 端相同语义样本；没有改变 `index.json` 格式、IPC 返回结构、`get_floating_recent` 最近记录语义或外部文件操作边界。
- `unicode-normalization` 已加入 `prototype/src-tauri/Cargo.toml` 并锁定到 `Cargo.lock` 的 `0.1.25`，仅用于文件库查询文本和排序键规范化。
- 五个版本入口已同步为 `0.3.33`：`prototype/package.json`、`prototype/package-lock.json` 根包、Tauri 配置、Rust crate 和 `Cargo.lock` 本地 package；计划、根 README 和原型 README 已标明当前仍为未发布候选。

#### 进行中

- 无；阶段 A 代码、自动门禁、NSIS 候选、用户原生验收和本地 Git 收口均已完成；未执行 push、Tag 或 Release。

#### 用户验收

- 2026-09-04，用户确认阶段 A 的 Windows 11/Tauri/WebView2 原生验收已完成。用户未提供具体 Windows、WebView2、显示器或 DPI 版本信息，本文不补填环境细节。

#### 阻塞与风险

- 首次 `npm.cmd run tauri:build` 在 Tauri 写入 release EXE 时遇到 Windows `os error 32` 文件锁并失败；确认无本地资料工作台、Tauri 或 NSIS 进程后重试成功。第一次生成的部分安装器不作为候选，以下只记录第二次成功构建的产物。
- 安装包未签名且不内置 WebView2 Runtime，目标 Windows 11 机器需要已有 WebView2；DOC 预览仍依赖目标机 LibreOffice；`xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险保持不变。
- 本阶段未启动新的浏览器回退服务；自动化证据来自模型/契约/构建测试，不能替代用户已确认的 Windows 11/Tauri/WebView2 原生验收。

#### 下一步

- 进入阶段 B `0.3.34`：围绕 entries、groups、undo、recovery 和 revision 建立一致索引快照及原子提交顺序，保持本阶段已确认的 JPG、目录子项和悬浮球查询语义。

#### 涉及文件

- `prototype/src-tauri/src/preview/image.rs`
- `prototype/src-tauri/src/storage/floating_files.rs`
- `prototype/src-tauri/Cargo.toml`、`prototype/src-tauri/Cargo.lock`
- `prototype/src/features/preview/PreviewPane.jsx`、`previewTypes.js`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`、`FloatingBallPanel.jsx`、`floatingBallModel.js`、`floatingLibraryModel.js`
- `prototype/tests/preview-registry.test.mjs`、`floating-ball-model.test.mjs`、`floating-library-model.test.mjs`
- `prototype/package.json`、`prototype/package-lock.json`、`prototype/src-tauri/tauri.conf.json`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`、`PROJECT_PROGRESS.md`

#### 验证

- `npm.cmd run test:preview`：16 项通过；包含 JPG 相关预览注册和目录子项能力模型测试。
- `npm.cmd run test:floating-ball`：30 项通过；包含 `99`/`100`/`999` 数量边界、失败隐藏状态、NFKC 搜索、空时间和确定性排序测试。
- `npm.cmd run test:contracts`：16 项通过；目录目标和文件库禁止字段契约保持通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；Vite 既有大 chunk 警告未阻断构建。
- `cargo fmt --all -- --check`：通过；`cargo check --locked`、`cargo check --tests --locked`、`cargo test --locked`：通过，Rust 共 81 项测试通过；`cargo clippy --locked --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：第二次重试通过，完成 Rust release 编译、Windows x64 NSIS 打包和内置 loader 检查。安装器绝对路径为 `E:\Project\test\prototype\src-tauri\target\release\bundle\nsis\本地资料工作台_0.3.33_x64-setup.exe`，大小 `8891516` bytes，SHA-256 `90DBA663B55E2CA494AEF9E8C2C8E46A6E16AE938900EE76409EB300CF325C73`。
- release 主程序 `E:\Project\test\prototype\src-tauri\target\release\local-material-workbench.exe`：`35866595` bytes，FileVersion/ProductVersion `0.3.33`，SHA-256 `B7370262F983ED44043AB60D89DDD6177FFDAF12CBF7E80E0152DB95CECC5201`。
- `WebView2Loader.dll` 与 release 主程序同目录：`E:\Project\test\prototype\src-tauri\target\release\WebView2Loader.dll`，`160320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；`npm.cmd run verify:loader` 通过，确认 Windows x64。
- 浏览器回退检查：本阶段未执行新的浏览器截图/服务检查；不复用旧截图作为本阶段原生证据。
- 阶段分支：`codex/phase-0.3.33-correctness`，阶段 HEAD `49cf14104db004801b9ab32f5a89e2438855d25a`；开始阶段基线为 `dev`/`97b93681e2116c4cf2fad6653fd9c77f87a08073`。已通过 ancestry 检查并执行 `git merge --ff-only codex/phase-0.3.33-correctness`，合并前 `dev` HEAD 为 `97b93681e2116c4cf2fad6653fd9c77f87a08073`，合并后为 `49cf14104db004801b9ab32f5a89e2438855d25a`；随后执行 `git branch -d codex/phase-0.3.33-correctness` 成功，删除后本地阶段分支仅保留 `dev`、`main`。
- 当前 Git：`dev` 已合并阶段 A，工作树在本次进度文档更新提交前保持干净；未执行 commit 以外的 push、Tag 或 Release 操作。

## 2026-09-03

### 阶段 F：完整验收、文档收口和候选发布（0.3.32 已发布）

#### 已完成

- 用户确认已完成当前 `PROJECT_PLAN.md` 阶段 F 的 Windows 11/Tauri/WebView2 原生验收；验收覆盖悬浮球启动、置顶、透明背景、位置恢复、悬停/点击展开、球体到面板过渡、延迟收起、`Escape`、拖拽、边缘吸附、四角展开、多显示器和混合 DPI。
- 用户确认资源管理器真实拖入文件/文件夹、重复路径与记录反馈、超过五项文件库列表、搜索/筛选/排序/滚动、文件定位、文件夹目录、资源管理器显示、文本/Markdown/图片/Office/PDF 直接预览及失败恢复均通过。
- 用户确认主窗口导入、收藏、移除、重命名、重新定位后的悬浮窗同步，托盘/悬浮球显示与隐藏、主窗口关闭、真正退出、重启恢复和卸载相关生命周期验收通过。
- 阶段 F 文档收口已完成；`PROJECT_PLAN.md` 的阶段状态、验收清单、候选版本门禁和最终 Definition of Done 已同步，根 README 与 `prototype/README.md` 已移除当前“待原生验收”表述。
- 阶段 F 验收确认后，`prototype/package.json`、`prototype/package-lock.json` 根包、Tauri 配置、Rust crate 和 `Cargo.lock` 本地 package 五个版本入口已统一更新为 `0.3.32`。

#### 进行中

- 无；阶段 F 原生验收、文档收口、`0.3.32` 版本入口同步、Tag、远端分支同步和 GitHub Release [`v0.3.32`](https://github.com/ChaceQC/Data-Collection/releases/tag/v0.3.32) 已完成。

#### 用户验收

- 2026-09-03，用户确认当前计划第 11.5 节 Windows 11/Tauri/WebView2 原生验收清单全部通过。具体 Windows、WebView2、显示器和 DPI 版本信息未提供，文档不臆填。

#### 阻塞与风险

- 本轮没有阶段 F 原生验收、构建或发布阻塞；`0.3.32` NSIS 安装包已完成构建和 loader 校验，GitHub Release 已发布。
- 安装包未签名且不内置 WebView2 Runtime；目标 Windows 11 机器需要已有 WebView2。DOC 预览仍依赖目标机 LibreOffice。
- `xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险仍按发布边界保留；本轮没有扩大依赖或改变原文件操作权限。

#### 下一步

- 本轮已按用户授权完成 `v0.3.32` Tag、`dev`/`main` 远端同步和 GitHub Release 发布；后续变更需新增明确的 `0.3.x` 阶段。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- `README.md`
- `prototype/README.md`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`

#### 验证

- `npm.cmd run tauri:build`：通过，生成并校验 `0.3.32` Windows x64 NSIS 安装包；安装器和 release 主程序/loader 的大小与 SHA-256 已在本条记录。
- 复核阶段 A-E 已记录的前端模型、契约、构建、Rust 和 `0.3.31` 候选验证结果；本次版本更新未改变代码逻辑，未重复执行完整测试套件。
- 发布前运行 `git diff --check`：通过，确认文档、版本入口和代码没有编码或空白错误。

### 阶段 E：同步、拖放反馈、性能和窗口稳定性（0.3.31 代码候选，已通过阶段 F 验收）

#### 已完成

- 按当前 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 E：悬浮窗通过经过契约校验的 `index-changed` 事件接收索引变更；收藏、重命名、重新定位、索引移除和包含 `floating-recorded` 写入在内的导入变化都会刷新当前文件库上下文。
- 文件库 Hook 现在同时使用请求序号和索引 `revision` 接受结果；快速搜索、筛选切换、收藏刷新和拖放期间的旧响应会被丢弃，多个连续 revision 事件会短暂合并后再刷新文件库和数量徽标。
- 刷新保留当前搜索词、筛选、排序、页码和列表滚动容器；页码超出新总数时回退到最后有效页，当前条目消失时以空状态替代旧列表。搜索输入继续使用 180ms 防抖和每页 20 条分页。
- `get_floating_files` 改为只读取当前已校验索引快照；启动加载、显式索引刷新和实际索引 mutation 仍负责文件系统 metadata reconciliation，并通过 revision 事件通知悬浮窗，避免每次搜索都重新遍历整个索引。
- 拖放路径队列增加 Windows 分隔符/大小写归一化去重，当前正在记录的路径不会再次提交；球体和面板显示明确的放置态，记录反馈区分新增、刷新、跳过、全部失败、路径失效/权限问题和达到索引上限。
- 悬浮球查询、拖放、原生移动和几何任务增加销毁保护；面板物理窗口调整完成后才显示，避免打开/收起时先绘制错误尺寸；滚动条占位、内部 overscroll 和 reduced-motion 样式保持窄窗口布局稳定。
- 新增模型测试覆盖旧请求/旧 revision、Windows 路径去重、失败/路径问题/上限反馈；五个版本入口已同步到 `0.3.31`，`PROJECT_PLAN.md`、根 README 和 `prototype/README.md` 已更新。

#### 进行中

- 无；阶段 E 代码、自动验证、浏览器回退检查、Windows x64 NSIS 构建及阶段 F Windows 原生验收、Tag、Release 和远端同步均已完成。

#### 用户验收

- 用户已于 2026-09-03 确认 Windows 11/Tauri/WebView2 原生安装、资源管理器真实拖放、相同/不同路径连续拖入、主窗口操作后的跨窗口最终一致性、混合 DPI、多显示器切换、四边四角贴边、托盘隐藏/退出、重启恢复和卸载通过；本轮仍没有以浏览器演示或构建成功代替这些验收。

#### 阻塞与风险

- 安装包未签名且不内置 WebView2 Runtime；目标 Windows 11 机器需要已有 WebView2。DOC 预览仍依赖目标机 LibreOffice。
- 浏览器回退使用内存演示数据，合成拖放事件只验证前端状态和队列入口，不验证 Tauri 原生路径传递、文件系统写入或真实窗口 DPI 行为。
- `xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险仍按发布边界保留；本阶段没有扩大依赖或改变原文件操作权限。

#### 下一步

- 阶段 F 原生验收和文档收口已完成，五个版本入口已统一为 `0.3.32`，并已按发布流程完成 Tag/Release 门禁。

#### 涉及文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`
- `prototype/src/features/floating-ball/useFloatingBallRecords.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/useFloatingBallDrag.js`
- `prototype/src/features/floating-ball/useFloatingBallWindowGeometry.js`
- `prototype/src/styles.css`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/tests/floating-ball-model.test.mjs`
- `AGENT.md`、`PROJECT_PLAN.md`、`PROJECT_PROGRESS.md`、`README.md`、`prototype/README.md`
- `prototype/package.json`、`prototype/package-lock.json`、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml`、`prototype/src-tauri/Cargo.lock`

#### 验证

- `npm.cmd run test:floating-ball`：28 项通过；覆盖状态机、几何/DPI 模型、文件库分页、Windows 路径去重、旧请求/旧 revision 和拖放反馈。
- `npm.cmd run test:library`：23 项通过；`npm.cmd run test:contracts`：16 项通过。
- `npm.cmd run build`：通过，生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；Vite 既有大 chunk 警告未阻断构建。
- 浏览器回退：默认演示列表 11 项；快速搜索后最终为 5 项并可恢复为 11 项；收藏筛选为 2 项；360px 视口面板压缩为 280px，`body`、面板和列表无横向溢出；合成拖放显示“松开以登记文件或文件夹”；reduced-motion 下 `transition-duration`/`animation-duration` 为近零；截图保存在 `prototype/output/playwright/phase-e-floating-ball-1280.png` 和 `prototype/output/playwright/phase-e-floating-ball-360.png`，只使用演示数据。
- `cargo fmt --all -- --check`、`cargo check --locked`、`cargo test --locked`：77 项通过；`cargo clippy --all-targets --all-features --locked -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.31_x64-setup.exe`；安装器 `8,809,529` bytes，SHA-256 `0C04FF446E34FE0989004F1AB7C8A9CA0832AA49A09F7AFF73C58578FA31B7BE`。
- release 主程序 `prototype/src-tauri/target/release/local-material-workbench.exe`：`35,638,426` bytes，FileVersion/ProductVersion `0.3.31`，SHA-256 `07BE128FF76A1AF006E81F89CFFC37E749571508274287E68924D4A21A5E642D`。
- `WebView2Loader.dll`：`160,320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；`verify-webview2-loader.mjs` 确认 loader 与 release 主程序同目录，目标架构为 Windows x64。临时 Vite 服务、Playwright 浏览器会话已关闭，49217 端口已释放。

## 2026-09-02

### 阶段 D：主窗口连续工作流和四项快捷操作（0.3.30 代码候选）

#### 已完成

- 按当前 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 D：悬浮球文件行主操作通过 `open_main_from_floating` 将文件定位到主窗口，将文件夹进入主窗口目录视图；主窗口清除会阻塞目标的搜索/筛选条件，按当前列表计算目标页并滚动到目标行。
- 扩展 `floating-open-file` 事件为白名单动作 `locate`/`preview`；悬浮球主行点击使用定位意图，直接预览按钮使用预览意图，托盘最近任务显式保留预览意图，旧事件缺少动作时兼容为定位。
- 复用主窗口既有 `PreviewPane`、预览资源协议和失败状态；悬浮球不复制格式判断、文件读取或渲染逻辑，支持格式、不支持格式、失效、权限、过大和转换器缺失均沿用既有状态与下一步。
- 文件行通过三个点快捷菜单提供直接预览和“在资源管理器中显示”；定位调用已有 `reveal_indexed_file(fileId)`，浮窗 capability 只增加该实际使用的权限，菜单事件阻止行点击冒泡并以 busy 状态防止重复外部操作。
- 主窗口目录导航增加异步请求序号、目录错误、重试/返回资料库入口；失效或不可访问文件夹不会落入空目录。悬浮球打开事件增加请求序号，旧的索引读取结果不能覆盖较新的操作。
- 根据用户截图反馈，将每行原先并排显示的预览/资源管理器/收藏按钮改为单个三个点触发器；菜单固定定位、自动聚焦首项、支持 Escape/外部点击关闭，菜单动作不会冒泡为行定位。
- 修复悬浮球主窗口定位和直接预览时序：预览意图随 `focusRequest` 在搜索/筛选清理、目标页切换和滚动完成后消费；主窗口打开事件先发送再收起悬浮窗，避免收起失败取消定位或预览。
- 新增截图对照记录 `design-qa.md`；闭合态与展开态均使用 `424 x 420` 视口验证，确认菜单动作、焦点返回、外部点击关闭和窄视口边界行为。
- 修复主窗口最小化或仅驻留系统托盘时的悬浮球打开失败：`open_main_from_floating` 统一复用 `show_main_window`，先显示窗口、取消最小化并设置焦点，再投递定位/预览事件。
- 五个版本入口已统一到 `0.3.30`：前端 package、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock 本地 package。

#### 进行中

- 无；阶段 D 代码、最小自动验证和浏览器回退检查已完成，已进入 `0.3.30` 安装包候选构建与 Windows 原生验收准备。

#### 用户验收

- Windows 11/Tauri/WebView2 原生安装、主窗口显示/聚焦、目标行滚动、文件夹目录读取、资源管理器真实启动、文本/Markdown/图片/Office/PDF 直接预览、失败恢复、快速连续打开、托盘行为、重启和卸载仍需用户安装候选后单独确认；代理未将浏览器检查或构建成功当作原生验收。

#### 阻塞与风险

- 安装包未签名且不内置 WebView2 Runtime；目标 Windows 11 机器需要已有 WebView2。DOC 预览继续依赖目标机 LibreOffice。
- 浏览器回退只使用无敏感演示数据，不执行真实 Tauri IPC、文件系统访问、资源管理器或预览资源加载；真实外部程序和桌面窗口行为仍属于用户验收边界。

#### 下一步

- 安装 `0.3.30` x64 NSIS 候选，使用 `tests/fixtures/` 中的测试文件逐项验证文件定位、文件夹目录、资源管理器显示、直接预览和失败恢复；确认无回归后进入阶段 E `0.3.31`。

#### 涉及文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`、`FloatingBallPanel.jsx`、`floatingBallApi.js`
- `prototype/src/features/library/useLibraryNavigation.js`、`useLibraryActions.js`、`LibraryPanel.jsx`、`libraryModel.js`
- `prototype/src/App.jsx`、`prototype/src/lib/ipcContracts.js`、`prototype/src/lib/ipcContracts.d.ts`、`prototype/src/styles.css`
- `prototype/src-tauri/src/commands/floating_ball.rs`、`src-tauri/src/windows/tray.rs`、`src-tauri/capabilities/floating.json`、生成的 capability schema
- `prototype/tests/floating-library-actions.test.mjs`、`tests/ipc-contracts.test.mjs`、版本入口和项目文档
- `design-qa.md` 及本地可视化截图

#### 验证

- `npm.cmd run test:contracts`：16 项通过，覆盖浮窗动作事件和外部结果契约。
- `npm.cmd run test:library`：23 项通过，覆盖目标页模型以及现有资料库导航、目录、键盘和筛选模型。
- `npm.cmd run test:floating-ball`：26 项通过，包含新增动作模型测试。
- `npm.cmd run test:preview`：15 项通过；新增动作模型另行由悬浮球测试覆盖。浏览器回退在默认和 `360 x 760` 视口检查了三类快捷按钮、事件隔离、面板保持打开、body/panel 横向溢出为 0，控制台错误为 0。
- `cargo fmt --all -- --check`、`cargo check --locked`：通过；`cargo test --locked`：77 项通过。
- `npm.cmd run build`：通过，生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；Vite 既有大 chunk 警告未阻断构建。
- `npm.cmd run tauri:build`：通过，生成包含托盘/最小化恢复修复的最终 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.30_x64-setup.exe`，大小 `8818791` bytes，SHA-256 为 `3254FB5A708AA0D49957E820F467B8868A0ECFD650BE13C3BD781C11DA383AA2`。
- release 主程序 `prototype/src-tauri/target/release/local-material-workbench.exe`：`35643130` bytes，FileVersion/ProductVersion `0.3.30`，SHA-256 为 `CE4792D107D885A15E754F871D817D7FDA59DC6FCAE7A37843A717C1C3AA4FCF`。
- `WebView2Loader.dll`：`160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；`verify-webview2-loader.mjs` 确认 loader 与 release 主程序同目录、目标架构为 Windows x64。未执行远程推送、Tag 或 GitHub Release。

## 2026-09-02

### 阶段 C：文件列表、搜索、筛选和排序（0.3.29 代码候选）

#### 已完成

- 按当前 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 C：悬浮球面板主数据改为 `files` 文件库语义，不再使用 `get_floating_recent` 或 `getRecentEntries` 限制主列表。
- 修复 `get_floating_files` 的 Tauri 参数封装：Rust command 的 `query: FloatingFilesQuery` 现在收到 `{ query: normalizedQuery }`，不再把内部搜索字符串误当作结构体参数。
- 新增 `useFloatingBallFiles` 查询 Hook，统一管理当前搜索词、筛选、排序、方向、页码、总数、revision、加载/刷新/错误状态和过期请求丢弃；搜索输入限制为 256 个字符并使用 180ms 防抖。
- 面板接入“全部、收藏、文件夹、失效”四项筛选，名称/类型/修改时间/最近打开四项排序和升降序切换；分页固定为每页 20 条，列表滚动容器独立于主窗口。
- 文件行补充文件/文件夹图标、名称省略、类型、大小、分组、修改时间、失效状态和收藏忙碌态；文件夹不显示误导性的文件大小。
- 空文件库提供打开主窗口资料库入口，搜索/筛选无结果提供清除入口；查询错误保留明确重试操作，收藏和拖放刷新保留当前查询上下文。
- 浏览器回退演示数据扩展为 11 条无敏感信息样本，覆盖普通文件、文件夹、收藏、失效、同名、空格文件名、长中文文件名及多种类型；浏览器模式仍不访问真实本地文件。
- 按 `AGENT.md` 的单一职责边界拆分 `useFloatingBallRecords.js`、`useFloatingBallFiles.js` 和 `floatingBallDemoData.js`，没有修改 `get_floating_files` 的 Rust/IPC 返回契约。
- 五个版本入口已统一到 `0.3.29`：前端 package、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock 本地 package。

#### 进行中

- 无；阶段 C 代码、最小自动验证、浏览器回退检查和 Windows x64 NSIS 候选构建已完成。

#### 用户验收

- Windows 11/Tauri/WebView2 原生安装、首次启动、真实索引查询、超过 20 条分页、中文/空格/同名路径、真实收藏失败、重启恢复和卸载仍需用户安装候选后单独确认；代理未将浏览器检查或构建成功当作原生验收。

#### 阻塞与风险

- 安装包未签名且不内置 WebView2 Runtime；目标 Windows 11 机器需要已有 WebView2。
- 阶段 D 的文件定位、文件夹目录、资源管理器显示和直接预览快捷入口尚未实现；阶段 C 的文件行主点击仍沿用现有主窗口打开入口。
- 浏览器回退没有真实 Tauri IPC、文件系统拖放或外部程序副作用；收藏失败分支已保留受控错误路径，但未在本轮注入原生故障。

#### 下一步

- 用户安装 `0.3.29` x64 候选，按阶段 C 验收矩阵检查真实文件库全量列表、搜索、筛选、排序、分页、收藏和重启恢复；确认无回归后进入阶段 D `0.3.30`。

#### 涉及文件

- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/src/features/floating-ball/floatingLibraryModel.js`
- `prototype/src/features/floating-ball/floatingBallDemoData.js`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`
- `prototype/src/features/floating-ball/useFloatingBallRecords.js`
- `prototype/src/styles.css`
- `prototype/tests/floating-library-model.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`
- `README.md`、`prototype/README.md`、`PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:floating-ball`：24 项通过，覆盖悬浮状态机、文件库查询模型、搜索输入边界、显示格式和 50/51 条分页边界。
- 参数封装修复回归断言已加入 `floating-library-model.test.mjs`，确认 command 参数同时保留 `query` 字段和完整查询对象。
- `npm.cmd run test:contracts`：15 项通过，覆盖既有 IPC/索引控制契约和文件库安全投影契约。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；Vite 保留既有大 chunk 非阻断警告。
- 浏览器回退检查：默认视口展示 11 条样本；搜索、清除搜索、收藏筛选、修改时间降序、收藏成功反馈、无结果状态均正常；默认及 360px 窄视口无横向溢出，列表保持内部滚动。
- `git diff --check`：通过；临时浏览器服务和标签已关闭，构建产物未进入工作树。
- `npm.cmd run tauri:build`：通过，完成 Rust release 编译、Windows x64 NSIS 打包和 `verify-webview2-loader.mjs` 校验。
- NSIS 安装包：`prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.29_x64-setup.exe`，`8,815,611` bytes，SHA-256 `725F38BD3F7F303030949AB7F0E72E507854AB3E7A319FE73314CF6F85CAAA88`。
- release 主程序：`prototype/src-tauri/target/release/local-material-workbench.exe`，`35,640,830` bytes，FileVersion/ProductVersion `0.3.29`，SHA-256 `DAC4BFA9402E94F843284979B5E850642D52E8C711DED440A5EE7D1E9A8FFA1D`。
- `WebView2Loader.dll`：`160,320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；loader 与 release 主程序同目录，校验目标为 Windows x64。

### 阶段 B：悬浮球外观和文件库面板骨架（0.3.28 代码候选）

#### 已完成

- 按当前 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 B：悬浮球普通状态改用文件堆语义图标，拖入状态使用下载图标，记录中使用旋转图标，并为普通、靠近、拖入、记录中、成功、部分成功、失败和移动状态分别提供颜色、外环和反馈标记。
- 新增文件库数量读取：悬浮球和面板分别显示当前总数，加载中显示稳定的旋转状态，读取失败显示错误标记，超过 `999` 项时显示 `999+`，数量展示不改变球体命中区域。
- 面板标题从“最近记录”改为“文件库”，默认尺寸从 `320 x 322 DIP` 调整为 `360 x 420 DIP`；几何模型继续使用 DIP 计算、物理像素调用 Tauri，并在工作区不足时按安全最小值压缩。
- 面板建立独立的标题区、查询/筛选占位区、反馈区、列表区、加载骨架、空列表、空搜索结果和查询错误状态；列表行保留稳定最小高度、图标槽位、文本省略和收藏动作。
- 浏览器回退在 `1280px`、`680px` 和 `360px` 视口下使用响应式面板宽度，窄视口仍保持列表内部滚动；现有悬停状态机、拖动、键盘焦点、左右展开和球体锚点行为未改动。
- 五个版本入口已统一到 `0.3.28`：前端 package、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock 本地 package。

#### 进行中

- 无；阶段 B 代码、定向自动验证、浏览器回退检查和 Windows x64 NSIS 候选构建已完成。

#### 用户验收

- Windows 11/Tauri/WebView2 原生安装、首次启动、透明置顶窗口、真实拖放、混合 DPI、边缘展开/收起、重启恢复和卸载本轮未由代理执行；候选仍需用户安装后单独验收。

#### 阻塞与风险

- 浏览器回退和成功构建不能替代 Windows 原生窗口、真实文件系统 command、系统拖放、托盘和多显示器行为验收。
- 安装包未签名且不内置 WebView2 Runtime；DOC 预览继续依赖目标机 LibreOffice，其他既有格式依赖边界不变。

#### 下一步

- 用户安装 `0.3.28` 候选后按阶段 B 验收矩阵检查悬浮球状态、数量同步、左右/四角展开、DPI 和窗口生命周期；无具体回归后进入阶段 C `0.3.29` 的完整文件库列表、搜索、筛选、排序和分页。

#### 涉及文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`、`FloatingBallPanel.jsx`、`floatingBallModel.js`、`floatingBallGeometryModel.js`、`useFloatingBallRecords.js`
- `prototype/src/styles.css`、`prototype/tests/floating-ball-model.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml`、`src-tauri/Cargo.lock`
- `README.md`、`prototype/README.md`、`PROJECT_PLAN.md`、`PROJECT_PROGRESS.md`

#### 验证

- `npm.cmd run test:floating-ball`：22 项通过，覆盖悬浮状态机、数量徽标状态、默认 `360 x 420` 几何、四角/工作区压缩、DPI 转换和文件库查询模型。
- `npm.cmd run build`：通过，生成 Sites 所需的 client/server/hosting 产物；构建输出的既有大 chunk 警告未形成阻断。
- `cargo fmt --all -- --check`：通过；`npm.cmd run tauri:build` 完成 Rust release 编译、Windows x64 NSIS 打包和 loader 校验。
- Microsoft Edge 浏览器回退检查：`1280px` 和 `680px` 面板为 `360 x 420`，`360px` 面板压缩为 `280 x 420`；三种视口 `body.scrollWidth` 均等于视口宽度，列表 `scrollWidth` 与 `clientWidth` 一致；成功拖放演示进入 `recorded` 状态并显示成功标记，控制台错误为 0。
- `git diff --check`：通过；临时浏览器服务、会话和截图已关闭/移出仓库。
- NSIS 安装包：`prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.28_x64-setup.exe`，`8,814,984` bytes，SHA-256 `4F3661F61906F4473DA8FDEB938F36B7B87194A2AADB253EA2853AB712F55DBE`。
- release 主程序：`prototype/src-tauri/target/release/local-material-workbench.exe`，`35,655,225` bytes，SHA-256 `CDB35D98B54043B3ADBA47C79174C2463E5D2AB20EA9868530E7FDAB7473D2ED`；`WebView2Loader.dll` 为 `160,320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与主程序同目录且校验为 Windows x64。

### 阶段 A：悬浮球文件库数据契约和查询模型（0.3.27 代码候选）

#### 已完成

- 按当前 `AGENT.md` 和新的 `PROJECT_PLAN.md` 完成阶段 A：新增独立的 `get_floating_files` command，不改变 `get_floating_recent` 的最近五项语义。
- Rust 从索引快照投影文件库所需的安全元数据：不透明资料 ID、名称、类型、文件/文件夹/其他类型、状态、失效标记、收藏、文件大小、修改时间、最近打开时间和有效分组名称；不返回完整路径、正文、缩略图、命令行或外部程序输出。
- 查询请求支持名称/类型/标签/分组元数据搜索、`all`/`favorite`/`folder`/`invalid` 白名单筛选、`name`/`type`/`modifiedAt`/`lastOpenedAt` 白名单排序、方向和受控分页；搜索词最多 256 个字符，分页数量最多 100，结果使用 ID 进行确定性次排序并去重。
- 前端增加 `getFloatingFiles` API、严格的 `parseFloatingFilesResult` 响应解析器、文件库查询模型和 TypeScript 契约；解析器拒绝缺少 revision/items/total 等字段、重复 ID、非法 kind、禁止路径/正文字段和不一致的 `hasMore`。
- 新 command 已接入 Tauri handler、floating capability、自动生成权限和 schema；`0.3.27` 已同步到前端 package、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock。

#### 进行中

- 无；阶段 A 代码、自动验证、Windows x64 NSIS 候选构建和 loader 核验已完成。

#### 用户验收

- Windows 11/Tauri/WebView2 原生安装、启动、真实索引查询、中文/空格文件名和重启后的文件库行为尚未由用户在本机确认；本轮不以浏览器回退或构建成功替代该验收。

#### 阻塞与风险

- 当前悬浮球界面仍显示既有“最近记录”面板；文件库标题、数量徽标、完整列表和交互接入属于阶段 B/C，不能将 `0.3.27` 描述为已经完成这些界面功能。
- 浏览器回退只可验证前端查询模型和契约，不能执行真实 Tauri command、app data 索引刷新或 Windows 桌面窗口行为。
- 安装包未签名且不内置 WebView2 Runtime；DOC 预览仍依赖目标机 LibreOffice，既有 `xlsx@0.18.5` 风险保持不变。

#### 下一步

- 进入阶段 B `0.3.28`：在保持透明窗口、拖拽、边缘吸附和悬停状态机兼容的前提下，接入文件库数量徽标、文件库标题和稳定面板骨架；同时保留本阶段的独立查询契约。
- 用户安装本候选后，使用已登记但未从悬浮球拖入的资料、文件夹、收藏项和失效项验证真实文件库 command 返回与 revision；在 Windows 原生验收完成前不创建 Tag、Release 或推送远程。

#### 涉及文件

- `prototype/src-tauri/src/storage/floating_files.rs`、`storage/mod.rs`、`commands/floating_ball.rs`、`src/lib.rs`、`build.rs`
- `prototype/src-tauri/capabilities/floating.json`、`permissions/autogenerated/get_floating_files.toml`、`gen/schemas/`
- `prototype/src/features/floating-ball/floatingBallApi.js`、`floatingLibraryModel.js`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`
- `prototype/tests/floating-library-model.test.mjs`、`ipc-contracts.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`README.md`、`prototype/README.md`、`PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:floating-ball`：21 项通过，包含新增文件库模型测试和既有悬浮球状态/几何测试。
- `npm.cmd run test:contracts`：15 项通过，包含文件库返回契约、禁止路径字段和重复 ID 检查。
- `cargo fmt --all -- --check`、`cargo test --locked floating_files`：格式检查通过，Rust 文件库查询测试 2 项通过；`cargo check --locked` 和 `cargo clippy --locked --all-targets --all-features -- -D warnings` 通过。
- `npm.cmd run build` 和 `npm.cmd run tauri:build` 通过；Sites 产物已生成，Tauri 已生成 Windows x64 NSIS 安装包并完成 loader 核验。
- 安装包 [`本地资料工作台_0.3.27_x64-setup.exe`](E:/Project/test/prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.27_x64-setup.exe) 大小 `8813922` bytes，SHA-256 `B35784E0F684D5C1CBE0ABD2A455FD3F9047AEDE466048D1FD3149B74678F3A4`；release 主程序大小 `35650393` bytes，SHA-256 `1DD2717541E45D5D2BF57D92B5EC3F2CEAC62C509690674899A405871C0F496F`。
- `WebView2Loader.dll` 与主程序位于同一 release 目录，大小 `160320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，目标架构为 Windows x64。

## 2026-09-02

### 阶段 J：本地全文检索与正则（0.3.26 已发布）

#### 已完成

- 按 `AGENT.md` 和 `PROJECT_PLAN.md` 完成阶段 J：新增独立的 `content-index.json` 正文索引，不改变 `index.json` 元数据格式；启动、导入、刷新和索引 revision 变化后由后台任务按文件路径、大小和修改时间增量同步。
- 正文范围按共享 `file-types.json` 的 `kind` 判断，覆盖 `text` 和 `markdown` 纯文本内容，包括代码、JSON、配置和 Markdown，不把能力限定为 `.txt`；DOCX、PDF、XLSX、图片和视频不抽取正文。
- 新增 Rust `content_index`/`content_search` 存储模块和 `regex` 依赖：采用原子 JSON 写入、2 MiB 单文件、64 MiB 总正文、1,000,000 字符、20,000 条记录和 60 秒重建限制；损坏索引独立进入恢复状态并保留备份，不阻塞元数据索引启动。
- 新增元数据/正文搜索范围切换和正则开关；正文搜索由 Rust `regex` 线性时间引擎执行，限制表达式长度、正则程序大小、单文件命中数和摘要长度，结果只返回不透明资料 ID、命中数、短摘要和高亮范围。
- 搜索结果继续叠加现有导航、收藏、失效路径、类型、标签、分组和目录上下文；正文命中显示命中字段、摘要和安全 React 文本高亮，不写入日志、toast、URL、操作历史或诊断导出。
- 设置面板新增正文索引状态、条目数、占用大小、失败数、重建、取消和清除入口；重建使用现有批量取消机制，失败后可再次重建。
- 新增正文 IPC command、前端契约、Tauri capability 和自动生成权限/schema，版本入口已统一到 `0.3.26`；已创建 `v0.3.26` Tag、发布 GitHub Release，并同步 `origin/main` 与 `origin/dev`。

#### 进行中

- 无；代码实现、自动测试、前端构建、Windows x64 NSIS 候选构建和用户 Windows 11/Tauri/WebView2 原生验收均已完成。

#### 用户验收

- 2026-09-02，用户确认当前 `PROJECT_PLAN.md` 的阶段 A-J 已全部实现并完成 Windows 11/Tauri/WebView2 原生验收，覆盖真实文件导入与预览、重启恢复、长路径、正文检索、正则、清除/重建、取消和大规模使用场景，以及各阶段列出的窗口、托盘、悬浮球、外部操作、元数据、操作历史、DOCX 和递归导入流程。

#### 阻塞与风险

- 浏览器回退模式不调用正文索引 command，只能验证元数据搜索控件和前端空状态；它仍不能替代桌面端真实文件读取、app data 持久化和 WebView2 验收，本轮原生验收已由用户单独完成。
- 正文索引会为已登记的纯文本和 Markdown 生成本地内容缓存，仍受单文件/总大小限制；解析失败、编码无法识别、权限拒绝和超限文件会计入失败状态并从可搜索正文中排除。
- 当前未对 DOCX、PDF、XLSX 做正文抽取；安装包仍未签名、不内置 WebView2 Runtime，DOC 预览仍依赖目标机 LibreOffice，`xlsx@0.18.5` 既有依赖风险不变。

#### 下一步

- 阶段 J 收口时没有待执行阶段；随后已按新的悬浮球“文件库”计划进入阶段 A `0.3.27`，当前阶段记录见本文件顶部。
- `v0.3.26` 已完成 Tag、GitHub Release 和分支同步；新的 `0.3.27` 仅为阶段 A 代码候选，未创建 Tag、Release 或远程同步。

#### 涉及文件

- `prototype/src-tauri/src/storage/content_index.rs`、`content_search.rs`、`commands/mod.rs`、`lib.rs`、`build.rs`、`capabilities/default.json`
- `prototype/src/features/library/useContentIndexController.js`、`LibraryPanel.jsx`、`LibraryPanelParts.jsx`、`libraryModel.js`、`libraryRepository.js`
- `prototype/src/features/settings/SettingsPanel.jsx`、`prototype/src/styles.css`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`、`prototype/tests/content-search-model.test.mjs`、`content-index-contracts.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`PROJECT_PLAN.md`、`README.md`、`prototype/README.md`

#### 验证

- `npm.cmd run test:content`：5 项通过；`npm.cmd run test:library`：21 项通过；`npm.cmd run test:contracts`：14 项通过。
- `cargo test content`：5 项正文索引/正则测试通过；完整 `cargo test --locked --lib`：75 项通过；`cargo fmt --check` 和 `cargo clippy --locked --all-targets --all-features -- -D warnings` 通过。
- `npm.cmd run build` 通过并生成 Sites 产物；Tauri 自定义 command 权限/schema 已由 `cargo check` 重新生成，`npm.cmd run tauri:build` 和内置 loader 核验通过。
- 已生成安装包 [`本地资料工作台_0.3.26_x64-setup.exe`](E:/Project/test/prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.26_x64-setup.exe)，大小 `8790936` bytes，SHA-256 `B6C4E602B64FD46FCF8E960ACC214D2158E76DBB5E641EFAE40877B93380FA1B`；release 主程序大小 `35541231` bytes，SHA-256 `B1CA0A2C039621640DA56FDEE4585BDC8D307DD56B9FAB62503513656F6D167E`。
- `WebView2Loader.dll` 与主程序同目录，大小 `160320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；loader 目标架构为 Windows x64。

## 2026-09-02

### 文件夹子项预览解析修复（0.3.25 修订候选）

#### 已完成

- 修复登记文件夹内普通文件无法预览的问题：目录子项预览目标仍使用不透明 `directoryId` 和受控 `relativePath`，但 Rust `resolve_preview_target` 误调用了只允许目录的解析函数，导致文件子项在预览前被拒绝。
- 目录子项预览现在复用已登记目录子项的通用安全解析，并继续由文件类型注册表确认预览类型；目录浏览解析仍保持只接受文件夹的原有行为。
- `can_preview` 和 `load_preview` 共享该修复路径，覆盖预览检查与实际加载；未开放任意本地路径访问。
- 已重新构建 `0.3.25` Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.25_x64-setup.exe`，大小 `8738373` bytes，SHA-256 为 `6F57EA4035B963EE35674ED9DFDEE2524016B6BA26965B87E86F853507EFB39A`；loader 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`。

#### 进行中

- 代码回归、契约/预览测试、Rust 编译检查、clippy、前端构建和安装包构建已完成；等待用户在 Windows 11/Tauri/WebView2 环境安装修订候选，实际打开已登记文件夹中的文件确认预览。

#### 阻塞与风险

- 浏览器回退不会执行真实 Tauri 目录子项解析、文件读取或 WebView2 预览；本次修复未由浏览器回退代替 Windows 原生验收。
- 安装包未签名且不内置 WebView2 Runtime；DOC 预览仍依赖 LibreOffice，其他既有外部依赖边界不变。

#### 下一步

- 用户安装新的 `0.3.25` NSIS 包，选择一个已登记文件夹，进入子目录并分别打开 TXT、Markdown、图片、PDF 或 Office 文件，确认预览、切换和关闭行为；记录失败样本后再决定是否需要下一轮修复。

#### 验证

- `npm.cmd run test:contracts`：14 项通过，包含目录子项预览目标回归测试；`npm.cmd run test:preview`：15 项通过。
- `cargo fmt --all -- --check`、`cargo check --locked`、`cargo clippy --locked --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build` 和 `verify:loader`：通过，生成并校验上述修订版安装包。

### 阶段 I：递归导入和导入策略（0.3.25 代码候选）

#### 已完成

- 文件夹选择后默认打开“登记文件夹 / 导入文件夹内资料”策略对话框；默认登记只保存文件夹本身，原有目录按需浏览行为保持不变。
- 递归模式明确显示扫描范围、支持格式范围、隐藏/系统项排除规则、最大递归深度和最大登记条目，并说明取消、超时和部分完成语义。
- Rust 新增受限递归扫描器和 `import_folders_recursive` command：每个目录项重新执行 `symlink_metadata`、canonical、普通文件类型、权限和导入根边界校验；不跟随符号链接、Windows reparse point 或目录外跳转。
- 扫描限制包括 64 层后端深度上限、20,000 个候选条目、80,000 个扫描节点、32 KiB 路径长度、受限待扫描队列和 30 秒单任务截止时间；扫描不会读取正文或修改用户原文件。
- 扫描通过 `recursive-import-progress` 事件报告检查项、候选文件、准备项、跳过数和当前文件名；取消/超时保留已扫描候选，索引只在扫描结束后一次原子合并，避免半写状态。
- 重复根目录和重复路径会跳过；已有索引路径由现有 merge 逻辑保留 ID、收藏、标签、分组、添加时间、预览状态和最近记录元数据。结果中心记录扫描摘要、跳过原因和当前会话重试入口，不把完整路径写入操作历史。
- 版本入口已统一为 `0.3.25`，同步前端 package、package-lock、Tauri 配置、Rust crate、Cargo.lock、IPC 契约、权限声明和生成 schema。
- `npm.cmd run tauri:build` 已生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.25_x64-setup.exe`，大小 `8735546` bytes，SHA-256 为 `FB968D3F7E6A7DD36EA5130359025FB7D2542544A01D8D05743A8BA6E532582C`；`WebView2Loader.dll` 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序位于同一目录。

#### 进行中

- 无；阶段 I 的代码门禁、文档同步和 `0.3.25` NSIS 候选构建已完成，等待用户执行 Windows 原生验收。

#### 阻塞与风险

- 浏览器回退不会执行真实 Tauri 文件夹选择器、文件系统扫描、取消 command、索引持久化或重启恢复；浏览器布局检查不能替代桌面验收。
- 递归扫描默认只导入共享 manifest 中已有预览格式；用户勾选“包含暂不支持预览的普通文件”后才会登记其他普通文件。扫描限制达到时只保留已完成部分并提供重试入口。
- 安装包不签名且不内置 WebView2 Runtime；DOC 预览仍依赖目标机 LibreOffice，既有 `xlsx@0.18.5` 依赖风险保持不变。本阶段没有新增 npm、Rust 或系统运行时依赖。

#### 下一步

- 用户安装候选后验证默认登记与递归导入选择、中文/空格/深层路径、隐藏项、同名文件、取消/超时、重启恢复、权限拒绝、符号链接/reparse point 和长路径显示；未完成前不创建 Tag、Release 或推送远程。

#### 涉及文件

- `prototype/src-tauri/src/filesystem/recursive_import.rs`、`filesystem/mod.rs`、`commands/mod.rs`、`src/lib.rs`、`build.rs`、`capabilities/default.json`、`permissions/autogenerated/import_folders_recursive.toml`
- `prototype/src/features/library/ImportFolderDialog.jsx`、`recursiveImportModel.js`、`libraryRepository.js`、`useLibraryActions.js`、`prototype/src/App.jsx`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`、`prototype/src/features/operations/OperationCenter.jsx`、`operationModel.js`、`styles.css`
- `prototype/tests/fixtures/recursive-import/`、`recursive-import-model.test.mjs`、`ipc-contracts.test.mjs`、`operation-model.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/tauri.conf.json`、`Cargo.toml`、`Cargo.lock`、`README.md`、`prototype/README.md`、`PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:library`：21 项通过；`npm.cmd run test:contracts`：13 项通过；`npm.cmd run test:operations`：3 项通过。
- `npm.cmd run build`：通过，继续生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --all`、`cargo test --locked --lib`：70 项通过；`cargo check --locked`：通过。
- Microsoft Edge 浏览器回退检查：1280px 与 360px 页面 `body/root scrollWidth` 均等于视口宽度；临时 Vite 服务和浏览器标签已关闭。
- `cargo clippy --locked --all-targets --all-features -- -D warnings`、`npm.cmd run tauri:build` 和 `verify:loader`：通过；安装器启动/卸载和 Windows 11 原生手工验收仍待用户执行。

### 阶段 H：DOCX 和大型预览性能（0.3.24 代码候选）

#### 已完成

- DOCX 预览已从前端主线程 Mammoth 转换改为可终止的 `docxWorker.js`；资源下载仍由 `AbortController` 管理，Worker 在关闭、切换、取消、失败和超时路径统一终止。
- DOCX 解析过程显示读取、后台转换、HTML 清理和耗时提示；用户可在解析期间取消，30 秒截止后返回显式 `timed-out` 状态，已有失败页继续提供重试、默认程序打开和返回列表等下一步。
- Worker 转换结果和主线程清理结果均受 8 MiB HTML、50,000 个元素限制；源文件继续受共享 manifest 的 20 MiB 限制。HTML 仍经过 DOMPurify，脚本、外链、嵌入对象和宏不进入预览。
- HTML 清理按顶层节点分批执行并在批次间检查取消信号；预览资源由 `PreviewPane` 既有 dispose 路径释放，XLSX 与 DOC/DOCX 超时状态统一为 `timed-out`。
- 依赖评估确认没有新增 npm、Rust 或系统运行时依赖；Mammoth、DOMPurify、Vite、Tauri、WebView2 和 Office 容器边界仍使用现有锁定版本。版本入口已统一到 `0.3.24`。
- `npm.cmd run tauri:build` 已生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.24_x64-setup.exe`，大小 `8719181` bytes，SHA-256 为 `17407CEBCF4A25E2CB45F01A07A47BE7953F3159B2B7486145DD5C2A0D0A83E3`；loader 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`。

#### 性能基线

- 使用 Mammoth `1.12.2` 自带的无敏感 `single-paragraph.docx`、`tables.docx` 和 `tiny-picture.docx`，以 Node 侧原实现测量原始、2 MiB、10 MiB、20 MiB 输入；2/10/20 MiB 的转换耗时分别约为：单段落 `16.94/24.77/38.21 ms`，复杂表格 `10.75/55.94/108.21 ms`，图片 `11.85/25.13/40.52 ms`。
- 这些输入通过安全夹具尾部填充得到，主要反映资源读取和转换边界，不等同于真实复杂 DOCX；RSS 增量受 GC 影响不稳定，浏览器 WebView2 的主线程内存曲线和真实取消响应仍由 Windows 手工验收补充。

#### 进行中

- 无；阶段 H 代码门禁、文档同步、版本统一和 Windows x64 NSIS 候选构建已完成。不创建 Tag、Release 或推送远程。

#### 阻塞与风险

- 浏览器回退和开发侧命令不能替代 Windows 11/WebView2 下真实 DOCX 的 Worker 取消、超时、关闭、快速切换、输出过大、损坏/加密文档和安装后资源清理验收。
- 安装包不签名且不内置 WebView2 Runtime；DOC 仍依赖目标机 LibreOffice。`xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险未消失，本阶段未扩大其解析权限。

#### 下一步

- 由用户安装 `0.3.24` NSIS 候选，使用无敏感 DOCX 夹具记录 Windows 11/Tauri/WebView2 的后台转换、取消、超时、关闭、快速切换和资源释放结果。
- 桌面验收无具体阻断后，按计划进入阶段 I 的递归导入和导入策略工作。

#### 涉及文件

- `prototype/src/features/preview/OfficePreviewer.jsx`
- `prototype/src/features/preview/docxWorker.js`
- `prototype/src/features/preview/docxRenderModel.js`
- `prototype/src/features/preview/previewSecurity.js`
- `prototype/src/features/preview/SpreadsheetPreviewer.jsx`
- `prototype/src/features/preview/previewTypes.js`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`
- `prototype/src-tauri/src/preview/mod.rs`、`preview/loaders.rs`
- `prototype/tests/docx-preview-model.test.mjs`
- `README.md`、`prototype/README.md`、`PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:preview`：15 项通过。
- `npm.cmd run test:contracts`：12 项通过。
- `cargo fmt --all -- --check`：通过；`cargo test --lib`：66 项通过。
- `npm.cmd run build`：通过，生成独立的 `docxWorker-*.js` 及 Sites 产物；`cargo check --locked`、`cargo clippy --locked --all-targets --all-features -- -D warnings`、`npm.cmd run tauri:build` 和 `npm.cmd run verify:loader`：通过。

## 2026-09-02

### 阶段 G：最近打开和悬浮球连续工作流（0.3.23 代码候选）

#### 已完成

- 索引格式从 v4 升级到 v5，`IndexEntry` 增加可选 `lastOpenedAt`；旧版本迁移前创建 recovery 备份，迁移写入失败时保留旧索引内容并进入已有恢复状态。
- 预览 command 只有返回 `ready` 且目标是有效主索引普通文件时才记录最近打开；默认程序打开 command 只有外部打开成功后才记录。失效资料、文件夹、预览失败和默认程序打开失败均不会伪造 `lastOpenedAt`。
- 主窗口新增“最近打开”导航，按 `lastOpenedAt` 倒序并限制最近 50 条；“最近添加”仍使用 `addedAt`，悬浮球和托盘仍使用 `lastRecordedAt` 的“最近记录”，各自的数量和空状态文案已区分。
- 最近打开的索引变更复用 `index-changed` revision 事件，主窗口、悬浮球和托盘沿用现有刷新路径；从悬浮球打开资料时，主窗口会直接定位并打开文件预览，文件夹记录会进入对应目录。
- 索引迁移和最近打开记录只保存元数据，不保存正文，不新增完整路径日志；版本入口已统一为 `0.3.23`，README、原型 README、计划和本进度已同步。

#### 进行中

- 阶段 G 代码、Rust/前端自动验证、文档同步和 `0.3.23` Windows x64 NSIS 安装包构建已完成；当前等待用户执行 Windows 11/Tauri/WebView2 原生验收。

#### 阻塞与风险

- 浏览器回退和开发侧测试不能验证 Tauri 原生预览、默认程序、托盘/悬浮球窗口焦点、Windows Shell 和真实升级路径；`0.3.23` 安装包仍需用户在 Windows 11/Tauri/WebView2 环境手工验收。
- 安装包不签名且不内置 WebView2 Runtime；DOC 预览仍依赖目标机 LibreOffice，`xlsx@0.18.5` 的既有依赖风险保持不变。

#### 下一步

- 用户安装候选后检查 v4 到 v5 迁移备份、最近打开排序/重启恢复、预览和默认程序成功/失败边界、托盘与悬浮球同步以及悬浮球到主窗口的连续工作流。
- 桌面验收无具体阻断后再进入阶段 H，不创建 Tag、Release 或推送远程。

#### 涉及文件

- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/filesystem/operations.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src/App.jsx`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/useLibraryNavigation.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryPanelParts.jsx`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`
- `prototype/tests/library-model.test.mjs`、`ipc-contracts.test.mjs`
- `prototype/package.json`、`package-lock.json`、`src-tauri/Cargo.toml`、`Cargo.lock`、`tauri.conf.json`
- `README.md`、`prototype/README.md`、`PROJECT_PLAN.md`

#### 验证

- `cargo fmt --all -- --check`：通过；`cargo check --locked`：通过；`cargo test --lib`：66 项通过。
- `npm.cmd run test:library`：19 项通过；`npm.cmd run test:contracts`：12 项通过。
- `npm.cmd run test:preview`：11 项通过；`npm.cmd run test:floating-ball`：17 项通过；`npm.cmd run test:tray`：3 项通过；`npm.cmd run test:sites`：4 项通过。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过；`npm.cmd run build`：通过，生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `npm.cmd run tauri:build`：通过，生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.23_x64-setup.exe`，大小 `8712755` bytes，SHA-256 为 `9AAD808A22E34EC38299E69DCA8427F69183D66722BCE5B80CBF6AFA3156D716`。
- `verify-webview2-loader.mjs`：通过；`WebView2Loader.dll` 大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序位于同一目录，目标架构为 Windows x64。

### 阶段 F：键盘、范围选择和响应式细节（0.3.22 代码候选）

#### 已完成

- 新增主窗口键盘动作模型并接入 `Ctrl+F` 搜索聚焦、`F5` 刷新索引、`Ctrl+O` 选择文件、`Ctrl+Shift+O` 选择文件夹和 `Ctrl+Z` 撤销；快捷键只绑定当前主窗口，输入框、选择框、内容编辑区和已有弹层不会抢占输入，也未引入系统级全局快捷键。
- 资料库复选框支持鼠标 Shift-click、键盘 Space/Shift+Space 的连续范围选择；范围按当前导航/搜索/类型/标签/分组/目录上下文计算，可跨分页，当前页全选和刷新保留规则不变。
- 预览 Dialog 支持左右方向键切换当前可见列表中的上一项/下一项；预览输入控件不会触发切换。完善 Dialog 焦点回收、筛选菜单和操作中心 Escape 关闭/触发点焦点返回。
- 收紧表格、状态文字和控件的对比度，保留 `prefers-reduced-motion`；360px 下保留“更多”入口和可滚动导航，设置、刷新、清除选择和 Dialog 内容仍可到达；等效 125%/150% CSS 视口未出现页面级横向溢出。
- 新增快捷键模型和范围选择模型测试，更新根 README、原型 README、计划和五个版本入口到 `0.3.22`。

#### 进行中

- 阶段 F 的代码候选、自动验证和安装包构建已完成；当前等待用户安装 `0.3.22` 候选并执行 Windows 11/Tauri/WebView2 原生验收。

#### 阻塞与风险

- 浏览器回退已验证页面布局、键盘状态、范围选择、预览切换和弹层焦点，但不能验证 Tauri 原生文件/文件夹选择器、真实索引刷新/撤销 command、无边框窗口拖动和 Windows Shell 行为。
- 阶段 F 不引入全局系统快捷键；安装包不签名且不内置 WebView2 Runtime，Windows 11/Tauri/WebView2 原生验收仍需用户安装候选后单独记录。

#### 下一步

- 由用户安装 `0.3.22` 候选，验证 Windows 11 下快捷键、原生选择器、无边框拖动、预览切换和退出边界。
- 根据具体桌面回归修复，或按计划进入阶段 G 的最近打开和悬浮球连续工作流。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src/features/library/LibraryPanelParts.jsx`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/components/Dialog.jsx`
- `prototype/src/features/operations/OperationCenter.jsx`
- `prototype/src/lib/keyboardModel.js`
- `prototype/tests/keyboard-model.test.mjs`
- `prototype/tests/library-model.test.mjs`
- `prototype/src/styles.css`
- `prototype/package.json`、`package-lock.json`
- `prototype/src-tauri/Cargo.toml`、`Cargo.lock`、`tauri.conf.json`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`

#### 验证

- `npm.cmd run test:library`：18 项通过，包含快捷键和连续范围选择模型。
- `npm.cmd run test:contracts`：12 项通过；`npm.cmd run test:preview`：11 项通过；`npm.cmd run test:sites`：4 项通过。
- 浏览器回退检查：预览左右键、鼠标 Shift-click、Space/Shift+Space、Ctrl+F、Dialog/菜单 Escape 和 360px 设置入口通过；1280px、960px、680px、360px 及等效 125%/150% CSS 视口的 document/body scroll width 均等于视口宽度。
- `npm.cmd run build`：通过，生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `npm.cmd run tauri:build`：通过，生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.22_x64-setup.exe`，大小 `8714321` bytes，SHA-256 为 `7FBAB2D42CAA79823BCA8DB4B412D0AAB2E70989DD92DBCD542DEAE23F3DBEC9`。
- `WebView2Loader.dll` 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序位于同一目录。

### 阶段 E：操作结果中心和设置一致性（0.3.21 代码候选）

#### 已完成

- 新增 `features/operations`：`OperationRecord` 前端模型、操作历史 API、持久化队列和操作中心；导入、刷新、单条收藏/标签/分组/重命名/索引移除、批量收藏/标签/分组/索引移除和撤销均会显示进行中及最终结果。
- 操作中心区分成功、部分完成、失败、已取消和已超时状态；批量详情保留逐项成功/跳过/失败、跳过原因、已完成项和失败项重试入口。toast 继续只承担短确认，详情可在 toast 消失后回看。
- 新增 Rust `storage/operation_history.rs` 与 `commands/operation_history.rs`，使用版本 `1` 的独立 `operation-history.json`、原子替换、最多 100 条记录、结果/原因/重试参数上限和损坏备份；历史只写入操作元数据和不透明资料 ID，不写入正文、完整路径或密钥，损坏时回退空历史且不阻塞索引启动。
- 设置文件格式升级为 v3，新增持久化 revision；v1/v2 设置保留原字段并原子迁移。`update_settings` 使用 expected revision，前端设置草稿记录打开时快照和实际编辑字段，跨窗口 `settings-changed` 到来时提示并只合并用户编辑字段，过期保存由 Rust CAS 拒绝。
- 新增操作历史 IPC runtime contract、TypeScript 声明、Tauri command 清单和 capability 权限；补充阶段 E 操作模型、IPC、设置合并和 Rust 存储测试。
- 五个版本入口已统一为 `0.3.21`：`prototype/package.json`、`prototype/package-lock.json` 根包、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml` 和 `prototype/src-tauri/Cargo.lock` 根包；README、计划和本进度已同步。
- `0.3.21` Windows x64 NSIS 安装包已构建：`prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.21_x64-setup.exe`，大小 `8716353` bytes，SHA-256 为 `FF1263C8C2599392A01417DBD8B8AE6CFDA4C7F96F16B4BB7C2E1C9F091C0BC0`。

#### 进行中

- 等待用户安装 `0.3.21` 候选并执行 Windows 11/Tauri/WebView2 阶段 E 原生验收。

#### 阻塞与风险

- 浏览器回退只验证操作中心空状态、设置入口和 360px 层级/布局，不能验证 Tauri IPC、真实导入跳过、批量取消/超时、跨窗口托盘设置或重启后的 app data 历史恢复。
- Windows 11/Tauri/WebView2 原生安装、启动、操作历史重启恢复、批量取消/重试、设置冲突和卸载仍需用户手工验收；安装包不签名且不内置 WebView2 Runtime 的既有发布边界不变。
- 设置数据从 v2 迁移到 v3 时 revision 从文件默认 `0` 开始；操作历史为新增附属文件，无旧版本迁移，损坏时备份后清空并允许继续启动。

#### 下一步

- 由用户安装并核对 `0.3.21` NSIS 候选，随后记录 Windows 11/Tauri/WebView2 下阶段 E 原生验收，再决定是否创建 Tag/Release。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/features/operations/OperationCenter.jsx`
- `prototype/src/features/operations/operationModel.js`
- `prototype/src/features/operations/operationApi.js`
- `prototype/src/features/operations/useOperationController.js`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src/features/library/useIndexController.js`
- `prototype/src/features/settings/SettingsPanel.jsx`
- `prototype/src/features/settings/useSettingsController.js`
- `prototype/src/features/settings/settingsModel.js`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`
- `prototype/src-tauri/src/storage/operation_history.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/commands/operation_history.rs`
- `prototype/src-tauri/src/commands/settings.rs`
- `prototype/src-tauri/src/lib.rs`、`build.rs`、`capabilities/default.json`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`

#### 验证

- `npm.cmd run test:library`：14 项通过。
- `npm.cmd run test:contracts`：12 项通过。
- `npm.cmd run test:settings`：5 项通过。
- `npm.cmd run test:operations`：2 项通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --check`、`cargo test --lib`：65 项通过、0 失败；`cargo check` 和 `cargo clippy --all-targets --all-features -- -D warnings` 通过。
- Microsoft Edge 回退检查：1280px 操作中心展开正常；360px 资料列表无页面横向溢出，设置面板内容可滚动，修复了操作中心覆盖设置 Dialog 的层级问题；临时 Vite 服务和浏览器标签已关闭。
- `npm.cmd run tauri:build`：通过，生成 Windows x64 NSIS 安装包；`verify-webview2-loader.mjs` 通过，`WebView2Loader.dll` 大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序位于同一目录。


## 2026-09-01

### 阶段 D：单条标签、分组和详情面板（0.3.20 代码候选）

#### 已完成

- 行操作菜单已为主索引资料增加“查看资料详情”“编辑标签”和“设置分组”；目录浏览的临时子项仍不渲染这些入口，不能绕过目录授权。
- 新增标签编辑对话框，展示现有标签，支持添加、删除、去重和空值/长度/数量提示；保存复用 `setEntryTags` 与既有 IPC 错误映射，桌面端返回的 `entry` 先更新当前行，再按 `revision` 同步索引。
- 新增分组编辑对话框，支持“未分组”和已有分组；保存复用 `setEntryGroup`，当前行和索引 revision 同步更新。分组变化后无效的筛选 ID 会自动清除，避免列表、筛选 chip 和批量状态不一致。
- 新增资料详情对话框，显示名称、类型、大小、修改时间、来源位置、收藏、标签、分组和状态，并提供收藏、预览、复制位置、定位、默认程序打开、编辑标签和设置分组入口；标签 chip 可直接进入标签筛选。
- 管理分组中的删除操作改为先展示受影响资料数量并确认，明确只解除分组归属，不删除索引记录和原文件；取消不会触发 command。
- 索引格式保持 v4，没有新增持久化字段或迁移方案。
- 五个版本入口已统一为 `0.3.20`：`prototype/package.json`、`prototype/package-lock.json` 根包、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml` 和 `prototype/src-tauri/Cargo.lock` 根包。

#### 进行中

- `0.3.20` Windows x64 NSIS 安装包已构建；Windows 11 安装、首次启动、重启后的标签持久化、真实分组操作和卸载仍需用户手工验收。

#### 阻塞与风险

- 浏览器回退只验证演示数据、列表状态、对话框布局和前端筛选，不验证 Tauri IPC、本地索引写入、Windows 文件关联、资源管理器定位或真实文件副作用。
- 安装包不签名且不内置 WebView2 Runtime；DOC 预览仍依赖目标机 LibreOffice。这些是既有发布边界，不是阶段 D 新增依赖。

#### 下一步

- 由用户安装 `0.3.20` 候选，验收单条标签持久化、分组编辑/删除确认、详情快捷操作和窄窗口行为；收到具体回归后再进入阶段 E。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src/features/library/LibraryEntryDialogs.jsx`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryPanelParts.jsx`
- `prototype/src/features/library/LibraryRowActionMenu.jsx`
- `prototype/src/features/library/libraryControllerModel.js`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/libraryOverlayModel.js`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src/styles.css`
- `prototype/tests/library-controller.test.mjs`
- `prototype/tests/library-model.test.mjs`
- `prototype/tests/ipc-contracts.test.mjs`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`

#### 验证

- `npm.cmd run test:library`：14 项通过。
- `npm.cmd run test:contracts`：11 项通过；`npm.cmd run test:settings`：4 项通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- Microsoft Edge 回退检查：1280px 下行菜单显示详情/标签/分组入口；标签编辑添加标签后列表立即显示新 chip，详情标签点击会生成筛选 chip；360px 下详情对话框可滚动，操作按钮和表格没有互相覆盖。
- 修复标签筛选 chip 清除时错误访问 `filters["tag:..."]` 的问题；修复后浏览器控制台新增错误为 0、警告为 0。
- `npm.cmd run tauri:build`：通过，生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.20_x64-setup.exe`，大小 `8663311` bytes，SHA-256 为 `DEC740706A5A68D77E40422A53D3D3788E290E26B955E3B4EFE0C42034DBDBB2`。
- `verify-webview2-loader.mjs`：通过；`WebView2Loader.dll` 大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序同目录。
- 尚未执行安装器启动/卸载和 Windows 11 原生手工验收。

## 2026-09-01

### 阶段 C：预览错误恢复和连续浏览（0.3.19 代码候选）及安装包构建

#### 已完成

- 按 `PROJECT_PLAN.md` 完成阶段 C：预览失败页按状态提供重试、重新定位、系统默认程序打开、资源管理器定位和返回列表动作；缺少 DOC 转换器时显示本机 LibreOffice 依赖说明。
- `PreviewPane` 增加重试、默认程序打开、定位、复制位置、收藏和相邻资料导航回调；重试使用新的 task ID，旧请求在效果清理时取消，旧 preview resource 在切换、关闭、失败和过期响应时释放。
- 资料库将当前导航、搜索、筛选和排序后的完整可见列表快照交给预览；切换搜索、筛选、导航或目录时关闭旧预览，上一项/下一项不会跨列表上下文跳转；目录临时子项只保留受控预览和定位能力。
- 图片、视频、DOCX、XLSX 和 PDF 的内部异步失败统一回到预览失败动作页；Markdown、图片缩放旋转、PDF 分页缩放、XLSX Sheet 切换和视频控制主流程保持不变。
- 浏览器回退结果增加 `demoOnly` 标记和“浏览器演示限制”状态，不读取真实本地文件；已同步阶段 C 的计划勾选、根 README、原型 README 和进度入口。
- 五个版本入口已统一为 `0.3.19`：`prototype/package.json`、`prototype/package-lock.json` 根包、`prototype/src-tauri/tauri.conf.json`、`prototype/src-tauri/Cargo.toml` 和 `prototype/src-tauri/Cargo.lock` 根包。
- 已构建 Windows x64 NSIS 安装包，产物为 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.19_x64-setup.exe`，大小 `8658797` bytes，SHA-256 为 `E5304B2643671E5FCEC89C8258027398A82DF95467D90E00576FEC89C9521A92`。

#### 进行中

- `0.3.19` 仍是未发布代码候选；安装包尚未在 Windows 11 上执行安装、首次启动、卸载、真实文件预览或外部操作验收。

#### 阻塞与风险

- 浏览器回退不能验证 Tauri IPC、Windows 默认文件关联、资源管理器定位、DOC 缺少 LibreOffice、文件移动后的真实恢复和 WebView2 编解码行为。
- 安装包未签名，构建配置不内置 WebView2 Runtime；这些发布边界与阶段 C 本身无关但继续保留。

#### 下一步

- 用户安装 `0.3.19` 候选包，使用测试夹具在 Windows 11/Tauri/WebView2 下验收各预览成功/失败状态、重试、默认程序打开、资源管理器定位、DOC 转换器缺失和文件移动后的重新定位；收到具体回归后再修复或进入阶段 D。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/features/preview/UnsupportedPreviewer.jsx`
- `prototype/src/features/preview/previewApi.js`
- `prototype/src/features/preview/previewTypes.js`
- `prototype/src/features/preview/ImagePreviewer.jsx`
- `prototype/src/features/preview/VideoPreviewer.jsx`
- `prototype/src/features/preview/OfficePreviewer.jsx`
- `prototype/src/features/preview/SpreadsheetPreviewer.jsx`
- `prototype/src/features/preview/PdfPreviewer.jsx`
- `prototype/src/styles.css`
- `prototype/tests/preview-registry.test.mjs`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`

#### 验证

- `npm.cmd run test:preview`：11 项通过，覆盖预览注册表、失败动作集合、浏览器演示标记、相邻项边界、XLSX 正常/损坏夹具、Markdown 安全引用和 PDF canvas 模型。
- `npm.cmd run test:contracts`：8 项通过；`npm.cmd run build`：通过并生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- Microsoft Edge 回退检查：1280px 预览对话框宽度 `1080px` 且头部控件不重叠；360px 下 `body.scrollWidth=360`、头部 `scrollWidth=clientWidth=360`，连续浏览和搜索上下文关闭行为通过；临时浏览器和 Vite 服务已清理。
- 版本一致性检查通过，五个版本入口均为 `0.3.19`；`git diff --check` 通过。
- `npm.cmd run tauri:build`：通过，前端生产构建、Rust release 编译、Windows x64 NSIS 打包和 loader 验证均通过；`WebView2Loader.dll` 为 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`，与 release 主程序同目录。
- 本次未执行安装器启动/卸载、Windows 11 原生手工验收、Tag、Release 或远程推送。

### 构建 0.3.18 Windows x64 NSIS 安装包

#### 已完成

- 在 `dev` 分支基于阶段 A-B 的 `0.3.18` 代码候选完成 Windows x64 NSIS 安装包构建；没有执行推送、Tag 或 GitHub Release 发布。
- 安装包路径为 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.18_x64-setup.exe`，大小为 `8657734` bytes，SHA-256 为 `0AD7C66071F51CAFD310481FA776BA729AD93267A91E85017896E2D3EE6A3DDF`。
- `WebView2Loader.dll` 校验通过，大小为 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`；loader 与 release 主程序位于同一目录，目标架构为 Windows x64。

#### 进行中

- 安装器尚未在 Windows 11 上执行安装、首次启动、卸载、托盘/悬浮球和阶段 A-B 原生窗口验收；浏览器回退检查不能替代这些验收。

#### 下一步

- 用户安装该 `0.3.18` 候选包，复核 Windows 11/Tauri/WebView2 下的多选上下文、列表滚动、行菜单边界、导入条和 360px/不同 DPI 行为；收到结果后再处理具体回归或决定是否发布。

#### 验证

- `npm.cmd run tauri:build`：通过，前端生产构建、Rust release 编译、Windows x64 NSIS 打包和 `verify-webview2-loader.mjs` 均通过；构建保留既有大 chunk 提示。
- 构建后 `git diff` 无内容差异，生成的 schema/permission 文件仅触发 Git 状态刷新，未产生需要提交的原生权限变化。

## 2026-09-01

### 阶段 A：多选范围和列表状态（0.3.17 代码候选）

#### 已完成

- 在 `codex/implement-phases-a-b` 分支完成阶段 A，并继续进入阶段 B；没有修改用户已有的 dev 基线历史。
- 在 `libraryModel.js` 增加列表上下文 key、上下文变化清空选择、刷新后保留有效 ID 和可见选择统计的纯函数。
- 导航、目录面包屑、搜索、类型/标签/分组筛选变化时清空 `selectedIds`；`selectedId` 和当前预览状态保持独立，复选框事件继续阻止行点击冒泡。
- 表格滚动容器保存为 ref；列表上下文变化滚动到顶部，刷新开始时保存并在刷新结束后恢复滚动位置；页眉全选仍只作用于当前页。
- 阶段 A 代码门禁通过后进入阶段 B，最终将版本入口同步到 `0.3.18`；`0.3.17` 未创建 Tag、安装包或 Release。

#### 进行中

- 阶段 A 的 Windows 11/Tauri/WebView2 原生刷新、目录、分页和多 DPI 验收仍需用户在桌面环境执行；浏览器回退只证明前端状态和布局。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/useLibraryNavigation.js`
- `prototype/src/features/library/libraryModel.js`
- `prototype/tests/library-model.test.mjs`

#### 验证

- `npm.cmd run test:library`：阶段 A 模型以及阶段 B 菜单定位测试共 14 项通过。
- `npm.cmd run test:contracts`：8 项通过。
- Microsoft Edge 回退检查确认切换“收藏”和输入搜索词后批量工具栏被清空，未打开预览对话框；临时浏览器和 Vite 服务已关闭。

### 阶段 B：行菜单弹层和首屏布局（0.3.18 代码候选）

#### 已完成

- 新增 `LibraryRowActionMenu.jsx` 和 `libraryOverlayModel.js`；行菜单通过 `document.body` portal 渲染，使用 `getBoundingClientRect()`、fixed 定位、上下展开判断、左右边界约束和可用高度限制，不再受表格滚动容器裁切。
- 菜单监听窗口 resize、visual viewport、页面/表格滚动和列表上下文变化；打开后聚焦第一项，支持方向键、Home、End、Escape、Tab、焦点返回和阻止行点击冒泡。
- 已有资料时导入区收缩为紧凑导入条，保留导入文件夹、选择文件和拖放入口；桌面搜索框使用剩余宽度，筛选 chip 支持逐项清除，结果数显示当前结果和总索引数。
- 360px 下隐藏低频的桌面设置按钮，显示明确的“更多”入口并打开同一设置面板；新菜单定位测试已接入 `test:library`。
- 已同步 `prototype/package.json`、`package-lock.json` 根包、Tauri 配置、Rust crate、`Cargo.lock` 根 package、根 README、原型 README 和本计划到 `0.3.18` 代码候选口径；未执行推送、Tag、安装包构建或 Release 发布。

#### 进行中

- 阶段 B 的 Windows 11/Tauri/WebView2 原生窗口尺寸、真实索引刷新、滚动菜单和多 DPI 验收仍需用户执行；浏览器检查不替代桌面验收。

#### 涉及文件

- `prototype/src/features/library/LibraryActions.jsx`
- `prototype/src/features/library/LibraryRowActionMenu.jsx`
- `prototype/src/features/library/libraryOverlayModel.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/LibraryPanelParts.jsx`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/tests/library-overlay.test.mjs`

#### 验证

- `npm.cmd run test:library`：14 项通过，包含上下文选择模型、刷新选择保留和菜单位置边界。
- `npm.cmd run test:contracts`：8 项通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；保留既有大 chunk 提示。
- Microsoft Edge 回退检查：1280px 下确认已有资料的导入区高度收缩、搜索框占用剩余宽度，首行和靠近底部的菜单均在窗口内；菜单挂在 `BODY` 且使用 `position: fixed`，Escape 返回触发按钮，Home/End 可切换菜单项；调整到 360px 后菜单仍在窗口内。
- Microsoft Edge 回退检查：680px 的表格 `scrollWidth=clientWidth=629`，360px 的页面 `body.scrollWidth=clientWidth=360`、表格 `scrollWidth=clientWidth=309`；导入条和表格没有重叠，更多入口可见。临时截图、浏览器 session 和 Vite 服务已清理。
- 未运行 `npm.cmd run tauri:build`，未进行 Windows 11 安装器启动/卸载或原生手工验收；本轮没有改动原生行为，只同步版本入口。

#### 下一步

- 进入 `PROJECT_PLAN.md` 阶段 C，补齐预览失败后的重试、定位、复制位置和连续浏览状态；保持 `0.3.18` 为当前未发布代码候选，收到 Windows 原生验收结果后再处理具体回归。

## 2026-09-01

### 切换 dev 并重写 0.3.x 后续界面与功能计划

#### 已完成

- 已确认工作树在切换前干净，并从 `main` 切换到现有 `dev` 分支；当前 HEAD 为 `59aa977`，版本基线为 `0.3.16`。
- 已删除旧版 `PROJECT_PLAN.md` 的阶段 A-J 计划内容，并重新编写以界面和功能增强为主题的新总体计划。
- 新计划从 `0.3.17` 开始，按阶段覆盖多选范围、菜单弹层、首屏布局、预览错误恢复、单条标签/分组、操作结果中心、键盘与响应式、最近打开、DOCX 性能、递归导入和全文检索。
- 已明确每个阶段在代码、最小自动验证和文档同步完成后立即更新 `package.json`、`package-lock.json`、Tauri 配置、Rust crate 和 `Cargo.lock` 的版本入口；Windows 11 手工验收和 Release 不再作为版本号更新的前置条件。

#### 进行中

- 阶段 A `0.3.17` 尚未开始实现，应用版本入口暂时保持 `0.3.16`。
- 当前只完成计划重写和分支切换，没有开始修改选择状态、列表滚动或其他功能代码。

#### 阻塞与风险

- 新计划仍需按阶段执行；未完成代码和最小验证前，不得提前把应用版本改为 `0.3.17` 或创建 Release。
- Windows 原生验收继续与代码候选版本分开记录；涉及无边框窗口、托盘、悬浮球、预览、文件操作、递归扫描或安装包的阶段需要安排对应 Windows 11/Tauri/WebView2 手工检查。
- 新增全文索引、操作历史、索引迁移或 DOCX 任务时，必须继续保持 local-first、原子写入、路径授权、资源清理和不记录正文/密钥的边界。

#### 下一步

- 按 `PROJECT_PLAN.md` 阶段 A 实现多选上下文收束、筛选/导航切换后的选择清理和列表滚动位置规则。
- 完成阶段 A 的前端模型、契约、构建和 1280px/680px/360px 检查后，立即同步版本到 `0.3.17`，再进入阶段 B。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`

#### 验证

- `git status --short --branch`：切换前工作树干净。
- `git switch dev`：成功，当前分支为 `dev`，并跟踪 `origin/dev`。
- 计划文档结构检查：已确认 `0.3.17` 至 `0.3.26` 阶段和各阶段版本门禁均已写入。
- 本次为计划和进度文档变更，未重复运行完整测试、构建或安装包构建。

## 2026-09-01

### 阶段 A-J Windows 验收完成与 0.3.16 发布完成

#### 已完成

- 用户已确认当前分支所包含阶段 A-I，以及阶段 J 发布验收对应的 Windows 11/Tauri/WebView2 桌面验收完成；本次验收结果作为发布门禁，不再把浏览器回退检查或开发侧自动测试当作桌面验收替代品。
- 根据用户对发布版本的确认，本次使用 `0.3.16` 作为 `v0.3.6` 后的最终阶段版本。计划表中的 `0.3.7`-`0.3.15` 保留为前置阶段规划编号，本次不连续创建这些版本的 Release。
- 将前端 package、package-lock 根包、Tauri 配置、Rust crate、Cargo.lock 根包、根 README、原型 README 和本计划的当前状态统一切换到 `0.3.16` 发布口径；阶段 J 的质量门禁与发布验收纳入本次版本。

#### 分支同步与发布

- 已按用户指定顺序完成 `codex/implement-phases-g-i` → `dev` → `main`：当前分支版本/文档提交为 `e9b543c`，合入 `dev` 的提交为 `0616d46`，合入 `main` 的提交为 `c986ba4`；两个分支均已推送到远端。

#### 阻塞与风险

- 阶段 J 的用户发布验收已完成；自动化质量门禁、依赖审计、安装包签名评估和 Release 依赖链仍按仓库实际能力记录，不将未执行的检查写成已执行。
- 安装包未签名、目标机需要 WebView2、DOC 预览需要 LibreOffice、视频编码依赖 WebView2，以及 `xlsx@0.18.5` 的既有依赖风险保持不变。

#### 后续维护

- `v0.3.16` 已发布并完成资产核验；后续仅按需维护已知外部依赖边界、未签名安装包和计划外问题。

#### 涉及文件

- `prototype/package.json`、`prototype/package-lock.json`
- `prototype/src-tauri/Cargo.toml`、`prototype/src-tauri/Cargo.lock`、`prototype/src-tauri/tauri.conf.json`
- `README.md`、`prototype/README.md`、`PROJECT_PLAN.md`、`PROJECT_PROGRESS.md`

#### 验证

- 版本一致性检查通过：`prototype/package.json`、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock 根 package 均为 `0.3.16`。
- `git diff --check`：通过。
- `npm.cmd run build`：通过；生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`，保留既有大 chunk 提示。
- `cargo check --locked`：通过，Rust crate 使用锁定依赖并按 `0.3.16` 编译。
- 分支同步完成：`origin/dev` 指向 `0616d46`，`origin/main` 在发布 tag 时指向 `c986ba4`；`v0.3.16` tag 指向 `c986ba4`。
- GitHub Actions workflow `33412380544`（`发布 Windows Release`）运行成功，版本校验、loader 预置、Windows x64 NSIS 构建、便携 ZIP 内容校验和 Release 上传步骤全部通过。
- GitHub Release [`v0.3.16`](https://github.com/ChaceQC/Data-Collection/releases/tag/v0.3.16) 已公开发布，非草稿、非预发布，包含 `_0.3.16_x64-setup.exe`（`5174648` bytes，SHA-256 `9866df9907a847208bc3364444eba1a2681a7db5ed75f0cce9e43d8c28270c44`）和 `_0.3.16_x64-portable.zip`（`6440933` bytes，SHA-256 `34b6883eab41cc76bae2d8c2ecb3abf261b8b5399363128a3128bbc02cfcfe48`）。

## 2026-08-31

### 筛选菜单自动关闭与 Windows 扩展路径显示修复

#### 已完成

- 修复 `LibraryFilterMenu` 使用非受控 `<details>` 导致菜单只能通过再次点击“筛选”关闭的问题；现在点击菜单外区域或按 `Escape` 会立即收起，菜单内部仍可连续选择多个筛选项。
- 修复 Windows `canonicalize` 长路径前缀在界面暴露的问题：仅在显示、复制位置和删除确认对话框中将 `\\?\\D:\\...` 还原为 `D:\\...`，并将 `\\?\\UNC\\server\\share\\...` 还原为 UNC 路径；索引中的原始规范路径和 Rust 文件系统校验保持不变。

#### 验证

- `npm.cmd run test:library`：9 项通过，覆盖驱动器路径和 UNC 路径显示归一化；`npm.cmd run test:contracts`：8 项通过；`npm.cmd run build`：通过。
- Microsoft Edge 回退页面已实测：打开筛选菜单后点击“资料库”标题，菜单 `open` 从 `true` 变为 `false`；筛选菜单可继续多选。临时 Vite/Edge 会话已关闭。
- `npm.cmd run tauri:build`：通过，生成修复版 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；大小 `8656156` bytes，SHA-256 为 `448E59CBA3A5CE5DB434768269C2741D864C64B61E7EB7DC0D72979FB6B67EBD`。`WebView2Loader.dll` 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`。

#### 进行中

- 代码修复和修复版安装包已完成；需安装该包重新执行 Windows 11/WebView2 桌面验收，确认真实长路径显示、复制和资源管理器定位。

### 操作列表头与按钮对齐修复

#### 已完成

- 将桌面表格“操作”表头与星标/更多按钮统一增加 `28px` 左侧留白；修改时间列保留 `12px` 右侧空间，避免较窄桌面宽度下日期文本和操作按钮重合。移动端原有右对齐布局不变。

#### 验证

- Edge 960px 视图确认表头和操作单元格使用相同 `28px` 左内边距，操作列内容位于修改时间列之后且没有侵入日期文本；截图保存在被忽略的 `prototype/output/playwright/`。
- `npm.cmd run test:library`：9 项通过；`npm.cmd run test:contracts`：8 项通过；`npm.cmd run tauri:build`：通过。
- 最新安装器 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe` 大小 `8655100` bytes，SHA-256 为 `883CE91A9031ADC3D5F7F9F994D76AEFD22F19A0ADEE8298C3350D24BA4389D6`；loader 校验通过，大小 `160320` bytes，SHA-256 为 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`。

#### 进行中

- 需安装最新修复包在 Windows 11/WebView2 桌面环境复核不同窗口宽度下的操作列、表头、日期截断和行菜单定位；当前未执行安装器启动/卸载验收。

### 新总体计划阶段 G-I 代码实现与分组列调整

#### 已完成

- 在独立本地分支 `codex/implement-phases-g-i`（基线 HEAD `2548769`）继续实现 `PROJECT_PLAN.md` 阶段 G-I；保留正式发布版本 `0.3.6`，没有修改 package、Tauri、Rust crate 或 Cargo.lock 版本，没有执行 commit、merge、push、tag 或 Release。
- 阶段 G：资料行增加可省略、展开和复制的位置区域；根记录使用已登记路径，目录临时子项使用登记文件夹 ID 加受控相对路径生成位置摘要。搜索覆盖名称、类型、状态、路径、目录层级、标签和分组；同名资料显示父目录摘要，根记录和目录子项均提供受控资源管理器定位入口。
- 阶段 G：搜索无结果、筛选无结果、失效路径、空目录和导入上限均有下一步入口或明确状态；主窗口只展示基于 `addedAt` 的“最近添加”，托盘/悬浮球继续使用 `lastRecordedAt` 的“最近记录”，没有虚构“最近打开”入口。
- 阶段 H：索引从 v3 安全迁移到 v4，新增 `tags`、可选 `groupId`、分组表和 revision 持久化；旧索引新字段默认为空，迁移失败保留旧文件。Rust 增加标签/分组名称校验、分组创建/重命名/删除、条目标签/分组更新和受控目录子项定位 command。
- 阶段 H：资料库新增类型、标签多选、分组多选与已有搜索/收藏/失效导航的组合筛选；分组已按用户反馈单独显示为资料表“分组”列，标签保留在名称下方，删除分组只解除归属，不修改索引记录或原文件。
- 阶段 I：主索引支持稳定 ID 多选、批量收藏/取消收藏、添加/移除标签、设置/解除分组和移除索引；批量移除前展示选中数量和文件名范围，返回每项成功/失败/跳过及原因，不开放批量物理复制、重命名或删除。
- 阶段 I：可逆索引变更写入最多 50 条本地元数据撤销记录，不保存正文；撤销要求当前 revision 和每个目标状态都匹配。batch 操作使用操作 ID、后台任务、10 秒截止时间和取消标记，已完成项可部分成功，取消/超时项保留重试入口。
- 同步前端 IPC runtime validator、TypeScript 声明、Tauri command handler/build manifest、main capability 和自动生成 schema；重命名/重新定位继续保留原有标签和分组。

#### 进行中

- 阶段 G-I 已完成代码级实现和开发侧自动验证；正式版本仍为 `0.3.6`，候选版本 `0.3.13`-`0.3.15` 尚未写入版本入口，等待用户按阶段在 Windows 11/Tauri/WebView2 桌面环境验收。

#### 阻塞与风险

- 本轮只验证了浏览器回退 UI、Rust 存储/command 编译和模型契约，未代替用户完成 Windows 11 原生路径选择、真实长路径/同名文件、资源管理器定位、分组重启恢复、托盘/悬浮球同步、批量取消和安装包运行验收。
- 浏览器回退不执行真实 Tauri command；`navigator.clipboard` 位置复制、`reveal_directory_child` 资源管理器调用和 batch cancel 仍需桌面环境确认。不能把本轮浏览器截图或自动测试写成 Windows 手工验收通过。
- 索引格式已升级为 v4，旧 v3 迁移覆盖无标签/无分组夹具；仍需在用户真实升级路径上确认备份、磁盘权限和异常退出边界。安装包未签名、目标机需要 WebView2、DOC 预览需要 LibreOffice 和 SheetJS 既有风险保持不变。

#### 下一步

- 用户在 Windows 11 安装/启动当前开发构建，使用中文、空格、深层路径和同名文件验证位置展开/复制/定位、路径搜索和筛选组合；记录显示器/DPI、文件类型、路径形态和失败步骤。
- 用户继续验证创建/重命名/删除分组、标签批量变更、收藏/失效组合、重启恢复、托盘/悬浮球同步，以及批量移除确认、取消、部分成功、重试和 revision 过期撤销。
- 收到桌面验收结果后只修复具体阻断项；阶段门禁、版本入口和用户验收证据一致且获得明确授权前，不提升版本、不构建 Release。

#### 涉及文件

- `prototype/src/features/library/libraryModel.js`、`LibraryPanel.jsx`、`LibraryActions.jsx`、`libraryControllerModel.js`、`libraryRepository.js`、`useIndexController.js`、`useLibraryActions.js`、`prototype/src/App.jsx`、`prototype/src/styles.css`
- `prototype/src/lib/ipcContracts.js`、`ipcContracts.d.ts`
- `prototype/src-tauri/src/filesystem/mod.rs`、`commands/mod.rs`、`commands/library.rs`、`storage/mod.rs`、`storage/repository.rs`、`windows/tray.rs`、`src-tauri/src/lib.rs`、`build.rs`、`capabilities/default.json`、`permissions/autogenerated/`
- `prototype/tests/library-model.test.mjs`、`library-controller.test.mjs`、`ipc-contracts.test.mjs`、`prototype/README.md`、根 `README.md`、`PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:library`：8 项通过；`npm.cmd run test:contracts`：8 项通过，覆盖位置路径/深层目录、同名父目录、标签/分组组合筛选、v4 groups/undo payload、批量部分结果和标签校验。
- `npm.cmd run test:settings`：4 项通过；`npm.cmd run test:preview`：9 项通过；`npm.cmd run test:floating-ball`：17 项通过；`npm.cmd run test:tray`：3 项通过；`npm.cmd run test:sites`：4 项通过。
- `npm.cmd run build`：通过，Sites 产物继续生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；保留既有大 chunk 提示。
- `cargo fmt --all -- --check`、`cargo check`、`cargo clippy --all-targets --all-features -- -D warnings`：均通过；`cargo test --all-targets`：61 项通过。
- Playwright Microsoft Edge 回退检查：1280px 资料表显示独立“分组”列和可展开位置；680px 表格 `scrollWidth=clientWidth=629`；360px 表格 `scrollWidth=clientWidth=309`、`body.scrollWidth=360`，分组字段渲染为“未分组”，无横向溢出。截图保存在被忽略的 `prototype/output/playwright/`，临时 Vite 服务和浏览器会话已关闭。
- 未执行 `npm.cmd run tauri:build`、安装器启动/卸载和 Windows 11 原生手工验收；未把当前开发分支宣传为 `0.3.13`-`0.3.15` 正式候选。

### PDF 渲染与关闭退出生命周期修复

#### 已完成

- PDF.js 构建时从锁定的 `pdfjs-dist@4.10.38` 输出 CMap 和标准字体资源，PDF 加载时显式配置资源目录，覆盖需要 CMap/标准字体的 PDF 字符绘制场景。
- PDF 页面使用设备像素比创建受限的后台 canvas，等待 `RenderTask` 完成后再复制到可见 canvas；保留页数、页面尺寸、像素上限、分页、缩放、取消和资源释放逻辑，避免 WebView2 在异步绘制期间显示缺字或半成品页面。
- 修复 `hideToTray=false` 时主窗口关闭只销毁 `main` 窗口的问题：现在通过统一退出路径幂等关闭悬浮球、释放预览资源、移除托盘并退出应用；`hideToTray=true` 的托盘驻留行为保持不变，托盘不可用时仍保留主窗口并提示。
- 增加 PDF canvas 尺寸模型测试和关闭策略测试；没有修改索引格式、设置格式或预览资源协议。

#### 验收结果

- 用户已确认在 Windows 11 Tauri/WebView2 桌面环境完成本轮手工验证，包含真实多页 PDF 的字符完整性、翻页/缩放，以及关闭隐藏未勾选时托盘和悬浮球清理、应用退出行为。

#### 阻塞与风险

- 本轮无新增阻塞；安装包未签名、目标机需要 WebView2、DOC 预览需要 LibreOffice，仍是既有发布边界。

#### 下一步

- 保持 `ada2dbd` 为本次修复基线；后续如出现回归，优先记录 PDF 样本的字体/页码、WebView2 版本和窗口关闭设置，再针对性追加修复。

#### 涉及文件

- `prototype/vite.config.mjs`、`prototype/src/features/preview/PdfPreviewer.jsx`、`prototype/src/features/preview/pdfRenderModel.js`
- `prototype/src-tauri/src/windows/lifecycle.rs`、`prototype/src-tauri/src/windows/lifecycle_policy.rs`、`prototype/src-tauri/src/lib.rs`
- `prototype/tests/pdf-render-model.test.mjs`、`prototype/README.md`、`README.md`

#### 验证

- `npm.cmd run test:preview`：9 项通过，包含 PDF canvas 尺寸模型、预览注册表、安全边界和工作簿夹具。
- `npm.cmd run build`：通过；`dist/client/pdfjs/` 输出 185 个 CMap/标准字体资源，总计 1,948,053 bytes，并保留 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- 临时 Vite 服务端的 `GB-V.bcmap` 和 `FoxitSymbol.pfb` 请求均返回 `200`，响应体长度与资源文件一致；验证端口已关闭。
- `cargo fmt --all -- --check`：通过；`cargo test --all-targets`：57 项通过；`cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；最终安装器为 8,522,230 bytes，SHA-256 为 `B2032E991003D0D68A8096F5F19F6634CD842183F6E7FC32E8D8FB13C231EC8C`；`verify-webview2-loader.mjs` 通过，x64 loader 为 160320 bytes，SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`。
- PDF skill 的临时两页 PDF 已使用 Poppler 渲染并逐页检查，页面、公式文本、第二页表格和边界正常；真实 Windows 11 PDF/托盘/悬浮球手工验收由用户完成并确认通过。

### 新总体计划阶段 A-D 代码实现

#### 已完成

- 在独立分支 `codex/implement-phases-a-d`（基线 HEAD `86b20ae`）完成 `PROJECT_PLAN.md` 阶段 A-D 的代码级实现；保留用户已有的未提交计划改动，没有执行 commit、merge、push、tag 或 Release。
- 阶段 A：`can_preview`、`load_preview` 改用 `fileId` 或“登记文件夹 ID + 相对路径片段”，`list_directory` 后端重新校验登记归属、规范化路径、普通文件/文件夹、符号链接和 Windows reparse point；Markdown 链接 sanitizer 拒绝网络协议、绝对路径、协议相对 URL 和反斜杠变体。
- 阶段 B：索引状态增加单调 `revision`，新增 `refresh_index` 和托盘刷新入口；主窗口使用 single-flight/revision 丢弃旧响应，刷新时保留选择、目录面包屑、页码和滚动容器；“最近添加”按持久化 `addedAt` 限制最近 50 条，目录视图不再按临时添加时间排序。
- 阶段 C：索引加载增加字段、类型、状态、时间、ID 和路径结构校验，重复 ID/路径按稳定顺序合并；损坏、未知版本和迁移写入失败会先备份并进入可操作恢复状态；设置损坏会备份并写回安全默认值；删除原文件增加 `pending-operations.json` 待同步记录，库操作错误返回结构化类别和文件状态。
- 阶段 D：增加 Rust 预览任务取消注册表和退出清理；DOC 使用隔离 LibreOffice profile、输出 PDF 签名/大小校验和取消清理；Office ZIP 增加 `zip` 容器条目/解压后体积限制；XLSX Worker 按工作表惰性解析并限制首屏/单元格；PDF 增加页数、页面尺寸和 canvas 像素上限，图片/视频旧媒体事件通过稳定节点和资源切换隔离，预览资源按活动时间定时回收。
- 同步根 README、`prototype/README.md`、阶段清单和前端/ Rust 测试夹具；实际版本入口仍为 `0.3.6`，没有把 `0.3.7`-`0.3.10` 候选写入构建配置。

#### 进行中

- 等待用户在 Windows 11 Tauri 开发版完成阶段 A-D 手工验收，然后按阶段决定是否分别提升到 `0.3.7`、`0.3.8`、`0.3.9`、`0.3.10`；当前不能把自动测试当作桌面验收。

#### 阻塞与风险

- 本轮未代替用户完成真实 Windows 11 桌面验收；目录/预览授权的中文、空格、深层路径，外部移动/删除后的刷新，索引损坏恢复，重命名/回收站部分成功，DOC 转换取消，XLSX/PDF 大文件和托盘/悬浮球跨窗口同步仍需用户执行。
- `xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险仍在；当前通过 Rust Office ZIP 边界、Worker 惰性解析、单元格/超时限制降低暴露面，未宣称依赖风险消失。
- DOC 仍依赖用户本机 LibreOffice，WebView2 Runtime 仍由目标机提供，安装包仍未签名；本轮没有执行 Release 发布流程。

#### 下一步

- 用户使用当前分支启动 `npm.cmd run tauri:dev`，按 `PROJECT_PLAN.md` 阶段 A-D 完成真实文件和窗口验收，记录失败项的文件类型、路径形态、显示器/DPI 和复现步骤。
- 收到验收结果后，先修复阻断项并重新执行对应阶段最小验证；只有阶段门禁和版本入口一致后，才在明确授权下更新候选版本或执行 Git 发布流程。

#### 涉及文件

- `prototype/src-tauri/src/commands/`、`prototype/src-tauri/src/filesystem/`、`prototype/src-tauri/src/storage/`
- `prototype/src-tauri/src/preview/`、`prototype/src-tauri/src/windows/tray.rs`、`prototype/src-tauri/src/windows/tray_model.rs`
- `prototype/src/App.jsx`、`prototype/src/features/library/`、`prototype/src/features/preview/`、`prototype/src/features/floating-ball/`
- `prototype/tests/preview-security.test.mjs`、`prototype/tests/library-model.test.mjs`、`prototype/tests/tray-model.test.mjs`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`、`prototype/package.json`、`prototype/src-tauri/Cargo.toml`、`prototype/src-tauri/Cargo.lock`

#### 验证

- `cargo fmt --check`：通过。
- `cargo check`：通过。
- `cargo check --tests`：通过。
- `cargo test`：54 项通过，包含 Deflate 压缩 DOCX 容器回归测试。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run build`：通过，并生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `npm.cmd run test:preview`：6 项通过，包含 Markdown 链接安全边界测试。
- 其他前端针对性测试通过：`test:library` 6 项、`test:settings` 4 项、`test:floating-ball` 17 项、`test:tray` 3 项、`test:sites` 4 项。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；安装器大小 `7021782` bytes，SHA-256 为 `91003AAD2C88804087C1B0D689424C22712BBE8B9055B83F8CFD8AAD290B0850`。
- 构建后的 `WebView2Loader.dll` 校验通过：`160320` bytes，SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`，与 `local-material-workbench.exe` 位于同一 release 目录。
- 当前未执行 Windows 11 手工验收、commit、远程推送、tag 或 Release。

### ACL 权限修复与安装包重建

#### 已完成

- 修复 `refresh_index` 已注册但未进入 Tauri command manifest/capability 的问题；同步 `src-tauri/build.rs`、`capabilities/default.json` 和自动生成的 ACL schema/permission 文件。
- 同步主窗口实际使用的 `dialog:allow-save` 和 `allow-cancel-preview-task` 权限，避免索引诊断导出和预览取消在安装包中再次被 ACL 拦截。
- 修复 `zip` 依赖缺少 `deflate` feature 导致合法 DOCX 被 Rust Office ZIP 预检判为 `UnsupportedArchive` 的问题，并保留 Deflate DOCX 容器回归测试。
- `mammoth@1.12.2` 自带 `single-paragraph.docx` 和 `strict-format.docx` 夹具均可直接转换；仓库没有用户 DOCX 测试样本，因此未读取用户真实文档。

#### 进行中

- 等待用户安装最新 `0.3.6` 包后复测截图中的刷新按钮和 DOCX 预览；若仍失败，请记录预览状态文案和文件是否为普通 DOCX/加密文档/超限文件。

#### 验证

- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；安装器大小 `7027983` bytes，SHA-256 为 `55932E545FBE50F31C37077C06205E0811C3233BC182EC2B3BE69F81DD1B4E81`。
- `verify-webview2-loader`：通过；`WebView2Loader.dll` 为 `160320` bytes，x64，和 release 主程序位于同一目录。
- `git diff --check`：通过；构建产物仍被 `.gitignore` 忽略，没有执行 commit、push、tag 或 Release。

### 新总体计划阶段 E-F 代码实现

#### 已完成

- 先将阶段 A-D 的现状提交为 `2adeb67`（`feat: 完成阶段A-D代码实现`），再从 `dev` 的 `86b20ae` 快进合并到本地 `dev`；之后在独立分支 `codex/implement-phases-e-f` 继续实现，本轮没有 push、tag 或 Release。
- 阶段 E：将 `App.jsx` 从约 1,169 行收敛为页面组合层；索引加载/revision 刷新/恢复、资料目录导航、文件操作/选择器、设置状态和窗口事件分别下沉到 controller/hook。
- 新增 `prototype/shared/file-types.json`，统一扩展名、kind、文件类型、预览器、媒体类型、编码语言和预览限制；前端 `fileTypes.js`、预览注册表、设置限制和 Rust `filesystem` 均从该 manifest 派生。
- 新增 IPC contract runtime validator 与 `ipcContracts.d.ts`，统一 opaque ID、相对路径、索引 snapshot/mutation、revision 事件、预览状态、设置、托盘和悬浮窗结果；前端 command 通过 `libraryRepository`、预览/设置/悬浮球 API 收口。
- Rust 新增 `storage/repository.rs`，集中索引快照、导入合并、刷新、原子 mutation、恢复和待同步文件操作委托；command 只负责编排后台任务、参数边界和事件发布。索引 v3、设置 v2、数据目录和事件 revision 保持不变。
- 阶段 F：资料库改用语义化 `<table>`/`thead`/`tbody`/`th scope`/`rowheader`；行操作收进更多菜单并将原文件删除放在独立“危险操作”分组。
- 新增统一 `Dialog` 组件和焦点陷阱，覆盖打开焦点、Tab 循环、Escape、背景点击、`aria-labelledby`、`aria-describedby` 和关闭后的触发点焦点返回；预览、设置、移除、重命名和删除确认均复用该组件。
- 重命名输入增加非法字符、Windows 保留名、尾部空格/点、长度、扩展名、未变化和同目录冲突的逐项内联提示；图片使用文件名生成可访问名称，视频补充带文件名的 `aria-label`。
- 窄窗口在 `680px`/`360px` 下切换为紧凑资料卡片，只保留文件名、类型、状态和高频操作；样式集中增加颜色/间距/圆角/控件/阴影 token，并明确 `prefers-reduced-motion` 与深色模式策略。
- 前端托盘模型保留为 Rust 托盘菜单 ID 的唯一跨层契约测试用途，并在文件内标注；实际托盘菜单继续由 Rust 创建。

#### 进行中

- 阶段 E-F 代码和开发侧自动验证已完成，实际版本入口仍为 `0.3.6`；等待用户在 Windows 11 Tauri/WebView2 桌面环境执行阶段 E-F 手工验收，未将浏览器回退检查写成桌面验收。

#### 阻塞与风险

- 本轮没有代替用户执行 Windows 11 原生窗口、托盘、悬浮球、文件选择器、真实预览和文件操作验收；这些仍需用户记录目标窗口尺寸、显示器/DPI、文件类型、路径形态和复现步骤。
- `xlsx@0.18.5` 的既有 Prototype Pollution/ReDoS 风险仍未消失；LibreOffice、WebView2 Runtime、视频编码和未签名安装包仍是既有发布边界。
- 当前前端项目仍是 JavaScript/JSX；本阶段提供 `.d.ts` 类型声明和运行时校验，没有一次性迁移全部 JSX，完整 lint/typecheck 仍属于阶段 J。

#### 下一步

- 用户使用当前分支启动 `npm.cmd run tauri:dev`，验证键盘导入/搜索/排序/行选择/预览/弹窗确认、语义表读屏关系、窄窗口无覆盖、托盘/悬浮球同步及现有 A-D 场景。
- 收到桌面验收结果后先修复阻断项；只有阶段门禁、版本入口和用户验收证据一致且获得明确授权，才提升 `0.3.11`/`0.3.12` 候选版本或执行发布流程。

#### 涉及文件

- `prototype/shared/file-types.json`、`prototype/src/lib/`、`prototype/src/components/Dialog.jsx`
- `prototype/src/App.jsx`、`prototype/src/features/library/`、`prototype/src/features/preview/`、`prototype/src/features/settings/`、`prototype/src/features/window/`
- `prototype/src/features/floating-ball/floatingBallApi.js`、`prototype/src/features/tray/trayModel.js`、`prototype/src/styles.css`
- `prototype/src-tauri/src/storage/repository.rs`、`filesystem/mod.rs`、`preview/`、`commands/`、`build.rs`
- `prototype/tests/ipc-contracts.test.mjs`、`prototype/tests/library-controller.test.mjs`、`prototype/tests/fixtures/`
- `PROJECT_PLAN.md`、`README.md`、`prototype/README.md`、`prototype/package.json`

#### 验证

- `npm.cmd run test:contracts`：6 项通过；覆盖共享 manifest、重命名规则、opaque ID、相对路径、revision 事件、预览状态和结构化错误映射。
- `npm.cmd run test:library`：6 项通过；`test:settings`：4 项通过；`test:preview`：6 项通过；`test:floating-ball`：17 项通过；`test:tray`：3 项通过；`test:sites`：4 项通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；仅有既有大 chunk 警告。
- `cargo fmt --all -- --check`、`cargo test`、`cargo clippy --all-targets --all-features -- -D warnings`：均通过；Rust 共 55 项测试通过。
- Browser 回退检查：1280px 无页面/表格横向滚动；680px 和 360px 切换紧凑列表，名称/操作矩形无交叠；设置、预览和重命名 Dialog 的焦点、Escape、内联错误和危险操作菜单可见；页面 error/warning 日志为空。临时服务端口 `49219` 已关闭。
- `npm.cmd run tauri:build`：通过，生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；大小 `7046540` bytes，SHA-256 为 `A7E3DA3D073A0B533F0B7619453F5862D8B176276EF3D71914AC2E6BFDD21F6C`。
- `WebView2Loader.dll` 校验通过：`160320` bytes，SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`，x64 loader 与 release 主程序位于同一目录。
- `git diff --check`：通过；正式版本仍为 `0.3.6`，没有执行安装器启动/卸载或 Windows 桌面手工验收。

### PDF 预览渲染布局修复

#### 已完成

- 修复 `PreviewPane` 统一 Dialog 改造后多出的内容包装层：PDF 预览现在直接挂载到 `preview-dialog-body`，`aria-busy` 由 Dialog body 承担，避免 `.preview-pdf-content` 的百分比高度和内部 flex 高度失去明确包含块。
- 保留 PDF.js worker、资源 URL、分页、缩放、取消和资源释放逻辑；未改变 PDF 大小/页数/canvas 限制或 Rust 资源协议。

#### 进行中

- 代码回归、浏览器有效 PDF 检查和最新 NSIS 重建已通过；正式版本仍为 `0.3.6`，等待用户安装最新安装包后完成 Windows 11 PDF 手工验收。

#### 阻塞与风险

- 本轮未代替用户执行 Windows 11 桌面安装、启动、真实 PDF 文件和 WebView2 手工验收。

#### 下一步

- 用户安装最新 NSIS 包后复测 PDF 首页、分页、缩放和关闭预览，并记录目标 Windows/WebView2 版本及失败样本。

#### 涉及文件

- `prototype/src/components/Dialog.jsx`
- `prototype/src/features/preview/PreviewPane.jsx`
- `PROJECT_PROGRESS.md`

#### 验证

- `npm.cmd run test:preview`：6 项通过。
- `npm.cmd run build`：通过，Sites 产物生成成功。
- PDF skill 临时两页 PDF：Poppler 源文件渲染正常；浏览器 `Dialog + PdfPreviewer` canvas 在 100% 时为 `612x792`，第 2 页 125% 时为 `765x990`，截图内容正常且页面 error/warning 日志为空。
- 临时调试 HTML、有效 PDF、Poppler PNG 和服务端口 `49220` 已清理/关闭。
- `npm.cmd run tauri:build`：通过，生成修复后的 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；大小 `7047318` bytes，SHA-256 为 `BFE38EC70626D888A5A9C54F71E236146BF0492D564BC3B64017E125EDCA4A74`。
- `WebView2Loader.dll` 校验通过：`160320` bytes，SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`，x64 loader 与 release 主程序位于同一目录。

## 2026-08-30

### 悬浮球拖动后无法展开与收起闪烁修复

#### 已完成

- 修复 Windows 非客户区拖动结束时 WebView 未收到 `pointerup` 导致 controller 永久停留在 `dragging` 的问题；位置防抖保存完成后现在同时结束 controller 拖动状态。
- 将原生拖动标记提前到 `startDragging` IPC 调用前，避免拖动开始阶段产生的 `Moved` 事件被忽略，确保最终位置能按当前显示器和 DPI 保存。
- 展开窗口改为先移动到完整 host 位置、再放大窗口，避免悬浮球位于显示器边缘时放大瞬间跨屏并触发错误 DPI。
- 工作区 DIP 换算支持窗口 DPI 覆盖值，避免 monitor 快照与窗口快照不同步时产生错误的边界和方向计算。
- 收起进入 `closing` 状态时隐藏面板并将球体保持在窗口原点，避免原生移动/缩小期间面板短暂闪现。
- 用户于 `2026-08-30` 明确确认 Windows 11 桌面端本轮悬浮球全部验收场景通过。

#### 进行中

- 无；`v0.3.6` 已完成提交、合并、推送、tag 和 GitHub Release。

#### 阻塞与风险

- 代理已在当前双屏开发环境完成原生拖动回归复现和修复后验证；用户已完成目标 Windows 11 桌面验收。本条确认未提供具体 Windows/WebView2/显示器版本，因此不补写未知信息。
- 发布边界保持不变：安装包未签名，目标机需要 WebView2 Runtime，DOC 预览需要 LibreOffice。

#### 下一步

- 保持 `dev` 与 `main` 的远程分支同步，后续仅处理新的版本或功能。

#### 涉及文件

- `prototype/src/features/floating-ball/useFloatingBallDrag.js`
- `prototype/src/features/floating-ball/useFloatingBallWindowGeometry.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/styles.css`
- `prototype/tests/floating-ball-model.test.mjs`

#### 验证

- `npm.cmd run test:floating-ball`：17 项通过。
- `node --check`：悬浮球拖动、窗口几何和模型模块通过。
- `git diff --check`：通过。
- 当前双屏开发环境原生回归：旧版本拖动后复现 `state-dragging`；修复后拖动到新位置并释放，状态恢复为可展开，位置文件成功保存。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；`WebView2Loader.dll` 校验通过，160320 bytes，Windows x64。
- GitHub Actions `33314861233`：通过，Windows x64 构建、便携 ZIP、资源校验和 Release 上传全部完成。
- GitHub Release [`v0.3.6`](https://github.com/ChaceQC/Data-Collection/releases/tag/v0.3.6)：已正式发布，包含 NSIS 安装包和便携 ZIP。

## 2026-08-30

### 悬浮球拖动后无法在中间位置展开的回归修复

#### 已完成

- 定位到拖动开始时设置的 `suppressOpen` 在 `endDrag` 后未清除；当鼠标仍停在球体上时，后续 `floating-near=true` 会一直被拦截，导致把球拖到屏幕中间后无法展开最近记录。
- 修正 controller：正常拖动释放后恢复 hover 触发并重新执行 120ms 打开延迟；拖动启动失败仍保持关闭抑制，避免失败路径自动弹出。
- 按用户要求将展开方向收敛为只按当前位置选择左/右，上/下位置不再切换垂直弹窗布局；已移除临界打开后验失败路径，恢复原有窗口打开成功语义。

#### 进行中

- 等待用户使用最新 `0.3.6` 候选重新验证屏幕中间、自由位置和四边四角的悬浮球最近记录展开。

#### 阻塞与风险

- 尚未由代理代替用户执行 Windows 11 桌面手工验收；候选包需要重新安装/启动后验证，旧进程或旧安装包不会包含本次修复。

#### 下一步

- 用户用最新候选包先把悬浮球拖到屏幕中间，释放后覆盖球体，确认面板能重新弹出；再回归左右边缘、上/下边缘、四角和多显示器组合。
- 用户记录通过/失败编号及 P0-P3 影响后，再决定是否进入计划第 9 节 Git/Release 流程。

#### 验证

- `npm.cmd run test:floating-ball`：16 项通过，包含拖动释放后恢复 hover 的回归用例。
- `npm.cmd run tauri:build`：通过，已重建 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；loader 校验通过，160320 bytes，Windows x64。
- `git diff --check`：通过；生成 ACL 已确认不含已移除的 `outer-size` 权限，`49218` 临时端口已释放。

## 2026-08-30

### 0.3.6 悬浮球悬停弹窗优化候选实现

#### 已完成

- 按 `AGENT.md` 和当前 `PROJECT_PLAN.md` 完成悬浮球阶段 A-E 的代码级实现；本轮只触及悬浮球相关源码、测试、样式、版本入口和同步文档，没有修改 Sites 约定文件、索引 v3、设置 v2、预览协议或 capability。
- 将几何计算收敛为 `floatingBallGeometryModel.js` 纯模型，并由 `floatingBallModel.js` 保持原有导出路径；统一表达 `ballRect`、`panelRect`、`hostRect`、`workArea`、`direction` 和 `scaleFactor`，面板空间不足时按工作区压缩尺寸并保留面板内部滚动。
- 打开面板前读取实际 `outerPosition`、当前显示器工作区和缩放因子，方向只按左右剩余空间/水平位置选择；展开 host 只使用当前显示器工作区，不把任务栏占用的区域当作可用空间。
- 方向选择覆盖四边、四角、自由位置和负坐标工作区；顶部/底部位置不再切换垂直弹窗布局，面板只在垂直轴做工作区 clamp。
- 新增 `floatingBallHoverController.js`，统一 pointer enter/leave、`floating-near`、显式点击、Escape、关闭按钮和拖动抢占；打开/收起使用单一 timer，异步窗口操作使用递增操作序号，旧结果不能覆盖新状态。
- 新增窗口几何、记录/收藏/拖放和拖动/位置保存 feature hook；`FloatingBallWindow.jsx` 收敛为 controller 接线、反馈状态和视图渲染，所有悬浮球模块控制在仓库建议的 300 行以内。
- 将面板改为绝对定位的稳定 host 布局，球体到面板无空隙，关闭按钮归入面板标题栏；固定面板最大尺寸、列表内部滚动、长文本省略、反馈换行、焦点环和 `aria-expanded`/`aria-pressed` 等交互语义。
- 保持 `floating-ball.json` v1、索引 v3、最近记录/收藏 command 和 `index-changed` 同步语义不变；程序化窗口移动不会再被 `onMoved` 误判为用户拖动。
- 版本入口已统一为 `0.3.6`：前端 package、package-lock 根包、Tauri 配置、Rust crate、Cargo.lock 根包、README 和本进度记录均已同步；`0.3.0` 仍作为上一版稳定回退基线。

#### 进行中

- 等待用户在 Windows 11 Tauri `0.3.6` 候选上完成阶段 A-E 的四边四角、多显示器、DPI、任务栏、拖动、重启恢复和组合交互手工验收；手工验收未完成前不标记阶段 F 通过。

#### 阻塞与风险

- 本轮未代替用户启动或验收 Tauri 桌面应用；真实 Windows WebView2、透明置顶窗口、文件拖放、跨显示器负坐标、不同 DPI、显示器断开恢复和安装包行为仍需用户按计划验收。
- 已生成 `0.3.6` Windows x64 NSIS 候选安装包，但尚未进行安装/启动手工验收；没有执行 commit、merge、push、tag 或 GitHub Release，上一版 `v0.3.0` Release 保持不变。
- 面板几何统一在 DIP 中计算，再在 `floatingBallApi.js` 入口转换为物理像素；不同 DPI 显示器的实际 Windows 坐标语义仍属于桌面验收风险，失败时应记录显示器排列、缩放和复现步骤。

#### 下一步

- 用户使用 `PROJECT_PLAN.md` 阶段 F 清单启动 `0.3.6` 候选，优先验收四边四角展开、球体到面板过渡、快速覆盖/离开、拖动抢占、空/满/失效/反馈列表状态以及双显示器/DPI/负坐标组合。
- 用户将通过项、失败项、P0-P3 影响级别和 Windows/WebView2/显示器信息写回本文件；只有用户明确回复通过后，才执行计划第 9 节的提交、合并、推送、tag 和 Release 流程。

#### 涉及文件

- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/floatingBallGeometryModel.js`
- `prototype/src/features/floating-ball/floatingBallHoverController.js`
- `prototype/src/features/floating-ball/useFloatingBallWindowGeometry.js`
- `prototype/src/features/floating-ball/useFloatingBallRecords.js`
- `prototype/src/features/floating-ball/useFloatingBallDrag.js`
- `prototype/src/styles.css`
- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/tests/floating-ball-model.test.mjs`
- `prototype/tests/floating-ball-hover.test.mjs`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src-tauri/tauri.conf.json`
- `README.md`
- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`

#### 验证

- `npm.cmd run test:floating-ball`：16 项通过，覆盖模型几何、四边四角、左右方向选择、负坐标、工作区不足、DPI 转换、状态机延迟、重入、显式收起、拖动抢占和关闭失败。
- `node --check`：悬浮球模型、几何模型、hover controller、窗口几何、记录和拖动模块均通过语法检查。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`；仅产生被忽略的构建产物。
- 临时 Vite `49218` 浏览器回退检查：点击/Enter 打开、鼠标覆盖延迟打开、球体到面板过渡保持、离开延迟收起、关闭按钮和 Escape 均通过；未读取或上传真实文件，验证结束后已关闭标签和服务。
- `git diff --check`：通过，包含本轮代码和同步文档。
- `cargo fmt --all -- --check`：通过；`cargo test`：45 项通过；`cargo check`：通过。此次未修改 Rust 原生逻辑或 capability，未追加 `cargo clippy`。
- 版本一致性检查：`prototype/package.json`、package-lock 根包、Tauri 配置、Rust crate 和 Cargo.lock 根 package 均为 `0.3.6`。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.6_x64-setup.exe`；`verify:loader` 确认 Windows x64 `WebView2Loader.dll` 为 `160320` bytes，并与 release 主程序位于同一目录。该构建产物被 `.gitignore` 忽略。

## 2026-08-30

### GitHub Release 自动发布流程

#### 已完成

- 新增 `.github/workflows/release.yml`，由推送 `vX.Y.Z` 标签触发 Windows x64 发布构建。
- Action 使用锁定的 `package-lock.json` 和 `Cargo.lock` 安装/构建依赖，并校验标签与前端包、Tauri 配置和 Rust crate 的项目版本一致。
- Release 自动生成当前版本的 NSIS 安装包，并从 release 应用目录提取主程序和 `WebView2Loader.dll` 生成便携 ZIP。
- Release 使用 `gh release` 自动创建或更新并发布对应版本，重复执行时会覆盖同名资源。
- 根目录 README 已补充标签发布命令、Release 资源说明和便携 ZIP 的运行边界。

#### 进行中

- 无；`v0.3.0` GitHub Release 已完成云端构建并正式发布。

#### 阻塞与风险

- 当前 Release 构建未配置代码签名；WebView2 Runtime 仍依赖目标机已有安装，LibreOffice 仍是 DOC 预览可选依赖。

#### 下一步

- 下一个版本继续推送与项目版本一致的 `vX.Y.Z` 标签，并检查 Action 构建日志、Release 资源下载、安装包安装和便携 ZIP 解压启动。

#### 涉及文件

- `.github/workflows/release.yml`
- `README.md`
- `PROJECT_PROGRESS.md`

#### 验证

- `actionlint .github/workflows/release.yml`：通过。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.0_x64-setup.exe`。
- `npm.cmd run verify:loader`：随 `tauri:build` 通过；确认 `WebView2Loader.dll` 为 Windows x64，大小 `160320` bytes，并与 release 应用主程序同目录。
- GitHub Actions 运行 [`33298099961`](https://github.com/ChaceQC/Data-Collection/actions/runs/33298099961)：通过；版本校验、loader 预置、Windows x64 Tauri 构建、NSIS 打包、便携 ZIP 内容检查和 Release 上传均完成。
- GitHub Release [`v0.3.0`](https://github.com/ChaceQC/Data-Collection/releases/tag/v0.3.0)：已发布，包含一个 Windows `.exe` 安装包和一个便携 `.zip` 压缩包。
- `git diff --check`：待本次进度记录提交前执行。

## 2026-08-30

### 0.3.0 阶段 H 验收完成与发布同步

#### 已完成

- 用户确认 Windows 11 桌面端第 6.3 节 1-17 项全部验收通过，包含系统托盘、关闭/退出、悬浮窗开关、主窗口拖动、跨显示器与 DPI、托盘最近任务/收藏、生命周期、预览回归和 NSIS 安装后 loader 检查。
- `0.2.8` 的主窗口顶部拖动带和页面标题拖动修复已纳入 `0.3.0`，交互控件排除规则保持不变。
- `PROJECT_PLAN.md` 阶段 H、最终完成条件、当前执行入口和实现快照已更新为完成状态。
- 前端 package、package-lock 根包、Tauri 配置、Rust crate、Cargo.lock 根包、README 和进度文档已统一到 `0.3.0`。

#### 进行中

- 无；`0.3.0` 阶段 H 发布门槛已完成。

#### 阻塞与风险

- 当前没有用户验收阻塞；WebView2 Runtime 仍依赖目标机已有安装，LibreOffice 仍是 DOC 预览可选依赖，安装包仍未签名。

#### 下一步

- 维护 `0.3.0` 的外部依赖边界；后续涉及托盘、关闭语义、窗口拖动或安装目录的改动需重新执行对应验收。

#### 涉及文件

- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/README.md`
- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`

#### 验证

- 用户确认 Windows 11 桌面手工验收全部通过。
- `git diff --check`：通过。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.0_x64-setup.exe`。
- `WebView2Loader.dll` release 检查：通过，大小 `160320` bytes、SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`，与 Windows x64 release 主程序同目录。

## 2026-08-30

### 0.2.8 主窗口拖动入口修复（已验收，已纳入 0.3.0）

#### 已完成

- 恢复并扩大 Tauri 2 官方 `data-tauri-drag-region="deep"`：新增覆盖窗口顶部的拖动带，同时保留页面标题拖动区域。
- Tauri 官方拖动脚本只响应鼠标左键，并排除按钮、输入框、下拉框、文本域、链接、按钮角色和显式非拖动区域；浏览器回退不会调用桌面窗口 API。
- 为顶部拖动带和页面标题增加可见的移动光标和不可选标题样式，保持窗口控制、搜索、排序、资料列表、拖放和模态交互的独立行为。
- 将 `prototype/package.json`、package-lock 根包、Tauri 配置、Cargo 根包、Cargo.lock 根包和 README 统一同步到 `0.2.8`。
- 更新 `PROJECT_PLAN.md`，增加 `0.2.8` 主窗口拖动修复检查点，并保留真实 Windows 11 拖动验收为未完成条件。

#### 进行中

- `0.2.8` Windows 桌面开发版已由用户完成标题栏拖动及各交互区域验收。

#### 阻塞与风险

- 真实无装饰窗口拖动、双显示器/负坐标移动和最大化恢复已由用户在 Windows 11/WebView2 桌面环境确认；后续改动需要重新执行对应验收。
- 托盘、关闭隐藏、悬浮窗组合和 NSIS 安装后 loader 检查已在阶段 H 验收中通过；WebView2 Runtime、LibreOffice 和安装签名仍是既有发布边界。

#### 下一步

- 用户已在 Tauri 开发版中拖动标题栏空白区域，并确认窗口控制、搜索、排序、资料行、预览和拖放区没有误触发拖动。

#### 涉及文件

- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/README.md`
- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`

#### 验证

- `git diff --check`：通过。
- `npm.cmd run build`：通过，生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo check`：通过，Rust crate 版本为 `0.2.8`。
- `npm.cmd run tauri:dev`：已启动，Tauri 原生开发窗口正在等待 Windows 手工验收。
- Windows 桌面手工验收：用户已确认通过；最终 `0.3.0` 发布构建已在上方条目复核。

## 2026-08-30

### 悬浮窗重开死锁与最近列表收藏修复

#### 已完成

- 修复 Windows 下运行时开启悬浮窗的死锁：`update_settings`、`set_floating_window_visible` 和 `retry_floating_ball` 改为异步 command，托盘切换改为异步任务，避免同步 IPC/托盘事件调用 `WebviewWindowBuilder`。
- 修复悬浮窗反复关闭/开启时靠近监视线程令牌复用导致旧线程复活和叠加的问题；每次启动监视使用新的停止令牌，并在窗口显示成功后再启动监视。
- 为悬浮窗最近文件列表增加独立的收藏/取消收藏按钮，复用现有 `set_favorite` 索引写入和 `index-changed` 跨窗口同步；同步补充悬浮窗 capability 权限。
- 修正 NSIS 发布载荷：在 `tauri.conf.json` 中将构建生成的 `WebView2Loader.dll` 映射到安装目录根部，确保安装包实际包含 loader，而不是只生成在 `target/release`。
- 清理当前工作树中遗留的旧 Cargo debug 构建缓存，默认路径下的构建不再引用旧 `C:\Users\q-lau\Documents\test` 路径。

#### 进行中

- Windows 11 的托盘、显式退出、跨 DPI 位置恢复和安装后 loader 检查仍按阶段 H 由用户手工验收。

#### 阻塞与风险

- 首次 `cargo check --release` 曾因已有 release 应用进程锁定 `target\release\local-material-workbench.exe` 返回 Windows `os error 32`；进程释放后再次检查已通过，未终止用户进程。
- 浏览器回退和当前开发版行为已检查，但不能替代用户对真实托盘和安装包生命周期的验收。

#### 下一步

- 用户在 Windows 桌面端验证悬浮窗关闭/开启、悬浮列表收藏持久化及主窗口/托盘同步，再继续阶段 H 验收记录。

#### 涉及文件

- `prototype/src-tauri/src/windows/mod.rs`
- `prototype/src-tauri/src/commands/settings.rs`
- `prototype/src-tauri/src/commands/window.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/windows/tray.rs`
- `prototype/src-tauri/capabilities/floating.json`
- `prototype/src-tauri/gen/schemas/capabilities.json`
- `prototype/src-tauri/tauri.conf.json`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/styles.css`
- `prototype/README.md`

#### 验证

- `npm.cmd run test:floating-ball`：9 项通过。
- `npm.cmd run test:tray`：3 项通过。
- `npm.cmd run build`：通过，Sites 产物均生成。
- `cargo fmt --all -- --check`：通过。
- `cargo check`：通过，构建路径显示为当前 `E:\Project\test`。
- `cargo check --release`：通过，构建路径显示为当前 `E:\Project\test`。
- `npm.cmd run tauri:build`：通过，生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.2.7_x64-setup.exe`。
- release loader 校验：通过，`WebView2Loader.dll` 为 `160320` bytes，与主程序位于同一 Windows x64 release 目录。
- NSIS 载荷复核：通过，生成的 `target/release/nsis/x64/installer.nsi` 包含 `File /a "/oname=WebView2Loader.dll"`，目标为 `$INSTDIR` 根目录。
- Playwright 浏览器回退：收藏按钮切换、收起后重新展开通过；用户确认当前开发版桌面悬浮窗恢复正常。

### 0.2.7 阶段 A-G 开发实现与发布候选构建

#### 已完成

- 按当前 `PROJECT_PLAN.md` 落地设置 v2：新增 `hideToTray`、`showFloatingWindow`，支持 v1 兼容读取、原子迁移、非法布尔值回退和迁移写入失败时保留旧文件。
- 新增原生窗口生命周期服务和唯一托盘服务：固定 `main-tray` ID、产品 tooltip、打开主窗口/设置、显示或隐藏悬浮窗、最近任务子菜单和显式退出；托盘菜单事件只接受内部 ID。
- 新增只读 `tray_status` command，主窗口启动时主动读取托盘可用状态，避免启动事件早于前端监听器而丢失错误提示。
- 将关闭请求接入 `hideToTray` 状态机：普通关闭可隐藏到托盘，显式退出先清理悬浮窗和预览资源，再销毁主窗口并退出；托盘不可用时阻止无提示隐藏并向主窗口发送安全提示。
- 将 `showFloatingWindow` 接入启动和运行时设置：关闭时停止靠近轮询并销毁悬浮窗，开启时按持久化位置幂等重建，失败保留用户意图并返回可诊断状态。
- 明确主窗口标题栏拖动区域并为窗口控制、拖放区、资料列表、设置模态和预览交互增加非拖动标记；浏览器/Sites 回退不调用桌面窗口 API。
- 抽取共享最近任务/收藏模型，托盘任务最多显示 5 条，清理危险/超长文案；收藏动作复用索引原子写入并通过 `index-changed` 同步主窗口和悬浮球。
- 新增 `verify-webview2-loader.mjs`，校验 loader 存在、PE x64 架构、非空、SHA-256 和与 release 主程序同目录布局；`tauri:build` 自动执行该检查。
- 将前端、Tauri 配置、Rust crate、锁文件、README 和生成 permission/schema 入口统一同步到 `0.2.7` 开发候选。

#### 进行中

- 阶段 H 的真实 Windows 11 手工验收仍待用户执行，尤其是托盘唯一性、关闭隐藏/显式退出、悬浮窗四种组合、跨显示器拖动、动态任务菜单和设置重启恢复。
- NSIS 安装后的实际目录检查、首次启动、升级、卸载和重装尚未由代理代替用户完成；当前 loader 证据仅覆盖 release 输出目录。

#### 阻塞与风险

- 当前没有代码编译阻塞；Tauri 2 tray API、无装饰窗口行为和 WebView2 媒体/Runtime 兼容性仍需目标 Windows 环境确认。
- `WebView2Loader.dll` 只负责加载器，安装包仍使用 `webviewInstallMode=skip`，不内置 WebView2 Runtime；安装器未签名。
- 浏览器回退可以演示设置字段和页面状态，但不能替代系统托盘、窗口关闭语义、原生拖动或安装目录检查。
- 设置迁移写入失败的真实文件系统故障注入尚未单独自动化；当前代码依赖 `AtomicWriteFile` 的失败即保留旧文件语义，后续可在 Windows 权限夹具中补充验证。

#### 下一步

- 使用 `tests/fixtures/desktop-acceptance/` 和无敏感测试文件完成 `PROJECT_PLAN.md` 第 6.3 节第 1-17 项，记录 Windows/WebView2 版本、通过项和阻断项。
- 将安装包实际安装到临时用户目录，确认主 exe 同目录存在 `WebView2Loader.dll`，然后按结果决定是否进入 `0.3.0` 发布门槛。

#### 涉及文件

- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/windows/`
- `prototype/src-tauri/src/commands/settings.rs`
- `prototype/src-tauri/src/commands/window.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src-tauri/build.rs`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src-tauri/capabilities/default.json`
- `prototype/src-tauri/permissions/autogenerated/`
- `prototype/src-tauri/gen/schemas/`
- `prototype/src/features/settings/`
- `prototype/src/features/tray/`
- `prototype/src/features/floating-ball/`
- `prototype/src/App.jsx`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/styles.css`
- `prototype/scripts/verify-webview2-loader.mjs`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/README.md`
- `PROJECT_PLAN.md`

#### 验证

- `npm.cmd run test:settings`：4 项通过。
- `npm.cmd run test:tray`：3 项通过。
- `npm.cmd run test:library`：5 项通过。
- `npm.cmd run test:preview`：4 项通过。
- `npm.cmd run test:floating-ball`：9 项通过。
- `npm.cmd run test:sites`：4 项通过。
- `npm.cmd run build`：通过，Sites 产物 `dist/client/index.html`、`dist/server/index.js`、`dist/.openai/hosting.json` 均生成。
- `cargo fmt --all -- --check`、`cargo check`、`cargo test -- --test-threads=1`：通过，Rust 共 45 项测试通过。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，生成 `本地资料工作台_0.2.7_x64-setup.exe`。
- `npm.cmd run verify:loader`：通过；loader 大小 `160320` bytes，SHA-256 为 `8427b1fc58ec707813e5c0a51eb5d69397bb333250a7b891be4d3b123f1e0f1c`，release 主程序同目录检查通过。
- loader 来源为锁定的 `webview2-com-sys v0.38.2` 构建输出，经 Tauri bundler 自动放置到 Windows x64 release 主程序目录；未把 DLL 固定副本提交到仓库。
- 未执行真实 Windows 托盘、关闭/隐藏、原生拖动和安装后目录手工验收，未以浏览器演示替代这些项目。

## 2026-08-30

### 0.3.0 桌面生命周期与发布优化计划重写

#### 已完成

- 根据最新需求，将当前执行计划改写为面向 `0.3.0` 的系统托盘、关闭隐藏、悬浮窗可见性、主窗口拖动、托盘任务收藏和 `WebView2Loader.dll` 发布优化路线。
- 移除旧版 `PROJECT_PLAN.md` 的悬浮球发布计划内容，并以新的分阶段计划替换；检查根目录未发现需要并行维护的独立 `PLAN.md`。
- 固定版本策略：计划重写当天继续保持应用版本 `0.2.0`，阶段 A-G 完成后依次更新 `0.2.1` 至 `0.2.7`，全部实现、Windows 手工验收和安装包检查完成后再更新为 `0.3.0`。
- 在新计划中明确设置格式 v1 到 v2 迁移、托盘菜单和事件边界、关闭请求与显式退出的区分、悬浮窗运行时开关、主窗口拖动排除区域、托盘收藏同步以及安装后 loader 文件检查。

#### 进行中

- 本次仅完成计划和进度文档重写，尚未修改系统托盘、设置、窗口行为或构建配置源码。
- 下一执行阶段为阶段 A：设置 v2、生命周期/托盘契约和最小验证骨架。

#### 阻塞与风险

- 当前没有实现阻塞；Tauri 2 的托盘 API、无装饰窗口关闭拦截、悬浮窗重建和 NSIS 资源落位仍需在实现后以真实 Windows 11 环境验证。
- `WebView2Loader.dll` 与 WebView2 Runtime 是不同组件；本计划只要求 loader 随安装包提供，Runtime 依赖边界继续保持并在 README 中说明。
- 当前工作树已有前序悬浮球实现改动，本次不撤销、不覆盖这些改动，也不因写计划运行大规模测试。

#### 下一步

- 按 `PROJECT_PLAN.md` 阶段 A 清单实现设置 v2 迁移、两个布尔设置、状态机契约和针对性测试；阶段完成并验证后统一同步版本 `0.2.1`。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`

#### 验证

- 已使用 UTF-8 读取 `AGENT.md`、`prototype/AGENTS.md`、现有计划、进度、README、Tauri 配置、Rust 设置/窗口/命令和前端设置/悬浮球实现。
- 已检查根目录计划文件，当前只有 `PROJECT_PLAN.md`，未发现独立 `PLAN.md`。
- 本次为文档重写，未运行前端、Rust 或安装包全量测试。

## 2026-08-30

### 0.2.0 发布与 Windows 手工验收完成

#### 已完成

- 用户确认 Windows 11/WebView2 桌面验收完成，覆盖计划第 6.3 节的悬浮球启动、置顶、拖放记录、最近 5 条、展开/收起、双屏 DPI、边缘吸附、位置恢复、跨窗口同步、生命周期和键盘操作场景。
- 双屏边缘展开/收起时的 DPI 坐标跳变问题已确认修复，悬浮球不会在两个显示器边界之间乱闪。
- 已将 `prototype/package.json`、`package-lock.json` 根包、Tauri 配置、Cargo 根包、`Cargo.lock` 根包、README、计划和进度统一同步到 `0.2.0`。
- 已生成 Windows x64 NSIS 安装包：`prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.2.0_x64-setup.exe`。

#### 进行中

- `0.2.0` 发布门槛已完成；后续仅按现有外部依赖边界维护，不新增本计划之外的功能。

#### 阻塞与风险

- 用户未提供具体 Windows/WebView2 版本和测试夹具名称，进度文档不臆填这些环境字段；用户未报告 P0/P1 阻塞。
- WebView2 Runtime、LibreOffice、视频编码、SheetJS 和未签名安装包等既有发布边界风险保持不变。

#### 下一步

- 维护 `0.2.0` 已发布构建的安装、卸载和外部依赖说明；不上传安装包或修改远程仓库。

#### 涉及文件

- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src-tauri/tauri.conf.json`
- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- `prototype/README.md`

#### 验证

- `npm.cmd run test:library`、`test:settings`、`test:preview`、`test:floating-ball`、`test:sites`：共 25 项通过。
- `npm.cmd run build`：通过。
- `cargo fmt --all -- --check`、`cargo check`、`cargo test -- --test-threads=1`（39 项）和 `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，生成 `本地资料工作台_0.2.0_x64-setup.exe`。
- 已检查版本入口和工作树，项目版本入口均为 `0.2.0`，未发现未跟踪构建产物；Cargo lock 中的第三方依赖版本不作项目版本替换。

## 2026-08-29

### 双屏 DPI 边缘闪烁修复

#### 已完成

- 定位并修复双屏边界附近展开/收起时的坐标单位混用：Tauri 读取的窗口位置、尺寸和移动事件统一按物理像素处理，面板几何计算和 `floating-ball.json` 持久化继续使用 DIP。
- 展开面板时按当前显示器缩放比例将宿主矩形转换为物理位置/尺寸；收起时复用展开前的缩放比例和球体锚点，避免窗口被另一块屏幕的 DPI 重新解释并在屏幕边界跳动。
- 移除临时的窗口位置诊断输出，新增 `1.5x` DPI、负坐标工作区和 DIP/物理像素往返测试。

#### 进行中

- 代码修复和开发侧检查已完成，仍等待用户在实际双屏 Windows 11/WebView2 环境确认靠近边缘时不再闪烁。

#### 阻塞与风险

- 代理未替用户完成真实桌面手工验收；不同显示器排列、缩放比例、任务栏工作区、拖动跨屏和重启位置恢复仍以用户的 Windows 验收为准。
- 版本继续保持 `0.1.5`，未因代码修复直接升级 `0.2.0`。

#### 下一步

- 使用最新开发版或安装包，在双屏环境把悬浮球放到主屏右边缘，仅移动鼠标靠近并反复展开/收起，确认窗口位置不在两块屏幕边界之间跳变。
- 用户完成计划第 6.3 节验收后，再决定是否统一升级到 `0.2.0`。

#### 涉及文件

- `prototype/src/features/floating-ball/floatingBallApi.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/tests/floating-ball-model.test.mjs`
- `prototype/src-tauri/src/windows/monitor.rs`
- `PROJECT_PROGRESS.md`

#### 验证

- `npm.cmd run test:floating-ball`：9 项模型测试通过，包含多 DPI 物理坐标转换。
- `npm.cmd run build`：Vite 和 Sites 构建通过。
- `cargo fmt --all -- --check`、`cargo test -- --test-threads=1`（39 项）、`cargo check` 和 `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：通过，已重新生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.5_x64-setup.exe`。
- `git diff --check`：通过；未发现项目内临时诊断日志或残留 `floating near` 输出。

### 悬浮球阶段 A-E 代码实现与开发侧验证

#### 已完成

- 完成索引 v2 到 v3 的兼容迁移：`IndexEntry` 增加可为空的 `lastRecordedAt`；v1/v2 旧记录迁移后保持空值，不会虚构悬浮球记录。
- 抽取共享索引合并逻辑，普通主窗口导入保留悬浮球时间，悬浮球记录对新增和已存在路径使用毫秒级时间戳，保留 ID、收藏、添加时间和预览状态。
- 新增独立的 `floating-ball.json` v1 原子存储、字段校验、损坏/缺失回退、工作区夹紧和显示器标识处理；位置数据不写入索引或设置文件。
- 新增 `floating-ball` Tauri 窗口、透明/无装饰/置顶/跳过任务栏配置、创建失败降级、主窗口关闭清理和应用退出清理。
- 新增 `record_floating_paths`、`get_floating_recent`、`open_main_from_floating`、`load_floating_placement`、`save_floating_placement` 和 `floating_window_status`，悬浮球 capability 只开放必要的 command、窗口和事件权限。
- 增加主窗口可执行的 `retry_floating_ball` 入口；悬浮球创建失败时显示可重试横幅，成功恢复后清除错误状态。
- 新增悬浮球 React 路由、最近 5 条面板、拖放状态、防重复提交、部分失败反馈、失效记录、键盘焦点、面板方向、靠近滞回、窗口移动去抖和边缘吸附模型。
- 修正面板展开时的球体锚点：横向布局不再垂直漂移，面板宿主会在工作区内夹紧并用偏移保持球体位置；位置保存失败会保留可见错误状态和下次启动提示。
- 修正悬浮球点击文件夹记录后的主窗口行为，现会进入现有目录浏览；增加对应的工作区边界和锚点纯函数测试。
- 修复悬浮球无法展开的实际运行时问题：`currentMonitor()` 是 Tauri 模块级 API，错误的实例级调用会让 `openPanel()` 进入失败回退；改正后开发版受控点击可将窗口从 `136x64` 扩展到 `384x322`。
- 靠近监视线程保持 `80ms` 采样，并以 `400ms` 间隔重发当前状态以覆盖 WebView 初始化时序；前端在滞回带内保持状态，避免周期事件造成反复展开/折叠。
- 快速连续 drop 在当前记录任务期间进入内存队列，按顺序串行提交并去除队列内重复路径，不再静默丢弃后续拖入。
- 扩充 `tests/fixtures/desktop-acceptance/悬浮球验收/` 无敏感夹具，覆盖 6 条不同最近记录、中文/空格路径、Markdown、Python、JSON 和文件夹节点场景。
- 主窗口接入 `floating-recorded`、`floating-open-file` 和索引刷新事件；移除、删除、重命名、重新定位和普通导入会按 ID 同步悬浮球，不向事件或展示数据泄露完整路径。
- README、计划勾选状态、版本字段和 `.gitignore` 已同步到阶段 E 的 `0.1.5`；Sites 约定文件未修改。

#### 进行中

- 阶段 A-E 的代码实现和开发侧自动验证完成；阶段 F 仍等待用户在 Windows 11/WebView2 桌面环境执行悬浮球手工验收，完成前不升级到 `0.2.0`。

#### 阻塞与风险

- 尚未由代理执行或宣称 Windows 桌面手工验收：真实资源管理器拖放、透明置顶窗口、任务栏避让、窗口生命周期、不同 DPI/多显示器、重启位置恢复和真实文件样本仍需用户按 `PROJECT_PLAN.md` 第 6.3 节检查。
- Rust runtime 窗口模块在 `cargo test` 中隔离以避免当前 Windows GNU 测试进程的 `STATUS_ENTRYPOINT_NOT_FOUND`；`monitor.rs` 的纯位置算法通过测试入口单独编译并执行，runtime 代码由 `cargo check` 和 Tauri 构建编译，仍需在目标 Windows 环境做最终行为验证。
- SheetJS 漏洞、WebView2 Runtime、LibreOffice、视频编码和未签名安装包仍是既有发布边界风险；本次未放宽任何格式或系统权限。

#### 下一步

- 用户使用 `tests/fixtures/desktop-acceptance/` 和无敏感临时文件完成计划第 6.3 节 12 项检查，记录 Windows/WebView2 版本、通过项、失败项和是否阻断 `0.2.0`；代理不以浏览器演示替代该验收。
- 若手工验收全部通过，再将版本位置统一提升到 `0.2.0`，执行发布验证并生成/检查 Windows x64 NSIS 安装包。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- `prototype/README.md`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src/main.jsx`
- `prototype/src/App.jsx`
- `prototype/src/features/floating-ball/`
- `prototype/src/features/library/`
- `prototype/src/styles.css`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/floating_ball.rs`
- `prototype/src-tauri/src/commands/`
- `prototype/src-tauri/src/windows/`
- `prototype/src-tauri/capabilities/`
- `prototype/src-tauri/permissions/autogenerated/`

#### 验证

- `npm.cmd run test:floating-ball`：模型 8 项测试通过。
- 开发版真实启动诊断：浮球 WebView URL 正确包含 `?window=floating-ball`；修复前点击只移动/不展开，修复后点击成功展开为 `384x322`。
- `npm.cmd run test:library`、`npm.cmd run test:settings`、`npm.cmd run test:preview`、`npm.cmd run test:sites`：既有回归全部通过。
- `npm.cmd run build`：Vite 构建通过，并生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --all -- --check`、`cargo test`：Rust 格式检查通过，39 项测试通过，包含显示器工作区位置归一化；窗口运行时模块由 `cargo check` 和 Tauri 构建编译。
- `cargo clippy --all-targets --all-features -- -D warnings`：通过。
- `npm.cmd run tauri:build`：Tauri 动态窗口 capability 和 Windows x64 NSIS 构建通过，已生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.5_x64-setup.exe`。
- 已在临时 Vite 页面检查 `?window=floating-ball` 浏览器回退：只使用内存演示记录，浮球点击展开/收起，列表最多 5 条；临时服务和浏览器会话已关闭。

## 2026-08-29

### 悬浮球功能计划重写

#### 已完成

- 根据最新需求，将根目录旧版 `PROJECT_PLAN.md` 整体替换为悬浮球功能实施计划；当前执行入口只保留新的 `PROJECT_PLAN.md`，未发现需要并行维护的 `PLAN.md`。
- 新计划明确悬浮球、文件直接拖入记录、鼠标靠近展示最近 5 条和屏幕边缘吸附四项能力，并把索引 v3、位置文件 v1、跨窗口事件、Windows 多显示器/DPI 和手工验收写入阶段门槛。
- 新计划明确版本序列：当前保持 `0.1.0`，阶段 A-E 完成后依次更新为 `0.1.1` 至 `0.1.5`，全部功能和 Windows 验收完成后再更新为 `0.2.0`。
- 本次只变更计划和进度文档，没有新增 command、窗口、依赖、权限或用户数据文件。

#### 进行中

- 悬浮球功能尚未实现；当前应用仍按既有 `0.1.0` 基线运行，下一执行阶段为阶段 A 的索引 v3 和 `floating-ball.json` v1 数据基础。

#### 阻塞与风险

- 当前没有代码实现阻塞；透明置顶窗口、Windows 光标靠近检测、跨显示器坐标和高 DPI 贴边行为必须在实现后由 Windows 11/WebView2 桌面环境手工验收，不能用浏览器回退替代。
- 新增索引字段会影响 v2 到 v3 迁移；必须保留旧索引、原子写入并避免普通主窗口导入虚构悬浮球最近记录。
- 现有 SheetJS、WebView2、LibreOffice、视频编码和未签名安装包风险继续沿用既有记录，不因本次计划重写而宣称已解决。

#### 下一步

- 实现阶段 A：增加 `lastRecordedAt`、索引 v3 迁移、独立位置文件 v1、字段保留规则和针对性 Rust 单测；完成后同步版本 `0.1.1`。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- 后续实现范围以新计划第 5 节列出的 `prototype/` 文件为准；本次没有修改这些源码文件。

#### 验证

- 已使用 UTF-8 读取仓库规则、当前计划、进度、原型 README、Tauri 配置、Rust 存储/command 和前端入口，确认新计划与当前 `0.1.0` 基线一致。
- 已检查计划结构、阶段版本表、旧计划残留和工作区文件列表；本次为文档变更，未运行前端、Rust 或安装包全量测试。

## 2026-08-29

### 阶段 F 设置、显式外部操作与 Windows 验收完成

#### 已完成

- 实现独立的 `settings.json` 版本 `1`：默认排序、排序方向、每页 10/20/50 条和索引移除确认偏好使用原子写入，与版本 `2` 的 `index.json` 分离。
- 将纯文本、Office、PDF、图片、视频大小上限和图片像素上限抽到统一 Rust 配置；设置面板只读展示这些上限，更新 command 不接受前端传入限制字段。
- 新增设置模态面板和 `load_settings`/`update_settings` command；桌面端保存到 Tauri app data，浏览器回退只在当前会话生效。
- 新增 `open_indexed_file` 和 `reveal_indexed_file`：前端只传记录 ID，Rust 重新取得索引并校验普通文件、文件夹、canonical 路径和符号链接/reparse point；外部打开使用系统文件关联，资源管理器定位使用受控 Windows 适配器，不开放任意 shell。
- 索引移除确认偏好只影响“移除索引记录”；物理删除原文件始终保留影响范围确认。标签/分组、批量操作和通用撤销栈完成评估并延期，决策写入 `docs/phase-f-settings-and-external-operations.md`。
- 同步 `PROJECT_PLAN.md`、`prototype/README.md`、Tauri build command 清单、capability 和新增自动生成权限文件；索引格式未变化，版本继续保持 `0.1.0`。
- 用户已确认阶段 F 的 Windows 桌面手工验收完成，设置重启恢复、默认程序打开和文件/文件夹资源管理器定位不再是当前阻塞项。

#### 进行中

- 阶段 F 基础设置和显式外部操作的实现、开发侧验证与 Windows 手工验收均已完成；当前只进行版本评估。

#### 阻塞与风险

- 当前无阶段 F 验收阻塞；Windows 原生行为已由用户完成手工验收，后续发布仍需保留外部程序、路径权限和 Windows Shell 的依赖边界说明。
- 预览依赖的 SheetJS 漏洞、WebView2 运行时策略、LibreOffice 可选依赖、视频编码兼容性和安装包未签名仍是既有发布边界风险。
- 损坏或非法 `settings.json` 会回退到内存默认值，下一次用户保存时才替换；这不会清空或迁移索引。

#### 下一步

- 基于 P0-P3 的开发侧验证、文档同步和用户 Windows 验收结果，单独评估是否统一升级到 `0.2.0`；在版本决策前保持 `0.1.0`。
- 继续将标签/批量/通用撤销栈标记为延期能力，不因阶段 F 验收完成而扩展当前索引协议。

#### 涉及文件

- `prototype/src-tauri/src/config.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/filesystem/external.rs`
- `prototype/src-tauri/src/commands/settings.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src-tauri/build.rs`
- `prototype/src-tauri/capabilities/default.json`
- `prototype/src-tauri/permissions/autogenerated/`
- `prototype/src/features/settings/`
- `prototype/src/features/library/`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/tests/settings-model.test.mjs`
- `prototype/README.md`
- `docs/phase-f-settings-and-external-operations.md`

#### 验证

- `npm.cmd run test:settings` 已通过 3 项；既有 `npm.cmd run test:library`、`npm.cmd run test:preview` 和 `npm.cmd run test:sites` 分别通过 5、4、4 项。
- `npm.cmd run build` 已通过，Sites 产物继续生成 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --all -- --check`、`cargo test`（31 项）、`cargo check` 和 `cargo clippy --all-targets --all-features -- -D warnings` 均通过；`npm.cmd run tauri:build` 已通过并生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.0_x64-setup.exe`。
- 已用临时 Vite 页面检查设置入口、设置模态框、保存后的排序/分页即时应用、预览限制只读展示和浏览器回退外部操作提示；桌面 1280×800 下资料表无额外横向溢出，窄窗口设置内容可滚动。应用检查未读取真实文件；Edge 关闭标签时有一条浏览器扩展异步通道错误，未指向应用脚本，不能替代 Windows 桌面外部打开验收。

## 2026-08-29

### 资料库核心功能实现、Windows 验收完成与状态同步

#### 已完成

- 按 `PROJECT_PLAN.md` 阶段 A-E 落地资料库核心能力：收藏/取消收藏、从索引移除、名称/类型/状态搜索、添加时间/修改时间/名称/大小排序、每页 20 条分页，以及把普通文件复制到系统剪贴板、同目录重命名和移入系统回收站。
- 将资料库行操作、确认对话框、筛选排序纯函数和 Tauri API 封装拆到 `prototype/src/features/library/`，`App.jsx` 保留窗口、导入、目录和预览编排。
- 索引增加 `addedAt`，从版本 `1` 原子迁移到版本 `2`；收藏、添加时间和预览状态在重复导入、刷新和重新定位时保留，损坏或未知版本不再静默清空索引。
- 新增 `set_favorite`、`remove_index_entry`、`copy_indexed_file`、`rename_indexed_file` 和 `delete_original_file`，Tauri capability 只增加这些业务 command 的最小权限。
- 原文件操作集中使用路径复核、普通文件检查、符号链接/reparse point 拒绝、重命名目标冲突保护和回收站库；文件剪贴板使用 `CF_HDROP` 写入，索引移除不会修改原文件。
- 设置占位入口暂时隐藏，并同步 README；窄窗口资料表恢复六列独立展开，表格区域提供横向滚动，不覆盖状态、修改时间和操作列。
- 按最新布局反馈缩短并自适应拖放区高度，固定左侧任务栏和主窗口视口；主页面不滚动，纵向/横向滚动只发生在 `.file-table-scroll` 列表容器内。
- 根目录 `AGENT.md` 已补充 Windows 浏览器自动化默认使用 Microsoft Edge，Playwright CLI 使用 `--browser msedge`，不因验证流程安装 Chrome。
- 用户已确认资料库核心功能和后续布局调整全部完成 Windows 桌面手工验收：收藏持久化、索引移除、搜索/排序/分页、复制到剪贴板后资源管理器粘贴、重命名、回收站删除、预览资源释放、目录浏览、重启恢复和窄窗口布局均通过。

#### 进行中

- P0-P2 的代码实现、自动化回归和 Windows 手工验收已完成；当前只进行版本评估，阶段 F 的设置模型、显式外部打开、标签/分组和批量操作仍未纳入实现。

#### 阻塞与风险

- P0-P2 不再有用户验收阻塞；SheetJS 已知漏洞、WebView2 运行时策略、LibreOffice 可选依赖、视频编码兼容性和安装包未签名仍属于发布边界风险。

#### 下一步

- 基于用户已完成的验收结果评估是否统一升级到 `0.2.0`；版本升级前同步检查前端、Tauri 配置、Rust crate 和锁文件版本。
- 如继续推进阶段 F，先单独定义设置数据模型和外部打开的最小权限，再更新本计划和 README，不把后续候选混入已验收能力。

#### 涉及文件

- `AGENT.md`
- `PROJECT_PLAN.md`
- `prototype/README.md`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/filesystem/clipboard.rs`
- `prototype/src-tauri/src/filesystem/operations.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src-tauri/build.rs`
- `prototype/src-tauri/capabilities/default.json`
- `prototype/src-tauri/permissions/autogenerated/`
- `prototype/src/features/library/`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/tests/library-model.test.mjs`

#### 验证

- `npm.cmd run test:library` 已通过 5 项纯函数测试。
- `npm.cmd run build` 已通过，Sites 产物仍生成在 `dist/client/`、`dist/server/` 和 `dist/.openai/hosting.json`。
- `npm.cmd run test:preview`（4 项）、`npm.cmd run test:sites`（4 项）和 `npm.cmd run tauri:build` 均通过，已生成 Windows x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.0_x64-setup.exe`。
- `cargo fmt --all -- --check`、`cargo test`（25 项）和 `cargo clippy --all-targets --all-features -- -D warnings` 均通过，覆盖既有预览/索引、新增路径、`CF_HDROP` 文件剪贴板载荷、错误映射和索引迁移测试。
- 已用 Microsoft Edge 检查浏览器回退页面、行操作确认对话框和窄窗口六列展开；确认视口无页面滚动、列表容器 `overflow: auto`、拖放区随视口高度自适应，控制台错误和警告均为 `0`。用户随后确认 Windows 桌面端全部验收通过；具体 Windows/WebView2 版本未提供，不在文档中臆填。验证使用的临时 Edge 会话和 Vite 服务均已关闭。

## 2026-08-29

### Windows 预览验收状态修正与资料库功能规划

#### 已完成

- 用户确认 Windows 桌面端预览验收已经完成；后续不再把图片、视频、XLSX、DOCX、PDF 和 DOC 的桌面验收列为当前阻塞项。
- 确认旧版预览实施计划已经完成并删除，新的后续执行入口为 `PROJECT_PLAN.md`。
- 复核当前代码缺口：`IndexEntry.favorite` 和收藏筛选已存在，但收藏切换 command、行操作和真实持久化交互尚未完成；从资料库移除记录的 command 和界面也尚未实现。
- 确认搜索状态只有未接入的过滤逻辑，设置入口仍为占位提示；这些能力纳入新的资料库功能计划。

#### 进行中

- 按新的 `PROJECT_PLAN.md` 补齐收藏、从资料库移除记录、搜索、排序和最近添加等资料库能力。

#### 阻塞与风险

- 当前没有新的功能实现阻塞；SheetJS 已知风险、WebView2 和 LibreOffice 属于现有预览依赖限制，继续按 README 记录，不因资料库功能改动而放宽安全边界。
- “删除”在 P0/P1 默认指移除本地索引记录，不删除用户原文件；复制、重命名和删除原文件已纳入 `PROJECT_PLAN.md` 阶段 E，必须单独经过回收站、确认和权限方案设计。

#### 下一步

- 先在 Rust `storage` 和 `commands` 中实现 `set_favorite` 与 `remove_index_entry`，增加原子持久化、未知 ID 和原文件不受影响的测试。
- 再在 `prototype/src/features/library/` 拆出收藏按钮、移除确认对话框和资料库状态逻辑，接入 React 与浏览器回退模式。
- P0 完成后实现资料库搜索、排序、真实最近添加语义；P0/P1 稳定后再进入复制、重命名和删除原文件的 P2 阶段，并为每阶段安排最小必要的开发验证和用户手工验收。

#### 涉及文件

- `PROJECT_PLAN.md`
- `PROJECT_PROGRESS.md`
- `prototype/README.md`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src/App.jsx`
- `prototype/src/features/library/`

#### 验证

- 已使用 UTF-8 读取项目 Markdown、代码和现有测试夹具，核对当前实现状态。
- 本次只更新计划和状态文档，未运行前端、Rust 或安装包全量测试；功能实现后按 `PROJECT_PLAN.md` 的最小验证矩阵执行。

## 2026-08-29

### 预览资源 URL 修复

#### 已完成

- 修复 Windows WebView2 二进制预览资源地址：Rust 端直接生成 `http://preview.localhost/<previewId>`，与 Tauri/Wry 的 Windows 自定义协议兼容地址一致；非 Windows 保留 `preview://localhost/<previewId>`。
- 前端资源 URL 归一化改为使用结构化 URL 解析，并兼容旧版 `preview://localhost/` 地址；图片、视频、XLSX、DOCX、PDF 和 DOC 继续只通过随机 `previewId` 访问受控资源，不暴露原始路径。
- 修复 `PreviewContent` 二进制字段序列化名称：显式输出 `resourceUrl`、`mediaType`、`byteLength`、`supportsRange` 和 `sourceKind`，与前端读取协议一致；此前默认 snake_case 字段使所有资源型预览拿到空 URL。
- 增加 Rust 序列化回归测试，确认资源结果不会重新返回 snake_case 字段。
- 修复 PDF 资源初始响应：无 `Range` 请求不再被错误截断为 1 MiB 的 `206`，改为返回完整 `200`；明确的 Range 请求仍保留分段读取，避免 PDF.js 将首块长度误判为文件总长度。
- 增加大于协议分块大小的 PDF 无范围响应回归测试。

#### 进行中

- 等待用户在 Windows 11/WebView2 桌面环境复核各类二进制预览；代理不代替用户执行桌面手工验收。

#### 阻塞与风险

- 资源协议地址问题已完成代码修复；视频编码兼容性、DOC 的 LibreOffice 依赖以及具体样本的渲染差异仍需用户按现有验收矩阵确认。

#### 下一步

- 用户使用现有 `tests/fixtures/preview/` 和真实无敏感样本验证图片、视频、XLSX、DOCX、PDF 与 DOC；如仍有失败，再根据具体格式和错误状态继续定位。

#### 涉及文件

- `prototype/src-tauri/src/preview/resources.rs`
- `prototype/src/features/preview/previewTypes.js`
- `prototype/README.md`

#### 验证

- `cargo fmt --check`、`cargo test`（15 项）、`cargo clippy --all-targets --all-features -- -D warnings` 均通过。
- `npm.cmd run test:preview`（4 项）和 `npm.cmd run build` 均通过，Sites 构建产物正常生成。
- `npm.cmd run tauri:build` 已成功完成，已生成包含 PDF 修复的 Windows x64 release 可执行文件和 NSIS 安装包。
- 未执行 Windows 桌面手工验收，按用户要求由用户自行验证。

## 2026-08-29

### 预览阶段实现

#### 已完成

- 按 `PROJECT_PLAN.md` 完成统一预览协议：新增 `can_preview`、`load_preview`、`dispose_preview`，前端通过 `previewRegistry` 和模态 `PreviewPane` 编排，不把预览解析分支放进文件列表。
- Rust 新增集中式格式注册、预览专用 canonical 路径校验、父目录 symlink/reparse 拒绝、文本大小限制、UTF-8 BOM/UTF-8/GB18030 解码、图片 100 megapixels 校验和状态映射。
- 新增 `PreviewResourceStore` 与 `preview://` 受控资源协议：只接受随机 `previewId`，不接受路径/query，支持 `GET`/`HEAD`、Range、MIME/长度响应、过期清理、显式释放和退出清理；DOC 临时 PDF 只在应用临时目录生成。
- 前端新增纯文本、Markdown、图片、视频、XLSX、DOCX、PDF 和 DOC 适配器。Markdown/DOCX HTML 经过 DOMPurify；表格使用 React 文本节点；PDF 仅由 PDF.js canvas 渲染；视频不自动播放、不隐藏转码；DOC 通过无 shell 的参数数组调用可选 LibreOffice。
- 依赖审计后升级 DOMPurify 到 `3.4.14`、Mammoth 到 `1.12.2`、Vite 到 `6.4.3`，并将 Vite/React 插件移到 `devDependencies`；SheetJS `0.18.5` 无可用修复，XLSX 解析改为可终止、带 30 秒超时的 Worker，并在 README 中记录残余风险。
- 按 `AGENT.md` 体量边界拆分 `preview/mod.rs`、资源存储、资源协议和预览加载器，所有新增 Rust 模块均不超过 300 行，Sites 约定文件保持不变。
- 预览交互按最新反馈统一为模态弹窗；文件夹继续进入目录，失效路径只显示重新定位提示，浏览器/Sites 模式不读取真实本地文件。
- 增加 `tests/fixtures/preview/` 无敏感夹具，包含中文文件名、Markdown 安全攻击样本、代码、JSON、正常 XLSX 和损坏 XLSX/PDF；新增 `test:preview` 注册表检查。

#### 进行中

- 代码实现和开发侧验证已完成，等待用户在 Windows 11/WebView2 桌面环境执行各格式真实预览手工验收；在此之前版本维持 `0.1.0`。

#### 阻塞与风险

- 当前开发侧未替用户宣称图片、视频编码、XLSX、DOCX、PDF 和 DOC 的 Windows 桌面验收通过。
- DOC 依赖目标机已有 LibreOffice；安装包仍使用 WebView2 `skip` 策略，视频容器/编码是否可播放取决于目标 WebView2。
- `npm.cmd audit --omit=dev` 当前只报告 SheetJS 的 1 项 high 且无 fix；该风险通过 Worker 隔离、20 MiB 文件上限、首屏行列限制和 Worker 超时降低，但未消除。
- 本阶段未增加 ffmpeg 或其他隐藏转码链路；未登记的 SVG、MOV、AVI、MKV 等格式保持 `unsupported`。

#### 下一步

- 使用 `tests/fixtures/preview/` 在 Windows 桌面应用中逐项验证纯文本编码、Markdown sanitizer、图片/视频、XLSX、DOCX、PDF、DOC 缺失转换器/超时/失败和关闭后的资源释放。
- 记录目标 Windows/WebView2 版本、夹具、通过项和失败项；只有全部格式完成用户验收后，才评估将版本统一提升到 `0.2.0`。

#### 涉及文件

- `prototype/src-tauri/src/preview/`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src-tauri/capabilities/default.json`
- `prototype/src-tauri/permissions/autogenerated/`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/Cargo.lock`
- `prototype/src/features/preview/`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/README.md`
- `prototype/tests/fixtures/preview/`

#### 验证

- `npm.cmd run build` 通过，Sites 产物仍生成在 `dist/client/`、`dist/server/` 和 `dist/.openai/`；构建仅产生被 `.gitignore` 忽略的产物。
- `npm.cmd run test:preview` 通过，4 项注册表、正常 XLSX 和损坏 XLSX 检查通过。
- `npm.cmd run test:sites` 通过，4 项 Sites worker/打包契约测试通过。
- `npm.cmd audit --omit=dev` 已执行；结果为 SheetJS `0.18.5` 1 项 high、暂无修复，已记录在 `prototype/README.md`，未执行会升级主版本或破坏基线的 `--force` 修复。
- `cargo fmt --check` 通过；`cargo test` 通过，15 项 Rust 单测通过，覆盖缺失路径、损坏 XLSX、Range、未知 ID 和释放；`cargo clippy --all-targets --all-features -- -D warnings` 通过。
- `npm.cmd run tauri:build` 通过，生成 x64 NSIS 安装包 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.0_x64-setup.exe`；构建只产生 `.gitignore` 覆盖的发布产物。
- 已启动临时 `49217` 浏览器服务并检查收纳入口：点击资料行打开模态对话框，浏览器模式显示不读取本地文件，关闭按钮可移除对话框；未选择或上传用户真实文件。
- 尚未启动 Tauri 桌面应用执行原生选择器、真实路径、媒体、LibreOffice 转换和重启/关闭后的 Windows 手工验收。

### 已完成

- 修复桌面应用冷启动时使用一次性内部桥接对象判断运行时的问题，改用 Tauri 官方 `isTauri()`，避免跳过本地索引加载而表现为重启后状态丢失。
- 已先同步文件夹节点、按需目录浏览和每页 20 条分页的协议、实现边界与桌面验收标准，并按该契约完成代码实现。
- 已完成文件夹节点导入、目录直接子项浏览、面包屑返回和每页 20 条分页；目录内容不再混入一级资料库记录。
- 根据桌面验收反馈补充文件列表“大小”列；文件按 B/KB/MB/GB 显示，文件夹显示 `—`。
- 将 Tauri bundle 开启并限定为 Windows x64 NSIS 安装包。
- 配置当前用户安装模式、开始菜单文件夹、项目图标和 `WebView2` `skip` 策略。
- 准备无敏感桌面验收夹具，覆盖中文文件名、空格路径、嵌套目录和单文件选择；本次按用户要求不执行桌面验收。
- 完成 release 安装包构建。

### 进行中

- 桌面功能手工验收主体已通过，待复核最新 release 中的文件大小显示。

### 阻塞与风险

- 安装包没有内置或下载 WebView2 Runtime，目标 Windows 机器必须已有 WebView2。
- 安装包未签名；本次只验证构建产物，不验证安装后的系统注册、快捷方式和卸载流程。

### 下一步

- 使用最新 release 可执行文件复核文件大小列，并保持文件夹记录、进入/返回目录、超过 20 条分页、拖放和重启恢复结果。

### 涉及文件

- `prototype/src-tauri/tauri.conf.json`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/tests/fixtures/desktop-acceptance/`
- `prototype/README.md`
- `PROJECT_PLAN.md`

### 验证

- 已检查 `%APPDATA%\\cn.localmaterialworkbench.app\\index.json` 存在且为版本 `1` 的有效 JSON，确认导入记录已经落盘；已重新运行 `npm.cmd run tauri:build`，release 可执行文件和 NSIS 安装包构建通过。
- 已运行 `cargo check`、`cargo fmt --check`、`npm.cmd run build`、`npm.cmd run test:sites` 和 `npm.cmd run tauri:build`，均通过；待进行桌面手工验收。
- 本次大小列修复后已运行 `npm.cmd run build`、`npm.cmd run test:sites` 和 `npm.cmd run tauri:build`，均通过；最新 release 可执行文件和 NSIS 安装包已生成。
- `npm.cmd run tauri:build` 通过。
- 生成 `prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.1.0_x64-setup.exe`。
- 本次未启动安装器、未启动桌面应用、未执行原生选择器/拖放/重启验收。

## 2026-08-28

### 已完成

- 根据 `AGENT.md` 建立 `prototype/` 桌面端前端原型目录。
- 落地方案 3“收纳入口”的首屏：导入文件夹、选择文件、拖放区域和最近添加列表。
- 增加资料库、最近添加、收藏、失效路径和重新定位等主要交互状态。
- 将 `@phosphor-icons/react` 声明并安装在 `prototype` 项目内，已生成项目锁文件。
- 在依赖管理约束中明确所有运行依赖必须由项目清单声明并安装在项目目录内。
- 按最新设计反馈移除界面中的本地模式、文件离开设备和原文件处理提示，相关安全边界继续保留在项目文档中。
- 完成方案 3 的桌面视口对照验收，生成 `prototype/design-qa.md`，结果为 `passed`。
- 创建 `PROJECT_PLAN.md`，明确 Tauri 2 外壳、真实索引数据模型、command 协议、权限和验收边界。
- 将项目版本统一为 `0.1.0`，安装并锁定 Tauri CLI、Tauri API 和 dialog plugin。
- 从 `prototype/` 初始化 Tauri 2 配置、无装饰窗口、Windows 图标和最小 capability。
- 实现 Rust `filesystem`、`storage` 和 `commands` 模块：路径校验、中文/空格路径、重复合并、失效刷新、重新定位和原子 JSON 持久化。
- 将 React 收纳入口接入 Tauri 原生文件/文件夹选择器、桌面拖放路径、索引状态、重定位 command 和窗口控制；浏览器回退保持可用。
- 增加 Rust 索引和存储单元测试，覆盖嵌套路径扫描、路径比较、JSON 往返和排序。

### 进行中

- Windows 实机手工验证和正式安装包构建仍待具备 MSVC linker 的环境；当前代码级检查已完成。

### 阻塞与风险

- `npm.cmd run tauri -- info` 显示当前环境没有 Visual Studio/MSVC Build Tools，正式安装包和 MSVC 环境下的桌面窗口验证仍待具备对应工具链的环境。
- 尚未在 Windows 桌面窗口中手工验证原生选择器、拖放、应用重启恢复和失效路径重新定位；当前代码级验证已通过。
- 真实索引已经接入，但统一预览接口和各格式预览适配器仍未实现。
- 搜索能力属于后续资料库页面，本次收纳入口首屏不额外展示搜索控件。

### 下一步

- 在 MSVC linker 或等价 Windows 实机环境运行 `npm.cmd run tauri:dev`，验证文件/文件夹选择、真实拖放、重启恢复、重复导入和失效路径重新定位。
- 记录手工验证结果后，再实现统一预览接口和首批 Markdown/TXT 只读预览。

### 涉及文件

- `AGENT.md`
- `prototype/src/App.jsx`
- `prototype/src/styles.css`
- `prototype/package.json`
- `prototype/package-lock.json`
- `prototype/src-tauri/`
- `PROJECT_PLAN.md`
- `prototype/README.md`
- `prototype/design-qa.md`
- `prototype/implementation-option-3.png`

### 验证

- 已运行 `npm.cmd install --prefer-offline --no-audit --no-fund @phosphor-icons/react`，安装完成。
- 已使用临时高位端口 `49217` 完成浏览器验收，随后关闭临时服务和预览标签。
- 已运行 `npm.cmd run build`，构建和 Sites 静态产物生成通过。
- 已运行 `npm.cmd run test:sites`，4 项测试全部通过。
- 已验证 `收藏`、`失效路径`、文件夹选择器和文件选择器交互，浏览器无 warning/error。
- 已运行 `cargo fmt --check`，通过。
- 已运行 `cargo check`，通过。
- 已运行 `cargo check --tests`，通过。
- 已运行 `cargo test`，5 项索引/存储测试和 0 项主程序测试通过。
- 已运行 `cargo clippy --all-targets --all-features -- -D warnings`，通过。
- 已用 Tauri CLI 从 `prototype/src-tauri/icons/icon.svg` 生成 `icon.ico`，并清理未使用的移动端图标产物。
- `0.3.32` NSIS 安装包已构建并通过 loader 校验：`prototype/src-tauri/target/release/bundle/nsis/本地资料工作台_0.3.32_x64-setup.exe`，大小 `8806464` bytes，SHA-256 `40465EAA81D238576EA71DD286A30C6592B9D482E88EF7EBD83BF7FDBD268355`。
- `0.3.32` release 主程序 `prototype/src-tauri/target/release/local-material-workbench.exe` 大小 `35638321` bytes，SHA-256 `3346C9C7FCCB3B7B3A5FB185B584F5C89A4434FF542D5C75218599EF65D536B0`；`WebView2Loader.dll` 大小 `160320` bytes，SHA-256 `8427B1FC58EC707813E5C0A51EB5D69397BB333250A7B891BE4D3B123F1E0F1C`。
