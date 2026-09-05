# 本地资料工作台 0.3.x 架构加固、性能和可维护性实施计划

> 计划状态：阶段 A 已完成，阶段 B、C、D、E 代码候选已完成并已本地合并到 `dev`，阶段 B/C/D 待用户原生验收，阶段 E 已完成用户原生验收，阶段 F `0.3.38` 已完成自动门禁、本地合并和用户原生验收，阶段 G `0.3.39` 已完成代码实现和开发侧门禁，等待本地 NSIS 候选及用户原生回归，尚未发布
> 编制日期：2026-09-04
> 当前发布基线：v0.3.32
> 下一候选版本：v0.3.39
> 开发和合并策略：每个阶段使用独立分支开发，阶段完成后本地快进并入 `dev`
> 适用平台：Windows 11 x64、Tauri 2、Rust stable、React 19、Vite 6
> 计划范围：修复当前代码审查发现的确定性问题，收敛状态/IPC/存储边界，改善大索引性能，拆分高耦合模块，并建立每阶段本地安装包门禁。

## 1. 计划替换说明

### 1.1 本文件职责

- 本文件完整替换仓库之前以悬浮球“文件库”改造为中心的旧版 `PROJECT_PLAN.md`。
- 旧计划中的阶段 A-F、`0.3.27` 至 `0.3.32` 的实现、验收、Tag、远端同步和 GitHub Release 事实不在本文件重复维护，继续以 `PROJECT_PROGRESS.md`、`README.md`、`prototype/README.md` 和 Git 历史为准。
- 本文件从已经发布的 `v0.3.32` 开始规划新的 `0.3.x` 架构加固路线，不重新规划已经完成的悬浮球功能。
- 每个阶段使用一个完整的 `0.3.x` 版本号。阶段只有在代码、测试、文档、五个版本入口和本地 Windows x64 NSIS 安装包均完成后，才允许标记为完成。
- 本计划不自动授权创建 Tag、推送分支、创建 GitHub Release 或发布安装包。每阶段的安装包是本地候选产物；远程发布必须等待单独的明确授权。

### 1.2 阶段总览

| 阶段 | 版本 | 主题 | 主要结果 | 开发/合并 | 本地安装包 |
| --- | --- | --- | --- | --- | --- |
| A | `0.3.33` | 确定性功能和契约修复 | JPG 预览、目录子项操作、数量徽标、前后端查询语义统一 | 独立阶段分支 -> `dev` | 必须构建 |
| B | `0.3.34` | 索引快照原子一致性 | entries、groups、undo、recovery、revision 的一致快照和提交顺序 | 独立阶段分支 -> `dev` | 必须构建 |
| C | `0.3.35` | 搜索安全和响应性能 | 元数据正则安全执行、搜索防抖、受控结果和大索引响应 | 独立阶段分支 -> `dev` | 必须构建 |
| D | `0.3.36` | 索引和撤销性能 | O(N) 差分、受影响 ID 更新、导入输入上限、后台同步合并 | 独立阶段分支 -> `dev` | 必须构建 |
| E | `0.3.37` | app data 安全和单实例 | 配置文件防 symlink/reparse、跨进程保护、输入边界和 TOCTOU 复核 | 独立阶段分支 -> `dev` | 必须构建 |
| F | `0.3.38` | 预览生命周期和状态闭环 | 预览状态落地、资源范围访问、取消/清理和全格式回归 | 独立阶段分支 -> `dev` | 必须构建 |
| G | `0.3.39` | 模块拆分和 IPC 错误收敛 | 降低 Hook/Rust 上帝模块复杂度，统一错误和契约维护方式 | 独立阶段分支 -> `dev` | 必须构建 |
| H | `0.3.40` | CI、发布门禁和最终回归 | 分支 CI、发布前质量门禁、版本校验和最终候选包 | 独立阶段分支 -> `dev` | 必须构建 |

### 1.3 阶段执行顺序

默认按照 A -> B -> C -> D -> E -> F -> G -> H 顺序执行。阶段之间存在以下依赖：

- 阶段 A 先修正已知的格式和 UI/command 语义错误，避免后续性能和重构工作把错误继续复制到新模块。
- 阶段 B 为 C、D、E 提供一致的索引读写基础；在快照边界不明确时，不进行大范围存储重构。
- 阶段 C 使用 B 的一致快照执行搜索，避免搜索结果看到跨 revision 的混合状态。
- 阶段 D 在 B 的提交模型上优化撤销、导入和后台同步，不改变用户可观察的索引语义。
- 阶段 E 处理多进程和 app data 边界，防止在性能优化后引入跨进程数据覆盖或配置文件越界问题。
- 阶段 F 使用前面稳定的状态/存储模型闭合预览状态；目录临时子项不得重新使用主索引操作。
- 阶段 G 只做职责拆分和契约收敛，原则上不改变 A-F 已验收的用户流程。
- 阶段 H 把前面阶段的检查固化到 CI 和发布流程，形成后续 `0.3.x` 阶段的固定门禁。

## 2. 当前基线和审查结论

### 2.1 当前运行架构

~~~text
React App / Feature Hook
  -> Repository / IPC runtime validator
  -> Tauri command
  -> Storage / Filesystem / Preview / Windows service
  -> app data、Windows 文件系统、LibreOffice、WebView2
~~~

当前应用包含一个主窗口和运行时创建的悬浮球窗口。两个窗口复用同一个前端入口，通过 URL 查询参数选择 `App` 或 `FloatingBallWindow`。Rust 侧通过 Tauri managed state 持有索引、正文索引、操作历史、设置、预览资源、托盘和窗口生命周期状态。

### 2.2 当前可保留的设计

- 继续采用 local-first 设计。默认不上传文件、路径、正文、缩略图、日志和使用统计。
- 前端通过不透明 ID、受控查询条件和受控相对路径调用 Rust，不允许前端把任意路径拼接进系统命令。
- 预览继续使用成熟组件：PDF.js、Mammoth、SheetJS、DOMPurify 和 Rust 侧的容器/路径检查。
- 索引、正文索引、设置、操作历史和悬浮球位置继续分开保存；原子写入、损坏备份和恢复提示继续保留。
- 长时间任务继续放入 `spawn_blocking` 或 Web Worker，并保留取消、过期结果丢弃和资源释放行为。
- 悬浮球的透明窗口、拖动、边缘吸附、混合 DPI、托盘和主窗口生命周期不在本轮重新设计，只在必要时接入新的状态边界。

### 2.3 本轮必须解决的问题

以下问题来自当前工作树代码审查，必须有对应阶段和验证结果，不得只在计划中描述：

1. `AppState::snapshot_with_revision` 分别读取多个 `Mutex`，写入时也分别替换 entries、groups 和 revision，存在混合 revision 快照风险。
2. 共享文件清单声明支持 `.jpg`，但 Rust 图片格式判断只接受 `jpeg`，导致 JPG 预览实际失败。
3. 目录子项预览会显示收藏按钮，但普通目录子项没有主索引 ID，点击会调用主索引 `set_favorite` 并失败。
4. 主窗口元数据正则使用 JavaScript `RegExp`，每个 entry 重新编译，且输入变化同步执行，存在主线程阻塞风险。
5. 带 undo 的索引修改复制完整数组，`diff_entries` 使用嵌套查找，20,000 条索引下存在 O(N²) 开销。
6. `preview_status` 被写入索引结构但生产流程没有更新它，重启后无法表达最后一次预览状态。
7. settings 和 floating placement 的读取/写入没有完全复用索引、正文索引和操作历史的 symlink/reparse 防护。
8. 直接导入和悬浮球记录 command 对 `Vec<String>` 路径数量和总输入大小缺少统一上限。
9. 主窗口使用 `core:default`，错误模型在 `String` 与结构化 `CommandError` 之间分裂，Rust command、JS validator 和 `.d.ts` 由人工同步。
10. 发布 workflow 只做构建和上传，不执行完整前端/Rust 质量检查；Rust 测试还通过 `#[cfg(not(test))]` 排除了全部 command handler。

## 3. 总体目标、非目标和边界

### 3.1 总体目标

- 修复所有已确认的用户可见功能错误，确保 README、计划、代码和实际行为一致。
- 让任何返回给前端的索引快照都对应一个明确且完整的 revision。
- 在 20,000 条索引上保持搜索、收藏、标签、分组、导入和刷新可接受，不因 O(N²) 差分或无界输入阻塞窗口。
- 让 app data 文件在损坏、替换、符号链接、重解析点、磁盘写入失败和应用异常退出时具有一致的恢复策略。
- 让预览任务、预览资源、预览结果、最后打开时间和最后预览状态形成闭环，快速切换时旧结果不能覆盖新文件。
- 把大 Hook 和 Rust 模块拆成单一职责单元，降低新增格式、新 command 和新窗口行为的回归半径。
- 把当前依赖人工执行的质量门禁固化到分支 CI 和发布 workflow。

### 3.2 非目标

- 不增加账号、云同步、在线搜索、远程服务、后台常驻服务、遥测或启动项。
- 不在本轮把应用改造成完整资源管理器，不新增批量物理删除、批量复制或批量重命名。
- 不为了“架构升级”一次性把 JSON 索引迁移到数据库。只有阶段 D 的基准证明 JSON 无法满足当前上限时，才另立 SQLite 阶段。
- 不改变现有用户数据目录、文件操作确认原则、Windows x64 发布目标或浏览器回退模式的 demo-only 边界。
- 不把浏览器自动化、生产构建成功或本地安装包生成描述为 Windows 11/Tauri/WebView2 原生验收。

### 3.3 安全和隐私边界

- 索引默认只保存规范化路径、名称、类型、大小、时间和用户元数据；不保存普通文档全文到 `index.json`。
- 正文索引只处理 manifest 中 `kind=text` 或 `kind=markdown` 的内容，并继续保存为独立的 `content-index.json`。
- 正文、完整路径、转换器命令行、访问令牌、私钥和用户原始文件内容不得进入普通日志、toast、事件或 Release 资产。
- 所有外部打开、资源管理器显示、重命名、回收站删除和剪贴板文件操作必须由用户明确触发，并在 Rust 侧再次校验来源。
- Markdown 和 DOCX HTML 必须继续通过 sanitization；禁止执行宏、脚本、嵌入对象、任意 iframe、远程脚本和危险协议。

## 4. 每阶段统一交付规则

### 4.1 开始阶段前

每个阶段真正开始实现前，必须按以下顺序检查：

1. 读取根目录 `AGENT.md`、`PROJECT_PLAN.md`、`PROJECT_PROGRESS.md` 和 `README.md` 的当前内容。
2. 执行 `git status --short --branch`、`git log -1 --oneline --decorate`，确认当前分支、HEAD 和是否存在用户未提交修改。
3. 如果目标文件含有用户未提交修改，先理解其意图，不能覆盖、回滚或重置。
4. 根据本阶段范围列出将要修改的代码、测试、文档、权限和版本文件；不顺手修改无关文件。
5. 确认所有测试输入来自 `prototype/tests/fixtures/`，不读取或写入用户真实资料。

### 4.2 每阶段必须同步的五个版本入口

每个阶段的候选版本必须同步以下五处，数值完全一致：

1. `prototype/package.json` 的 `version`。
2. `prototype/package-lock.json` 的根包 `packages[""]["version"]`。
3. `prototype/src-tauri/tauri.conf.json` 的 `version`。
4. `prototype/src-tauri/Cargo.toml` 的根 crate `version`。
5. `prototype/src-tauri/Cargo.lock` 中 `name = "local-material-workbench"` 的根 package `version`。

版本同步规则：

- 先完成代码和针对性测试，再同步五个版本入口，最后执行版本一致性检查和安装包构建。
- 任一版本入口未同步，阶段不算完成；不能只修改 package.json 或只修改 Tauri 配置。
- 如果本阶段改变索引格式、配置格式、预览协议、快捷键、外部转换器或安装方式，必须在进度文档写明版本影响、迁移策略和回滚方式。
- 不在阶段候选版本上创建 Tag 或 Release，除非用户另行授权。

### 4.3 每阶段自动验证

根据阶段范围执行最小必要检查。未涉及的检查不为了形式重复执行，但安装包阶段必须执行构建和 loader 检查。

~~~powershell
cd E:\Project\test\prototype

npm.cmd run build
npm.cmd run test:library
npm.cmd run test:contracts
npm.cmd run test:content
npm.cmd run test:settings
npm.cmd run test:operations
npm.cmd run test:preview
npm.cmd run test:floating-ball
npm.cmd run test:tray
npm.cmd run test:sites

cd src-tauri
cargo fmt --check
cargo check --locked
cargo check --tests --locked
cargo test --locked
cargo clippy --locked --all-targets --all-features -- -D warnings
~~~

- 只执行与本阶段相关的前端测试组，阶段 H 再执行完整组合。
- 修改 Rust command、存储、路径、预览、窗口或 capability 时，至少运行 `cargo fmt --check`、`cargo check --locked`、`cargo test --locked` 和必要的 clippy。
- 修改前端预览或搜索时，至少运行前端构建和对应模型/契约测试。
- 如果测试无法运行，必须把命令、失败原因、影响范围和替代证据写入 `PROJECT_PROGRESS.md`，不能用“未发现问题”替代。

### 4.4 每阶段本地安装包门禁

每个阶段完成代码、测试、文档和五个版本入口同步后，必须在本地构建 Windows x64 NSIS 安装包：

~~~powershell
cd E:\Project\test\prototype
npm.cmd run tauri:build
npm.cmd run verify:loader
~~~

要求如下：

- `npm.cmd run tauri:build` 必须成功完成前端构建、Rust release 编译、NSIS 打包和内置 loader 校验。
- 安装包必须位于 `prototype/src-tauri/target/release/bundle/nsis/`，名称应包含当前版本，例如 `本地资料工作台_0.3.33_x64-setup.exe`。
- 必须记录安装包绝对路径、文件大小、SHA-256、构建版本和 `WebView2Loader.dll` 校验结果。
- 必须确认 loader 为 Windows x64，且与 release 主程序位于同一目录；`verify-webview2-loader.mjs` 的通过结果必须记录。
- 本地安装包是阶段候选，不等价于已安装、已启动、已卸载或已完成 Windows 11 原生验收。
- 构建产物被 `.gitignore` 忽略，不得加入提交；最终说明必须区分本地构建证据和用户原生验收证据。
- 如果安装包构建失败，阶段保持“进行中”，不得进入下一阶段，不得把版本标为已发布。

### 4.5 每阶段文档和 Git 收口

每个代码阶段必须更新：

- `PROJECT_PROGRESS.md`：日期、已完成、进行中、阻塞与风险、下一步、涉及文件、自动验证和安装包信息。
- `README.md`：只有用户可见能力、限制或运行条件变化时更新。
- `prototype/README.md`：只有开发命令、预览依赖、目录结构、测试或打包边界变化时更新。
- 相关 `docs/`：只有安全边界、迁移、外部转换器、数据格式或验收规则变化时更新。

每个阶段收口前必须执行：

~~~powershell
git diff --check
git status --short --branch
git diff --stat
~~~

执行本地 commit 时只提交当前阶段关联文件和必要文档。commit 必须先落在当前阶段独立分支，阶段通过所有门禁后再本地快进并入 `dev`。没有明确授权时不 push、不改 remote、不创建 Tag、不创建 Release。

### 4.6 独立分支开发和并入 `dev`

每个阶段必须使用独立的 feature/fix 分支，不能直接在 `dev` 上开发，也不能把多个阶段混在同一条未收口分支中。默认分支命名如下：

~~~text
codex/phase-0.3.33-correctness
codex/phase-0.3.34-index-snapshot
codex/phase-0.3.35-search-performance
~~~

实际名称应包含阶段版本和简短主题；如果用户指定了分支名，以用户指定为准。开始阶段时：

~~~powershell
git switch dev
git status --short --branch
git switch -c codex/phase-0.3.33-correctness
~~~

分支规则：

- 阶段分支必须从当时最新的本地 `dev` 创建；创建前确认 `dev` 工作树状态，不覆盖用户已有修改。
- 代码、测试、文档、权限、五个版本入口和本地 NSIS 安装包都在阶段分支上完成并验证。
- 阶段分支必须先完成本地 commit，commit 前执行 `git diff --check`、`git status` 和改动范围检查。
- 阶段成功并入 `dev` 并完成合并后复核后，使用安全的 `git branch -d <phase-branch>` 删除本地阶段分支；不保留已经收口的过期分支。
- 如果开发期间 `dev` 已有新的本地提交，先切回阶段分支并执行 `git merge --ff-only dev`；该操作改变阶段分支后必须重新运行受影响的测试和本地安装包构建。

阶段分支并入 `dev` 时必须确认方向和 ancestry：

~~~powershell
git switch <phase-branch>
git status --short --branch
git merge --ff-only dev

git switch dev
git status --short --branch
git merge-base --is-ancestor dev <phase-branch>
git merge --ff-only <phase-branch>
git diff --check
git status --short --branch
git log -1 --oneline --decorate
git branch --merged dev
git branch -d <phase-branch>
~~~

- 最终合并方向固定为“当前阶段分支 -> `dev`”，不能误把 `dev` 合并到阶段分支后就停止，也不能把阶段分支合入 `main`。
- `git merge-base --is-ancestor dev <phase-branch>` 失败时不得强制合并；先查明 `dev` 是否前进、阶段分支是否包含最新 `dev`，必要时在阶段分支同步后重新测试和打包。
- 优先使用 `git merge --ff-only`，不自动使用 `--force`、`--no-ff` 或重置命令。无法快进时暂停该阶段合并并记录阻塞原因。
- 如果快进合并没有改变阶段分支的内容，阶段分支上已验证的安装包对应同一提交；如果合并产生任何内容变化，必须在合并后的 `dev` 上重新运行 `npm.cmd run tauri:build` 和 `npm.cmd run verify:loader`。
- `dev` 合并完成并复核后，必须删除已经完整合并的阶段分支；删除失败或分支未完全合并时，阶段保持未收口状态。
- `dev` 合并和分支清理完成后，除当前正在开发的阶段分支外，不应保留其他历史阶段分支；合并完成后本地应只保留 `main`、`dev` 以及尚未收口的当前阶段分支。
- 阶段分支删除后才把该阶段记为 Git 收口完成；合并前的安装包不能被描述为“已并入 `dev` 的候选”。
- 合并保持本地操作，除非用户单独授权，不执行 `git push`、Tag 或 GitHub Release。

## 5. 阶段 A：确定性功能和契约修复（0.3.33）

### 5.1 目标

修复当前已经可以从代码静态证明的用户可见错误和规格漂移，建立后续阶段可依赖的格式映射、目录子项能力判断和悬浮球数量表现。

### 5.2 实现范围

#### A1. 修复 JPG 预览

- 修改 `prototype/src-tauri/src/preview/image.rs`，确保 `jpg` 和 `jpeg` 都映射到 `ImageFormat::Jpeg`。
- 不绕过 manifest、文件签名和像素上限检查；`.jpg` 仍然必须经过普通文件、扩展名、真实图片格式和最大像素数校验。
- 检查共享 manifest 中所有图片扩展名是否都能通过 Rust 图片校验；如果 manifest 新增格式，不允许只更新前端。

#### A2. 修复目录子项预览操作

- 修改 `PreviewPane.jsx` 的操作能力判断：目录临时子项只显示它真正支持的预览、返回和资源管理器定位操作。
- 不允许对没有主索引记录的目录子项显示收藏、重命名、删除、复制主索引路径或默认程序打开按钮。
- 主索引中的文件仍保持收藏、复制位置、默认打开和资源管理器定位能力。
- 在 UI 层区分 `IndexEntry` 和 `DirectoryEntry`，不要只依靠是否存在 `path` 的隐式判断。

#### A3. 对齐悬浮球数量徽标

- 将数量折叠规则统一为计划约定：超过两位数字显示 `99+`。
- 数量读取失败时隐藏徽标或进入无数字错误状态，不显示容易被理解为数量的 `!`。
- 统一 `floatingBallModel.js`、`FloatingBallPanel.jsx`、测试和计划文案中的阈值。
- 浏览器 demo 和 Tauri 运行时必须共用同一数量展示模型。

#### A4. 对齐 JS/Rust 悬浮球查询归一化

- 比较 `floatingLibraryModel.js` 和 `storage/floating_files.rs` 的查询标准化、空白、大小写、NFKC 和排序行为。
- 对需要跨运行时一致的字段建立共享测试样本，至少覆盖中文、全角字符、大小写、数字名称、空值时间和重复 ID。
- 不把完整本地路径加入悬浮球返回结构；保持当前不返回 `path`、`content` 和 `recordedAt` 的边界。

### 5.3 主要文件

- `prototype/src-tauri/src/preview/image.rs`
- `prototype/shared/file-types.json`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/features/preview/UnsupportedPreviewer.jsx`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src/features/floating-ball/floatingBallModel.js`
- `prototype/src/features/floating-ball/floatingLibraryModel.js`
- `prototype/src/features/floating-ball/FloatingBallWindow.jsx`
- `prototype/src/features/floating-ball/FloatingBallPanel.jsx`
- `prototype/tests/preview-registry.test.mjs`
- `prototype/tests/floating-library-model.test.mjs`
- 必要的 IPC/前端组件测试文件

### 5.4 数据和 IPC 影响

- 不改变 `index.json` 格式版本。
- 不新增 command；目录子项通过现有 `DirectoryTarget` 和 `reveal_directory_child` 保持原有安全边界。
- 如果需要增加 `kind` 或能力字段，必须同步 Rust 返回结构、JS validator、`.d.ts`、capability 和 generated schema。

### 5.5 自动验证

- `npm.cmd run test:preview`：新增 JPG 正常、错误图片、扩展名与真实内容不一致的测试。
- `npm.cmd run test:floating-ball`：数量阈值、失败状态、查询排序和 NFKC 样本测试。
- `npm.cmd run test:contracts`：确认目录条目和悬浮球返回仍拒绝禁止字段。
- `npm.cmd run build`：确认 Sites 产物继续生成。
- `cargo fmt --check`、`cargo check --locked`、`cargo test --locked`、必要的 `cargo clippy`。

### 5.6 原生验收

在用户 Windows 11/Tauri/WebView2 环境中使用无敏感夹具确认：

- `.jpg` 和 `.jpeg` 均能正确预览。
- 打开已登记文件夹，进入未单独登记的普通子项，预览头部不存在不可用的收藏按钮。
- 悬浮球数量在 99、100、999 和读取失败状态下表现符合计划。

### 5.7 阶段完成标准

- 四项确定性问题有代码修复和回归测试。
- 版本五根同步为 `0.3.33`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 相关文档和 `PROJECT_PROGRESS.md` 已更新。
- `npm.cmd run tauri:build` 成功生成 `本地资料工作台_0.3.33_x64-setup.exe`，并完成 loader 校验。
- 未经用户授权不创建 `v0.3.33` Tag 或 Release。

## 6. 阶段 B：索引快照原子一致性（0.3.34）

### 6.1 目标

把索引的 entries、groups、undo、recovery、pending operation 状态和 revision 形成明确的一致性边界，消除读者看到混合状态的可能，同时保持当前 `index.json` v5 数据格式兼容。

### 6.2 目标状态模型

建议将当前多个相互独立的字段收敛为一个内部快照结构：

~~~text
IndexState
  data: IndexSnapshotData
    entries
    groups
    undo_log
    recovery
    pending_operations
    revision
  mutation_lock / RwLock
~~~

具体实现可以使用单一 `RwLock` 或等价的不可变快照替换机制，但必须满足：

- 一次读操作拿到的 entries、groups、undo、recovery 和 revision 属于同一提交点。
- 一次写操作先完成验证和原子持久化，再一次性替换内存快照。
- revision 只在持久化成功后递增，不能先发事件再写文件。
- 事件发送必须发生在内存快照替换之后；事件丢失时，下一次读取仍能拿到最新状态。
- 失败写入不得改变内存快照，也不得递增 revision。

### 6.3 实现任务

#### B1. 统一索引读取

- 重构 `storage/mod.rs` 的 `snapshot`、`snapshot_groups`、`snapshot_with_revision` 和 `recovery_status`。
- 让 `IndexRepository` 只暴露一致快照和明确的 mutation API，不允许 command 自己组合多个独立读取。
- `get_floating_files`、`load_file_index`、托盘菜单、主窗口刷新和 `record_entry_opened` 全部使用统一快照。

#### B2. 统一索引提交

- 重构 `update_index_internal`、`undo_last`、`reset_index_recovery` 和 pending delete reconciliation 的提交顺序。
- 记录提交前 revision、提交后 revision 和 changed IDs，确保一次 mutation 最多递增一次。
- 对 group mutation 也保证 entries、groups 和 undo 一起提交。

#### B3. 收敛 settings/content snapshot

- 检查 `SettingsState::snapshot` 是否可能拿到 settings、warning 和 revision 的混合值；必要时使用统一快照锁。
- 检查 `ContentIndexState::search` 是否可能在 documents 与 status 不同提交点时返回结果；必要时增加只读一致快照。
- 本阶段不改变设置或正文索引的用户可见语义，只收敛读取边界。

#### B4. 事件和刷新策略

- 保留 `index-changed` 的 revision 和 changed IDs。
- 前端收到低于当前 revision 的事件时丢弃；收到高 revision 时最多合并一次 reload 请求。
- 事件 handler 不能直接基于事件中的 entries 更新 UI，因为事件只传 ID 和 revision；UI 必须读取一致快照。

### 6.4 主要文件

- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/repository.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/storage/content_index.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/windows/tray.rs`
- `prototype/src/features/library/useIndexController.js`
- `prototype/src/features/window/useWindowController.js`
- `prototype/src/features/floating-ball/useFloatingBallFiles.js`

### 6.5 数据和 IPC 影响

- 默认保持 index format v5、settings format v3、content index format v1。
- 如果内部状态结构改变但磁盘 JSON 没改变，不需要迁移；必须在进度文档注明“无持久化格式变化”。
- 如果必须改变 JSON 字段，先建立备份、迁移、损坏恢复和旧版本读取测试，再提升对应格式版本；不能把格式变化隐藏在普通重构中。

### 6.6 自动验证

- 新增一致快照测试：在模拟写入前后验证每个返回 snapshot 的 revision 与 entries/groups/undo 对应。
- 新增失败写入测试：确认内存 entries、groups、revision 均保持不变。
- 新增 event/reload 测试：乱序、重复和跳跃 revision 不会让前端回退。
- 运行 `npm.cmd run test:contracts`、`npm.cmd run test:library`、`npm.cmd run test:floating-ball`、`npm.cmd run test:content`。
- 运行 Rust fmt/check/test/clippy。

### 6.7 原生验收

- 主窗口导入、收藏、标签、分组、重命名、移除和撤销后，悬浮球列表最终与主窗口一致。
- 连续快速收藏/取消收藏、预览/关闭和切换窗口时，列表不会短暂回退到旧状态后永久停留。
- 应用重启后，索引、分组、undo 状态和 recovery 状态与最后一次成功提交一致。

### 6.8 阶段完成标准

- 不再存在由独立 Mutex 读取导致的混合索引快照路径。
- 版本五根同步为 `0.3.34`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 一致性测试、文档和进度记录完成。
- 本地 NSIS 安装包 `本地资料工作台_0.3.34_x64-setup.exe` 构建成功并通过 loader 校验。

## 7. 阶段 C：搜索安全和响应性能（0.3.35）

### 7.1 目标

消除主窗口元数据正则在 JavaScript 主线程中的回溯和重复编译风险，让搜索在 20,000 条索引和长路径场景下有明确的工作量上限。

### 7.2 搜索设计

桌面运行时的元数据搜索最终由 Rust 侧线性时间 regex 执行，沿用正文搜索使用的 `regex::RegexBuilder` 安全边界。前端保留纯模型用于浏览器 demo，但不把 demo 的 JavaScript 正则实现当作桌面安全实现。

推荐新增受控 command：

~~~text
search_metadata({
  query,
  useRegex,
  activeNav,
  filter,
  groupIds,
  tags,
  targetDirectory?
}) -> {
  revision,
  matchedIds,
  hits,
  total,
  truncated
}
~~~

约束：

- command 只返回不透明 ID、命中字段类型、受控字符范围和统计，不返回完整路径或正文。
- 正则表达式限制字符数、编译大小和 DFA 大小；无效或超限表达式返回结构化错误。
- 查询字段固定为名称、类型、状态、标签、分组名称和受控位置摘要；不得通过前端传任意字段名。
- 目录子项搜索通过 `DirectoryTarget` 读取当前已校验目录快照，仍然只返回子项 ID 和命中摘要。
- 普通字面搜索也使用同一 command 或明确的本地快速路径，不在不同模式间产生不同大小写/Unicode 结果。

### 7.3 实现任务

#### C1. Rust 搜索服务

- 新增独立的 metadata search module，避免继续扩大 `commands/mod.rs` 和 `libraryModel.js`。
- 复用 `content_search.rs` 的 regex 编译限制和结果结构思想，但不要把正文索引和元数据索引混为一体。
- 预先构造每条 entry 的可搜索字段，避免对同一 entry 重复拼接完整路径和标签。
- 对搜索字段设置长度上限；必要时使用已规范化的父目录摘要，而不是每次扫描完整 Windows 长路径。

#### C2. 前端请求控制

- 搜索输入增加 120-180ms 防抖，输入过程中立即取消或标记旧请求。
- 用 request sequence + revision 双门控丢弃旧响应。
- 只在当前搜索上下文仍然匹配时更新 matched IDs、命中字段和高亮范围。
- 浏览器 demo 保留内存数据，但使用与桌面相同的输入归一化和结果字段语义。

#### C3. 元数据模型清理

- 删除 `filterEntries` 中对每个 entry 创建正则表达式的路径。
- 不在 React render 中对每条记录重复解析同一正则。
- 只对可见页面生成高亮，不为所有 20,000 条记录生成高亮对象。
- 搜索条件改变时保留现有空状态、加载状态和错误状态，不改变分页/选择清理规则。

### 7.4 主要文件

- `prototype/src-tauri/src/storage/metadata_search.rs`（新增）
- `prototype/src-tauri/src/storage/content_search.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src/features/library/libraryModel.js`
- `prototype/src/features/library/LibraryPanel.jsx`
- `prototype/src/features/library/libraryRepository.js`
- `prototype/src/lib/ipcContracts.js`
- `prototype/src/lib/ipcContracts.d.ts`
- `prototype/src-tauri/build.rs`
- `prototype/src-tauri/capabilities/default.json`
- 新增 metadata search model/contract tests

### 7.5 自动验证

- Rust regex 测试：无效表达式、回溯型表达式、超长表达式、全角字符、中文和换行。
- 前端测试：防抖、旧响应丢弃、revision 丢弃、搜索命中高亮和空状态。
- 合成 20,000 条 entry 的基准测试，记录搜索耗时和峰值分配趋势；不把机器相关的绝对毫秒数作为唯一门禁，但必须避免明显 O(N²)。
- 运行 `npm.cmd run test:library`、`npm.cmd run test:contracts`、`npm.cmd run test:content`、`npm.cmd run build`。
- 运行 Rust fmt/check/test/clippy。

### 7.6 原生验收

- 在包含中文、全角字符、代码文件和长路径的夹具上测试元数据搜索和正则搜索。
- 输入 `^(a+)+$` 等高回溯表达式时，界面不能长时间无响应；应返回受控错误、超时或安全拒绝。
- 快速连续输入、切换筛选、切换目录和关闭搜索后，旧结果不能覆盖新结果。
- 20,000 条索引下搜索输入、分页和选择操作仍可完成，且列表主体不出现横向溢出。

### 7.7 阶段完成标准

- 桌面元数据 regex 不再使用逐 entry 的 JavaScript 正则执行。
- 版本五根同步为 `0.3.35`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 搜索协议、限制和浏览器 demo 边界已写入 README/进度文档。
- 本地 NSIS 安装包 `本地资料工作台_0.3.35_x64-setup.exe` 构建成功并通过 loader 校验。

## 8. 阶段 D：索引和撤销性能（0.3.36）

### 8.1 目标

消除可撤销操作和导入合并中的明显 O(N²) 路径，控制直接导入、悬浮球记录和正文后台同步的输入规模，同时不改变现有用户字段保留和 revision 语义。

### 8.2 撤销性能设计

- 保留 `UndoEntryChange` 和 `UndoGroupChange` 的用户可观察含义，但用 ID 到对象的 `HashMap` 或预先建立的位置表计算差分。
- `diff_entries` 必须从嵌套 `find`/`any` 改为 O(N+M) 的 ID 映射比较。
- 对单条收藏、标签或分组修改，undo 记录只包含实际受影响的 ID；不得为了判断差分反复扫描完整数组。
- 如果基准证明完整 entries clone 仍然超过目标，再引入显式 `IndexMutation`/copy-on-write API；不要在同一阶段无理由迁移到数据库。
- 若必须改变磁盘 undo 结构，必须升级 index format、提供 v5 读取和一次性迁移备份；否则优先保持 v5 兼容。

### 8.3 索引合并和输入边界

- 给 `index_paths` 和 `record_floating_paths` 增加路径数量上限、单路径字节上限和总路径字节上限。
- 直接导入在扫描开始前拒绝超出上限的请求；不能让 `scan_paths` 接受无界 `Vec<String>` 后再逐项处理。
- `scan_paths` 的 `seen_paths`、skipped count 和结果容器均要有上限或安全截断语义。
- `merge_index_entries` 使用路径索引或一次构造的 identity map，减少每个 incoming entry 在完整 entries 中线性查找。
- 保持 Windows 分隔符、大小写、UNC/扩展路径和重复路径去重规则。

### 8.4 后台正文同步

- `emit_index_changed` 不能为每个连续 revision 无条件排队一个完整正文同步任务。
- 增加按 revision 合并的 pending sync 状态：只保留最新待处理 revision 和最新 entries 快照。
- 旧任务如果尚未开始，应被合并或取消；已经开始的任务在提交前检查 source revision。
- 当正文索引总容量已达到上限时，先用 metadata size 进行可行性判断，避免对明显不可能加入的文件无意义地读取完整内容。
- 保持正文索引损坏隔离，不因正文同步失败破坏主索引。

### 8.5 主要文件

- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/repository.rs`
- `prototype/src-tauri/src/commands/library.rs`
- `prototype/src-tauri/src/commands/floating_ball.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/storage/content_index.rs`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src/features/library/useIndexController.js`
- 新增 storage benchmark/test utilities

### 8.6 自动验证

- 20,000 条合成索引的单条收藏、标签、分组和撤销基准。
- 500 条批量操作的差分和序列化基准。
- 20,000 条 incoming/重复路径/大小写路径的合并测试。
- 直接导入、悬浮球记录的空数组、达到数量上限、达到总字节上限、重复输入和无效路径测试。
- 连续 10 个 index revision 事件只产生有限数量的正文同步任务，并最终到达最新 revision。
- 运行 `npm.cmd run test:library`、`npm.cmd run test:content`、`npm.cmd run test:contracts`、`npm.cmd run build`，以及 Rust fmt/check/test/clippy。

### 8.7 原生验收

- 在接近 20,000 条登记记录的测试库上执行收藏、标签、分组、批量操作、撤销和刷新。
- 连续拖入相同、大小写不同、斜杠不同和多组路径，确认去重和反馈稳定。
- 在导入大批量无效路径时，应用应快速拒绝或有界处理，不出现长时间无反馈。
- 正文索引达到容量上限时，主索引仍可正常导入、搜索和预览。

### 8.8 阶段完成标准

- undo 差分不再使用当前的嵌套 ID 查找实现。
- 直接导入、悬浮球记录和后台正文同步都有明确上限和截断/合并语义。
- 版本五根同步为 `0.3.36`；若数据格式未变，进度文档明确记录无迁移。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 本地 NSIS 安装包 `本地资料工作台_0.3.36_x64-setup.exe` 构建成功并通过 loader 校验。

## 9. 阶段 E：app data 安全和单实例保护（0.3.37）

> 阶段状态：代码、自动门禁、NSIS、本地合并和用户 Windows 11/Tauri/WebView2 原生验收已完成；未创建 Tag 或 Release。

### 9.1 目标

让所有 app data 文件使用一致的文件类型、符号链接、大小和原子写入策略，并阻止多个应用进程同时读写同一份索引造成最后写入覆盖。

### 9.2 app data 文件安全

新增或抽取统一的 app data 文件辅助模块，至少覆盖：

- `index.json`
- `content-index.json`
- `settings.json`
- `operation-history.json`
- `floating-ball.json`
- `pending-operations.json`

统一策略：

- 读取前使用 `symlink_metadata`，拒绝 symlink、Windows reparse point、目录和特殊文件。
- 对每种文件设置合理的原始字节上限，再执行 JSON 解析；超限文件进入可恢复错误，不直接 `fs::read` 无界分配。
- 写入前确认目标父目录安全，写入使用临时文件和原子替换；目标文件为 symlink/reparse 时不得跟随写入。
- 备份文件使用安全的文件检查和有界命名策略，不把用户路径或文件内容写入日志。
- 恢复备份失败时保留原文件，不用空内容静默覆盖用户数据。

### 9.3 单实例和跨进程保护

当前 `Mutex` 只保护单个 Rust 进程。由于索引和设置位于共享 app data，必须二选一并落地：

- 首选：使用 Windows named mutex 或受支持的 Tauri single-instance 机制，第二个进程把显示/打开请求交给第一个进程后退出。
- 如果产品明确需要多进程，则必须为 index/settings/operation history/content index 增加可靠的跨进程读写锁、revision 重读和冲突处理。

本阶段默认选择单实例：

- 实际接入 `tauri-plugin-single-instance` `2.4.4`，由官方 Windows named mutex 和消息窗口把第二次启动请求交给第一个进程。

- 第二次启动不能加载一份独立索引后静默覆盖第一进程。
- 第二次启动的打开请求、文件路径参数或显示请求必须有明确处理结果；没有请求时显示已有实例并退出。
- 主进程退出、崩溃、锁残留和升级安装场景必须有可恢复策略。
- 单实例机制不能绕过现有 command/capability 安全边界。

### 9.4 文件操作 TOCTOU 复核

- 对打开默认程序、资源管理器显示、重命名和回收站删除，在实际操作前再次确认 canonical path、文件类型、reparse 状态和索引 ID 对应关系。
- 对有条件的平台 API，尽量使用 OS handle 或在最接近实际动作的位置复核；不能把一次早期 `validate` 当作整个操作生命周期的授权。
- 如果无法消除竞态，必须在用户可见错误中说明操作状态未知，并提供刷新/重新定位入口。

### 9.5 主要文件

- `prototype/src-tauri/src/storage/app_data.rs`
- `prototype/src-tauri/src/storage/settings.rs`
- `prototype/src-tauri/src/storage/floating_ball.rs`
- `prototype/src-tauri/src/storage/operation_history.rs`
- `prototype/src-tauri/src/storage/content_index.rs`
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/filesystem/mod.rs`
- `prototype/src-tauri/src/filesystem/operations.rs`
- `prototype/src-tauri/src/filesystem/external.rs`
- `prototype/src-tauri/src/lib.rs`
- `prototype/src-tauri/Cargo.toml`
- `prototype/src-tauri/capabilities/default.json`
- Windows lifecycle and startup tests

### 9.6 自动验证

- 为每种 app data 文件增加 symlink/reparse、目录替换、超大文件、无效 JSON、原子写入失败和恢复备份测试。
- 验证 settings/placement 的行为与 index/content/history 一致。
- 增加 Windows named mutex 或 single-instance 测试；如果 CI 无法提供双进程桌面环境，至少运行 Rust 单元/集成测试并记录原生验收待办。
- 直接导入、悬浮球记录、递归导入和操作 ID 的数量、字符、路径字节限制测试。
- 运行 `npm.cmd run test:contracts`、`npm.cmd run test:floating-ball`、`npm.cmd run test:settings`、`npm.cmd run test:operations`、`npm.cmd run build`。
- 运行 Rust fmt/check/test/clippy。

### 9.7 原生验收

- 连续启动两个应用进程，确认只有一个进程拥有 app data 和桌面窗口生命周期。
- 在 settings、index、operation history 和 floating placement 文件被替换为符号链接或目录时，应用不写入链接目标，不崩溃，并显示可恢复错误。
- 关闭、重启、异常终止和安装升级后，索引和设置不出现最后写入覆盖或空文件。
- 真实执行重命名、资源管理器定位和回收站删除，确认路径复核与失败状态符合文档。

### 9.8 阶段完成标准

- app data 文件使用统一安全打开/写入策略。
- 单实例或等价跨进程一致性机制已实现并有证据；不能只在文档中声明“默认单实例”。
- 版本五根同步为 `0.3.37`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 本地 NSIS 安装包 `本地资料工作台_0.3.37_x64-setup.exe` 构建成功并通过 loader 校验。

## 10. 阶段 F：预览生命周期和状态闭环（0.3.38）

> 阶段状态：F1-F4 代码、针对性测试、IPC/capability 契约、五个版本入口、NSIS 候选、本地合并和用户 Windows 11/Tauri/WebView2 原生验收已完成；尚未创建 Tag 或 Release。

### 10.1 目标

让预览资源、预览任务、预览结果和索引中的最后预览状态具有一致生命周期，进一步减少重复校验、全量资源读取和关闭/快速切换时的残留。

### 10.2 预览状态决策

当前索引中已经存在 `preview_status`，本阶段保留该字段并让它真正工作：

- `idle`：从未完成预览尝试，或历史数据没有状态。
- `ready`：最近一次预览内容成功准备。
- `unsupported`、`missing`、`permission-denied`、`too-large`、`converter-missing`、`parse-error`、`timed-out`、`cancelled`：最近一次终态失败或取消。
- `loading` 不持久化为最终状态，避免应用崩溃后永久显示处理中。
- 目录临时子项没有主索引记录，不写入主索引预览状态。

成功预览与 `lastOpenedAt` 的更新应在一次明确的索引 mutation 中完成，避免同一次用户动作产生两个不必要的 revision。失败状态是否更新索引必须有节流策略，不能因快速浏览把索引写入放大。

### 10.3 实现任务

#### F1. 统一预览会话

- `PreviewPane` 为每个 entry 建立 task ID、request sequence 和 preview resource ID。
- 关闭、切换、重试、应用退出和组件卸载时必须取消任务、释放资源和清理临时目录。
- 旧 preview result 不能覆盖新 entry；`load_preview` 与 `dispose_preview` 的异常只能影响当前预览。
- `can_preview` 和 `load_preview` 重复的检查应尽量抽取受控准备流程；即使保留两步，也必须保证两步都重新验证实际文件。

#### F2. 资源协议和范围访问

- PDF、视频和需要分页读取的二进制资源都要验证 Range 请求、初始响应大小和 `Content-Range`。
- 不让 PDF 因首个无 Range 请求直接读取完整 50 MiB 文件；确认 PDF.js 的 range 请求与资源协议行为一致。
- 每个资源请求继续只接受已登记的随机 `previewId`，不接受路径、任意 query 或任意 URL。
- 资源每次访问重新校验普通文件、canonical path、大小和文件身份变化；变化时返回明确冲突状态。
- `MAX_ACTIVE_RESOURCES`、TTL、清理线程和应用退出清理必须保持有界。

#### F3. Office 和文本预览

- DOCX Worker、DOMPurify 分批清理和取消继续保持；确认超时后 Worker、fetch、Blob/临时资源都释放。
- XLS/XLSX 继续在 Worker 中解析，限制工作表、行、列、单元格和容器展开大小；切换 Sheet 不创建无界缓存。
- DOC 转 PDF 继续使用隔离临时目录、受控 LibreOffice 路径、超时、退出码、输出签名和清理。
- 文本解码继续区分 UTF-8 BOM、UTF-8 和 GB18030；乱码和二进制内容进入明确错误状态。

#### F4. 预览状态持久化

- 新增 storage 层的 `record_preview_outcome` 或等价 API，只接受不透明 file ID、受控终态和当前 entry revision。
- 状态相同时不写入、不递增 revision；短时间内连续失败可以按 entry 节流或在会话结束时写入。
- 重命名、重新定位、合并、删除和恢复必须保留或清除预览状态的规则明确写入测试。
- 前端只显示当前会话结果和索引终态，不把 `loading` 误表示为持久状态。

### 10.4 主要文件

- `prototype/src-tauri/src/preview/mod.rs`
- `prototype/src-tauri/src/preview/operations.rs`
- `prototype/src-tauri/src/preview/loaders.rs`
- `prototype/src-tauri/src/preview/resources.rs`
- `prototype/src-tauri/src/preview/resource_protocol.rs`
- `prototype/src-tauri/src/preview/image.rs`
- `prototype/src-tauri/src/preview/doc.rs`
- `prototype/src/features/preview/PreviewPane.jsx`
- `prototype/src/features/preview/PdfPreviewer.jsx`
- `prototype/src/features/preview/OfficePreviewer.jsx`
- `prototype/src/features/preview/SpreadsheetPreviewer.jsx`
- `prototype/src/features/preview/previewSecurity.js`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src-tauri/src/storage/mod.rs`

### 10.5 自动验证

- 所有 manifest 图片扩展名、文本、Markdown、DOCX、XLS/XLSX、PDF、视频和 DOC 的成功/失败状态测试。
- JPG 专项回归测试必须保留。
- 预览快速切换、重试、关闭、取消、超时、资源上限、文件大小变化和临时目录清理测试。
- Range 请求的 200/206/416、单范围、越界、大小变化和未知 preview ID 测试。
- `preview_status` 成功、失败、取消、重启恢复和状态不变不写入测试。
- 运行 `npm.cmd run test:preview`、`npm.cmd run test:contracts`、`npm.cmd run test:library`、`npm.cmd run build`，以及 Rust fmt/check/test/clippy。

### 10.6 原生验收

- 使用无敏感夹具验证图片、PDF、Office、DOC、文本和 Markdown 的真实 WebView2 预览。
- 快速连续打开不同格式、切换预览、关闭主窗口、退出应用和重启后确认无旧内容、无残留临时目录、无卡死。
- 真实缺少 LibreOffice、损坏文件、加密工作簿/文档、超大文件和权限拒绝都显示可执行的下一步。

### 10.7 阶段完成标准

- `preview_status` 不再是只读字段，而是有定义、有更新、有恢复测试的状态。
- 版本五根同步为 `0.3.38`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 预览文档、依赖边界和 Windows 原生验收记录已同步。
- 本地 NSIS 安装包 `本地资料工作台_0.3.38_x64-setup.exe` 构建成功并通过 loader 校验。

## 11. 阶段 G：模块拆分和 IPC 错误收敛（0.3.39）

### 11.1 目标

降低 `App.jsx`、`useLibraryActions.js`、`storage/mod.rs` 和 `commands/mod.rs` 的职责密度，在保持行为不变的前提下建立更容易测试和扩展的模块边界。

### 11.2 前端拆分方案

将当前 `useLibraryActions` 按副作用边界拆为多个小 Hook 或 action service，建议划分如下：

- `useLibraryImportActions`：文件选择器、拖放、普通导入、递归导入、导入取消和导入反馈。
- `useLibraryMutationActions`：单条收藏、标签、分组和索引移除。
- `useLibraryBatchActions`：批量收藏、标签、分组、索引移除、取消和重试。
- `useLibraryFileActions`：默认打开、资源管理器定位、剪贴板、重命名、物理删除和重新定位。
- `useLibraryHistoryActions`：undo 和操作中心协作。
- `useFloatingHandoff`：悬浮球打开主窗口、定位、预览和 request sequence。

要求：

- 每个 Hook 只有一个主要副作用主题，单个函数尽量不超过 60 行。
- 共享的 busy、request ID、operation ID 和 toast 通过明确的 controller/context 传递，不用隐式全局变量。
- `App.jsx` 只负责组合 controller、连接页面和 modal，不直接实现文件系统业务。
- 拆分过程中不得改变 command 名称、用户提示、确认流程、选择保留规则和原文件操作边界。

### 11.3 Rust 拆分方案

建议在保持 crate 对外行为不变的前提下拆分：

- `storage/index_state.rs`：状态容器、一致快照和 revision。
- `storage/index_persistence.rs`：JSON 读写、原子替换、迁移和恢复。
- `storage/index_mutations.rs`：条目、标签、分组和 merge 领域操作。
- `storage/undo.rs`：差分、undo record 和冲突校验。
- `storage/pending_operations.rs`：物理删除待同步状态。
- `commands/index.rs`：索引加载、导入、刷新和目录 command。
- `commands/preview.rs`：预览 command 和结果映射。
- `commands/content.rs`：正文索引 command 和事件。
- `commands/events.rs`：index/content/settings/window event。
- `commands/batch.rs`：批量控制、取消和结果映射。

拆分完成后，`commands/mod.rs` 只保留模块注册、共享 DTO 或真正跨模块的公共辅助函数；`storage/mod.rs` 只保留模块声明和公共类型。

### 11.4 IPC 错误契约

- 所有面向前端的业务 command 统一返回结构化错误：`code`、`message`、`retryable`、`state`。
- 逐步移除相同业务路径中的普通 `String` 错误；若保留系统级启动错误，必须与业务 command 分开。
- `ipcContracts.js` 统一验证错误码、字段长度、允许状态和敏感信息边界。
- `ipcContracts.d.ts` 与 runtime validator 必须来自同一份可检查的契约定义，至少增加自动一致性测试；不强行一次性迁移全部 JSX 到 TypeScript。
- `build.rs` command 列表、Rust `generate_handler!`、capability、generated ACL、JS command 白名单和 `.d.ts` 必须有 parity 检查。

### 11.5 capability 收敛

- 审查主窗口的 `core:default`，改为实际需要的 core/window/event/webview/menu/tray 能力集合。
- 悬浮球只保留记录、文件库查询、收藏、定位、主窗口跳转、位置和拖动所需权限。
- 不新增 shell 能力；外部操作继续由 Rust 受控适配器执行。
- 任何新增 command 必须同时加入 Rust handler、build manifest、capability、generated ACL、JS 白名单、validator 和测试。

### 11.6 主要文件

- `prototype/src/App.jsx`
- `prototype/src/features/library/useLibraryActions.js`
- `prototype/src/features/library/useIndexController.js`
- `prototype/src/features/library/useLibraryNavigation.js`
- 新拆分的前端 Hook/service 文件
- `prototype/src-tauri/src/storage/mod.rs`
- `prototype/src-tauri/src/storage/repository.rs`
- `prototype/src-tauri/src/commands/mod.rs`
- `prototype/src-tauri/src/commands/library.rs`
- 新拆分的 Rust module
- `prototype/src/lib/ipcContracts.js`
- `prototype/src/lib/ipcContracts.d.ts`
- `prototype/src-tauri/build.rs`
- `prototype/src-tauri/capabilities/default.json`
- `prototype/src-tauri/capabilities/floating.json`
- `prototype/src-tauri/gen/schemas/`

### 11.7 自动验证

- 拆分前后运行全部前端模型和契约测试，确保纯函数结果不变。
- 增加 action controller 测试：成功、失败、取消、重试、旧响应、重复点击和组件卸载。
- 增加 Rust command mapping 测试：错误码、结构化状态、command 参数和事件 payload。
- 执行所有 `npm.cmd run test:*` 脚本、`npm.cmd run build`、Rust fmt/check/test/clippy。
- 检查生产源码中是否仍存在不必要的完整路径日志、任意 shell 调用、直接 `invoke` 和未校验的用户输入。

### 11.8 原生验收

- 主窗口、悬浮球、托盘、预览、设置、文件操作和重启流程与 `0.3.38` 对比不发生行为回退。
- 失败 command 能显示统一的可执行错误，不泄露内部路径、堆栈或命令行。
- capability 变窄后，主窗口和悬浮球所有既有功能仍可正常使用；未经授权的 command 被拒绝。

### 11.9 阶段完成标准

- 四个大模块已按职责拆分，App/Hook/command/storage 的边界在代码结构中可直接看见。
- 版本五根同步为 `0.3.39`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- IPC/capability parity 检查和文档完成。
- 本地 NSIS 安装包 `本地资料工作台_0.3.39_x64-setup.exe` 构建成功并通过 loader 校验。

### 11.10 当前执行状态

- 代码实现已完成：前端 action service、Rust command/storage 模块边界、结构化 IPC 错误和 parity 检查已接入；持久化格式保持兼容。
- 自动门禁已完成后再生成 `0.3.39` 本地 NSIS 候选；Windows 11/Tauri/WebView2 原生回归仍由用户执行，浏览器或自动测试不替代该验收。

## 12. 阶段 H：CI、发布门禁和最终回归（0.3.40）

### 12.1 目标

把前面阶段依赖人工记忆的质量检查固化为分支 CI 和发布 workflow，并对 `0.3.40` 形成完整本地安装包候选和最终 Windows 验收矩阵。

### 12.2 分支 CI

新增 `.github/workflows/ci.yml`，在 pull request 和受控分支 push 时执行：

- Windows runner、Node 22、Rust stable MSVC。
- `npm.cmd ci`。
- 全部前端 `test:*` 脚本。
- `npm.cmd run build`，验证 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。
- `cargo fmt --check`。
- `cargo check --locked` 和 `cargo check --tests --locked`。
- `cargo test --locked`。
- `cargo clippy --locked --all-targets --all-features -- -D warnings`。
- command/capability/IPC parity 检查。
- 依赖审计检查；对于 `xlsx@0.18.5` 的已知风险，必须输出明确的发布判断，不得让空审计结果掩盖风险。

CI 不负责替代 Windows 11 原生桌面验收，但必须阻止明显编译、契约、测试、格式和依赖门禁失败的分支进入发布流程。

### 12.3 发布 workflow 加固

修改 `.github/workflows/release.yml`：

- Tag 格式继续限定为 `vX.Y.Z`。
- 在构建 NSIS 前运行分支 CI 同等的最小测试、fmt、check、test、clippy 和 parity 检查。
- 版本校验覆盖五个版本入口，尤其是 `Cargo.lock` 根 package，不只检查 package.json、package-lock、Tauri 和 Cargo.toml。
- 验证 generated ACL 与 capability/build manifest 同步。
- 预置并校验 x64 `WebView2Loader.dll`，保持 loader 与 release 主程序同目录。
- 便携 ZIP 只包含确认过的主程序和 loader；NSIS 安装包只包含应用资源和必要运行时。
- Release 说明明确 WebView2 Runtime、LibreOffice、未签名或签名状态、安装架构和预览限制。
- 本地构建 hash 与 CI 重建 hash 分开记录，不把两者混为同一产物。

### 12.4 最终回归矩阵

#### 数据和索引

- 缺失 index、损坏 index、未知版本、迁移失败、原子写失败、恢复备份和明确重建。
- 中文文件名、空格路径、UNC、扩展路径、深层目录、长路径、同名文件、重复导入。
- 普通导入、递归导入、隐藏/系统项、符号链接/reparse point、取消、超时和达到上限。
- 收藏、标签、分组、批量操作、撤销、重命名、重新定位、移除索引和真实回收站删除。

#### 搜索和预览

- 元数据字面搜索、正则、中文/全角字符、空结果、旧响应和长路径。
- 正文索引初次同步、增量更新、重建、清除、取消、损坏隔离和容量上限。
- TXT、Markdown、PNG、JPG、JPEG、WEBP、GIF、BMP、MP4、WEBM、XLS、XLSX、DOCX、DOC、PDF。
- 损坏、加密、超大、权限拒绝、LibreOffice 缺失、PDF Range、预览关闭、快速切换和资源清理。

#### 窗口和系统集成

- 主窗口无边框拖动、最小化、最大化、关闭、隐藏到托盘和真正退出。
- 悬浮球启动、透明、置顶、拖动、四边/四角吸附、混合 DPI、多显示器、数量徽标和文件库展开。
- 悬浮球到主窗口的定位、目录、预览、资源管理器和失败恢复。
- 单实例、重启恢复、安装、卸载和应用 data 保留策略。

#### 可访问性和响应式

- 键盘快捷键、焦点返回、Dialog focus trap、Escape 层级、Space/Shift+Space 选择。
- 360、680、960、1280 CSS 视口，125%/150% 缩放模型，无页面/body 横向溢出。
- `prefers-reduced-motion`、屏幕阅读器名称、aria-live 重复播报和禁用/忙碌状态。

### 12.5 自动验证

阶段 H 必须运行完整验证组合：

~~~powershell
cd E:\Project\test\prototype
npm.cmd ci
npm.cmd run test:library
npm.cmd run test:contracts
npm.cmd run test:content
npm.cmd run test:settings
npm.cmd run test:operations
npm.cmd run test:preview
npm.cmd run test:floating-ball
npm.cmd run test:tray
npm.cmd run test:sites
npm.cmd run build

cd src-tauri
cargo fmt --check
cargo check --locked
cargo check --tests --locked
cargo test --locked
cargo clippy --locked --all-targets --all-features -- -D warnings

cd ..
npm.cmd run tauri:build
npm.cmd run verify:loader
~~~

同时执行：

- 版本五根一致性检查。
- IPC command、handler、build manifest、capability、generated ACL、JS 白名单和 `.d.ts` parity 检查。
- `git diff --check`、工作树范围、构建产物范围和秘密扫描。
- 依赖审计和发布边界检查。

### 12.6 原生验收和发布决策

- 本地 `0.3.40` 安装包只能称为本地候选，必须等待用户在 Windows 11/Tauri/WebView2 环境执行最终矩阵。
- 用户确认原生验收后，先更新 `PROJECT_PROGRESS.md` 和 README 的发布状态，再按单独授权执行 commit、合并、push、Tag、Actions 和 GitHub Release。
- 发布文档必须在 Tag/Release 前冻结；发布后只做只读检查，不再修改发布事实文档。
- 如果签名、WebView2 Runtime、LibreOffice 或 xlsx 依赖风险仍未解决，Release 说明必须明确写出，不能包装成无条件支持。

### 12.7 阶段完成标准

- 分支 CI 已运行并通过，发布 workflow 已加入质量门禁。
- 版本五根同步为 `0.3.40`。
- 该阶段独立分支已通过 ancestry 检查，并使用 `git merge --ff-only <phase-branch>` 本地并入 `dev`；合并后的 `dev` 状态已复核。
- 最终回归矩阵、自动证据、原生验收和剩余风险已分别记录。
- 本地 NSIS 安装包 `本地资料工作台_0.3.40_x64-setup.exe` 构建成功并通过 loader 校验。
- 未经用户单独授权，不创建 `v0.3.40` Tag、不推送、不发布 Release。

## 13. 版本、格式和回滚策略

### 13.1 版本提升规则

- `0.3.33` 至 `0.3.40` 每个阶段包含可验证的代码或工程能力变化，因此每阶段使用新的补丁版本。
- 仅文档修订不应伪造新的功能阶段；如果用户要求重新规划，应在本文件追加明确的 `0.3.x` 阶段或修订阶段。
- 破坏性 IPC、索引格式、配置格式、预览协议或安装方式变化必须在阶段说明中标记，并在版本根同步前完成迁移/兼容设计。

### 13.2 持久化格式规则

- 阶段 B、C、D、F、G 优先保持现有 index/settings/content/operation format 兼容。
- 任何格式迁移必须遵守：读取旧版本、创建 recovery backup、写入新版本、失败保留旧文件、启动可进入恢复状态、用户明确确认后才能重建空数据。
- 不把内存结构拆分误写成磁盘结构变化；代码模块拆分不等于 JSON 格式升级。
- 迁移测试必须覆盖旧版本、缺失字段、未知字段、损坏文件、部分写入和回滚失败。

### 13.3 回滚规则

- 每阶段必须保留上一阶段的可构建 commit 和已验证行为；不在同一个 commit 中混入无法定位的无关重构。
- 发现新阶段改变旧数据行为时，先停止进入下一阶段，保留候选安装包和 hash，记录阻塞原因。
- 不使用 `git reset --hard`、`git checkout --` 或删除用户文件来处理失败。
- 安装包回归不通过时，回到当前阶段代码修复并重新构建；不能复用修复前的安装包作为最终候选。

## 14. 长期触发条件：SQLite 评估

本计划暂不直接迁移 SQLite，但在阶段 D 和 H 记录以下指标：

- 20,000 条索引的加载、查询、筛选、排序和单条 mutation 延迟。
- `index.json` 实际大小、单次原子写入耗时和 undo 历史占用。
- 多次连续 revision 后前端 reload 和正文同步积压量。
- 应用启动、重启恢复和备份迁移时间。

满足任一条件时，新增独立的 `0.3.41` 或更高版本阶段，不在现有阶段中偷偷替换存储：

- 正常用户操作在 20,000 条索引下持续出现可感知阻塞。
- `index.json` 原子写入或恢复时间超过产品可接受边界。
- 需要复杂查询、标签索引、全文/元数据联合查询，JSON 已无法保持清晰的事务边界。
- 需要可靠的跨进程读写、分页查询或增量 mutation。

SQLite 阶段必须单独设计 schema、迁移、备份、恢复、加密/权限边界、测试夹具和安装包回滚，不能把数据库迁移隐藏在普通性能优化阶段。

## 15. 最终 Definition of Done

本路线全部完成时，必须同时满足：

- [ ] `0.3.33` 的 JPG、目录子项操作和数量徽标问题已修复并有回归测试。
- [ ] `0.3.34` 起所有索引读取都使用一致快照，revision 与事件顺序可证明。
- [ ] 元数据正则不再以无界/逐 entry 的 JavaScript RegExp 作为桌面实现。
- [ ] undo 差分、索引合并、直接导入和正文后台同步具有明确的复杂度和输入上限。
- [ ] 所有 app data 文件统一执行 symlink/reparse、大小、原子写入和恢复策略。
- [ ] 应用具备已验证的单实例或可靠跨进程数据一致性机制。
- [ ] `preview_status`、预览资源、任务取消、快速切换和临时目录清理闭环完成。
- [ ] `useLibraryActions.js`、`storage/mod.rs` 和 `commands/mod.rs` 已按职责拆分，新增功能不再继续扩大上帝模块。
- [ ] command 错误、IPC validator、`.d.ts`、build manifest、capability 和 generated ACL 有自动一致性检查。
- [ ] 分支 CI 在 PR/push 上执行前端测试、构建、Rust fmt/check/test/clippy 和必要审计。
- [ ] 发布 workflow 在构建前执行质量门禁并校验五个版本入口和 Release 载荷。
- [ ] `0.3.33`、`0.3.34`、`0.3.35`、`0.3.36`、`0.3.37`、`0.3.38`、`0.3.39` 和 `0.3.40` 每个版本都生成过本地 Windows x64 NSIS 安装包，并在 `PROJECT_PROGRESS.md` 记录路径、大小、SHA-256 和 loader 结果。
- [ ] A-H 每个阶段均在独立分支完成，并在阶段收口后通过 `git merge --ff-only` 本地并入 `dev`，随后使用 `git branch -d` 删除已合并阶段分支；没有阶段直接在 `dev` 上开发，也没有遗留历史阶段分支。
- [ ] 自动化/浏览器证据与 Windows 11/Tauri/WebView2 原生验收分开记录。
- [ ] 没有未经授权的 Tag、push、Release、真实用户文件、密钥或构建缓存进入仓库。

## 16. 执行阶段固定回报格式

每完成一个阶段，`PROJECT_PROGRESS.md` 和最终回报至少包含：

- 阶段编号和版本。
- 实际修改的代码、测试、文档、权限和版本文件。
- 已完成的功能和未完成的功能。
- 自动测试命令及通过/失败结果。
- `npm.cmd run build` 结果。
- `npm.cmd run tauri:build` 结果。
- NSIS 安装包绝对路径、文件大小和 SHA-256。
- `WebView2Loader.dll` 大小、SHA-256、x64 和同目录校验结果。
- 浏览器回退检查结果及其边界。
- Windows 11/Tauri/WebView2 原生验收：已由用户确认、等待用户确认或未执行。
- 阻塞问题、剩余风险和下一阶段的具体任务。
- 阶段独立分支名称、分支 HEAD、`dev` 合并前后 HEAD、ancestry 检查和 `git merge --ff-only` 结果。
- 阶段分支删除命令、删除前的已合并确认和删除后的本地分支列表。
- Git 当前分支、HEAD、工作树状态，以及是否执行了 commit/push/tag/release。

本文件只定义执行目标和门禁，不把计划文字本身当作代码、测试、安装或原生验收证据。
