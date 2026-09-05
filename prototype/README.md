# 本地资料工作台原型

这是基于 `AGENT.md` 方案 3“收纳入口”实现的本地资料工作台。当前发布版本为 `v0.3.40`，建立在上一正式发布版本 `v0.3.32` 和历史基线 `v0.3.16` 之上；架构加固阶段 H `0.3.40` 已完成代码、自动门禁、NSIS、本地合并和 Windows 11/Tauri/WebView2 原生验收，并已发布 GitHub Release。阶段 B/C/D 的原生验收、Tag 和 Release 仍按计划记录；浏览器运行时仍只保留安全的原型回退。

上一候选为新计划阶段 B `0.3.42`，修复 R03-R05：文件/目录重定位选择器与稳定 ID 校验、重命名期间的并发元数据保留、同一资料物理操作互斥、删除日志恢复和重建空索引确认。主索引仍为 v5，`pending-operations.json` 升级为 v2；旧日志保留备份，结果不确定时要求核对，不在启动时重做删除。持久化顺序及旧版回退限制见 [文件操作与恢复](../docs/file-operation-recovery.md)。阶段 A、B 均已由用户确认原生验收，阶段 B 确认日期为 2026-09-05；正式发布基线仍为 `v0.3.40`，`0.3.42` 为未发布本地候选。

## 启动

新计划阶段 C `0.3.43` 为当前开发候选：正文缓存采用统一大小与编码校验，旧超限条目备份隔离；摘要高亮按 Unicode 坐标计算。正文搜索改为共享快照、受限异步 worker 与请求取消，清除和重建使用任务代次及缓存修订号保护。磁盘格式继续为 v1，详情见 [正文索引与查询](../docs/content-index.md)。`test:content` 新增真实 Hook 和实际摘要组件渲染回归。阶段 C 原生验收待用户完成，正式发布基线仍为 `v0.3.40`。

```powershell
npm.cmd install
npm.cmd run dev -- --host 127.0.0.1 --port 49217 --strictPort
```

启动 Tauri 2 桌面应用：

```powershell
npm.cmd install
npm.cmd run tauri:dev
```

构建 Windows x64 NSIS 安装包：

```powershell
npm.cmd run tauri:build
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。`tauri:build` 通过 `bundle.resources` 将构建生成的 loader 映射到 NSIS 安装目录根部，并执行 `scripts/verify-webview2-loader.mjs` 检查 loader 的 PE 架构、大小、SHA-256 和 release 主程序同目录布局；也可以单独运行 `npm.cmd run verify:loader`。当前安装模式为当前用户安装，构建配置不打包 WebView2 安装程序；Windows 11 目标机需要已有 WebView2 Runtime。

## 当前范围

- Tauri 运行时通过原生选择器和桌面拖放获取真实路径，由 Rust 校验并登记文件名、类型、大小和修改时间。
- 导入文件夹默认登记为一条文件夹记录，不在一级列表展开其中的文件；点击文件夹后按需读取直接子项并支持进入子目录。文件夹选择后也可以明确切换为递归导入，扫描当前文件夹和子目录中的普通文件。目录 command 和递归扫描都只接受经过 Rust 校验的范围，不跟随符号链接或 Windows reparse point；目录读取最多 20,000 项，递归导入另有限制、进度、取消和超时。
 - 索引保存于 Tauri app data 目录的版本 `5` `index.json`，记录路径、文件元数据、`favorite`、`addedAt`、`lastRecordedAt`、可选的 `lastOpenedAt`、标签和可选分组引用；分组表与有限的索引撤销日志同样只保存元数据，不复制文件内容。v1/v2/v3/v4 索引迁移会保留用户字段并为新字段补空值，重复 ID/路径按稳定顺序合并。每次索引变更携带单调 revision，刷新请求不会用旧响应覆盖新状态；阶段 D 保持 v5 格式不变，并使用有界 ID/路径索引处理 20,000 条登记记录。
- 索引损坏、未知版本或迁移写入失败时会先保留备份并进入可操作恢复状态；主窗口提供诊断导出和重建空索引入口。设置损坏时仅在备份成功后修复为安全默认值，备份失败会保留原文件并显示明确提示。
- 设置保存于同一 Tauri app data 目录的版本 `3` `settings.json`，记录 revision、默认排序、每页数量、索引移除确认、`hideToTray` 和 `showFloatingWindow`；读取版本 `1`/`2` 时保留旧字段并原子迁移，保存使用 expected revision 防止跨窗口覆盖。
- 操作历史保存于同一 Tauri app data 目录的版本 `1` `operation-history.json`，最多保留 100 条导入、刷新、索引整理和撤销记录；记录只包含计数、状态、受控资料 ID、跳过原因和重试参数，不保存正文或完整路径。文件损坏时先备份并回退为空历史，不阻塞应用启动。
- `0.3.37` 阶段 E 候选为六类 app data 文件统一执行安全父目录、symlink/reparse、原始字节上限、目标类型和原子写入检查；损坏文件只在备份成功后自动修复，备份失败保留原文件。应用通过 `tauri-plugin-single-instance` 聚焦已有实例，第二次启动的路径参数只在 Rust 内复用受控导入流程。
- 失效路径可以通过用户明确选择的同类型新文件或文件夹重新定位，不会自动移动、复制或删除原文件。
- 预览资源绑定注册时的文件快照，每次请求和实际读取前后复核普通文件、canonical 路径、大小与文件身份；PDF/视频支持单次最多 1 MiB 的显式 `Range`，未知资源 ID、任意 query、文件替换及释放后的读取都会被拒绝。
- `0.3.39` 阶段 G 将资料库 action service 按导入、单条 mutation、批量、文件、历史和悬浮球交接拆分；Rust command/storage 按索引、预览、正文、事件、批量、状态、持久化、mutation、undo 和待同步操作划分入口，IPC 错误统一为受限结构化契约，并由 parity 脚本检查五个 command 来源的一致性。
- 点击普通文件行会打开模态预览对话框；关闭对话框、切换资料、目录返回和窗口退出都会取消当前预览任务，并释放 Worker、资源会话和 DOC 临时目录。
- 纯文本和 Markdown 使用 Rust 受限读取，支持 UTF-8 BOM、UTF-8 和 GB18030 判断；Markdown 的渲染结果经过 DOMPurify 清理，原文、HTML、JS、JSON 和配置内容都按安全文本显示。
- 已接入 PNG、JPG、JPEG、WEBP、GIF、BMP 图片适配器，以及 MP4、WEBM 原生视频适配器。图片支持适应窗口、实际尺寸、缩放、旋转和尺寸信息；视频不自动播放，编码能力以当前 WebView2 为准。
- XLSX/XLS 使用 SheetJS 在可终止 Worker 中按工作表惰性读取受控资源，支持 Sheet 切换、空值、日期、数字和基础格式；Rust 先限制 Office ZIP 解压后体积和条目数量，前端最多显示 100 个 Sheet、每个 Sheet 首屏 500 行/50 列及 25,000 个单元格，公式只显示缓存值或安全文本，不执行宏、公式代码、外部链接或嵌入对象。
- DOCX 使用可终止的 Web Worker 调用 Mammoth 转为 HTML，再按批次让出事件循环并由 DOMPurify 清理；下载、转换、清理、关闭和快速切换均有取消路径，原始转换 HTML 限制为 8 MiB/50,000 个元素，30 秒超时会显示可重试状态。支持标题、段落、列表、表格和常见内嵌图片；复杂分页、字体、批注、目录和高级排版可能与原文不同。
- PDF 使用 PDF.js worker 通过 canvas 分页渲染，内置 CMap/标准字体数据并按设备像素比完成整页绘制后再显示，支持上一页/下一页和缩放；PDF 内容不作为可信 HTML 注入。
- DOC 通过受控系统探测定位 LibreOffice `soffice.exe`，使用隔离的临时用户 profile 以参数数组转换到应用临时目录中的 PDF，再交给 PDF.js 预览；输出大小、PDF 签名、超时、退出码和临时目录均受控，缺少转换器时返回明确的 `converter-missing` 状态。
- 预览状态使用索引中的 `previewStatus`：中断的 `loading` 在启动时恢复为 `idle`，成功渲染后凭 Rust 管理的 `outcomeToken` 原子写入 `ready` 和 `lastOpenedAt`。凭证关联文件 ID、文件级内存修订、来源 metadata 和任务身份，最多 64 个、有效期 30 分钟，取消、释放、来源变化或新任务取代后失效；凭证不写入磁盘。无关元数据变更不阻止回写，同一 ready 重试保持幂等，持久化失败有限重试并反馈，预期过期结果静默丢弃。目录临时子项不回写主索引。
 - 浏览器运行时继续使用内存演示数据和 HTML 文件选择器，不触碰真实文件；浏览器中收藏、标签、分组和索引移除只模拟内存状态。
 - 桌面直接导入、悬浮球记录和第二实例路径转发最多接收 256 条路径、单路径 32 KiB、总输入 4 MiB，超限请求在文件扫描前拒绝；递归导入也复用同一套路径字节校验。正文索引达到容量上限时会先按文件 metadata size 判断是否可行，连续 revision 只保留最新待同步快照。阶段 D 未改变索引、正文索引或操作历史格式。阶段 E 的 app data 原始读取上限为 `index.json` 64 MiB、`content-index.json` 72 MiB、设置/位置 64 KiB、操作历史 16 MiB、待同步操作 8 MiB。
- 资料库视图支持收藏/取消收藏、从索引移除、按名称/类型/状态/位置/标签搜索、按添加时间/修改时间/名称/大小排序和每页 20 条分页；“最近添加”按持久化 `addedAt` 排序并限制为最近 50 条，目录视图不再使用临时 `addedAt` 排序。类型、标签、分组、收藏和失效路径可以组合筛选。
- 资料库区分“最近添加”“最近打开”和悬浮球/托盘的“最近记录”；“最近打开”按持久化 `lastOpenedAt` 倒序并限制为最近 50 条，只有预览成功或默认程序打开成功才会写入该时间。
- 资料库使用语义化表格；位置可省略、展开、复制并通过受控 command 定位，分组单独显示为一列，标签显示在名称下方。行操作收进更多菜单，并将“删除原文件”放在独立危险操作分组；主索引支持多选、批量收藏/标签/分组/移除、部分成功报告、取消/超时和受控重试。
- 操作中心将导入、刷新、单条和批量索引操作从短时 toast 提升为可回看的记录，展示进行中、成功、部分成功、失败、取消和超时状态；批量逐项结果、跳过原因和失败项重试可在记录详情中查看。
- `0.3.18` 候选会把活动导航、搜索、类型/标签/分组筛选和目录面包屑作为列表上下文；上下文变化时收束批量选择，刷新时保留仍存在的选择、预览对象、页码和滚动位置。
- `0.3.18` 候选的行操作菜单通过 document overlay 和 fixed 定位显示，按窗口空间自动上下展开，支持边界约束、焦点返回、方向键、Home、End、Escape 和 Tab；已有资料时拖放入口收缩为紧凑导入条，筛选 chip 和结果数显示在列表上方。
- `0.3.19` 候选的预览窗口按当前可见列表快照提供上一项/下一项浏览；预览失败状态提供重试、重新定位、默认程序打开、资源管理器定位或返回列表动作，DOC 转换器缺失会显示本机 LibreOffice 依赖；浏览器回退明确显示“浏览器演示限制”。
- `0.3.20` 候选的主索引行菜单提供资料详情、单条标签和分组编辑；标签编辑支持去重、添加和删除，详情弹窗提供预览、收藏、复制位置、定位和默认程序打开，删除分组前会展示影响数量并要求确认；标签 chip 可进入标签筛选。
- `0.3.21` 候选增加操作结果中心、操作历史持久化和设置草稿冲突保护；设置从 v2 迁移为带 revision 的 v3，操作历史独立限制为 100 条。
- `0.3.22` 候选增加主窗口内快捷键、当前列表上下文内的 Shift 范围选择、预览左右键切换、层级 Escape、弹层焦点回收和 360px/缩放响应式检查；不引入系统级全局快捷键。
- `0.3.23` 候选将索引从 v4 迁移到 v5，迁移前创建 recovery 备份；预览成功或默认程序打开成功后记录 `lastOpenedAt`，主窗口新增最近打开导航，悬浮球打开记录会直接定位到主窗口预览或文件夹目录。索引仍不保存正文和完整路径日志。
- `0.3.24` 候选将 DOCX 的 Mammoth 转换移入可终止 Worker，增加解析阶段、耗时提示、取消/超时状态以及转换 HTML 的二次大小和节点限制；没有新增 npm 或系统运行时依赖。
- `0.3.25` 候选增加文件夹导入策略对话框；递归模式可选择支持格式范围、隐藏/系统项排除、递归深度和最大登记条目。Rust 逐项重新执行 canonical、普通文件、权限和根目录边界校验，扫描结果通过进度事件反馈，取消/超时后一次原子合并已完成部分；操作中心保存扫描摘要、跳过原因和当前会话重试入口，不保存正文或完整路径。
- `0.3.26` 候选增加独立的 `content-index.json` 正文索引；索引共享 manifest 中 `kind=text` 或 `kind=markdown` 的纯文本内容，不限于 `.txt`，启动、导入、刷新和索引变更后后台增量同步。资料库支持元数据/正文范围切换和受控正则搜索，结果显示命中字段、短摘要和高亮；设置可查看占用统计并执行重建、取消和清除。
- `0.3.35` 阶段 C 代码候选将桌面元数据 regex 搜索交给 Rust `regex` 线性时间引擎，固定名称、类型、状态、标签、分组和受控位置摘要字段；查询上限为 256 个字符，regex 编译和 DFA 预算各为 64 KiB。搜索结果只包含 revision、不透明资料 ID、命中字段和受控高亮范围；前端使用 140ms 防抖、请求序号、搜索上下文和 revision 双门控，浏览器回退继续使用内存演示模型。
- `0.3.27` 阶段 A 代码候选新增 `get_floating_files` 文件库查询 command，返回全部登记条目的安全元数据投影，支持名称/类型/标签/分组搜索、白名单筛选、稳定排序和分页，并使用 revision 绑定查询结果；返回不包含完整路径、正文、缩略图或命令行。`0.3.28` 阶段 B 完成文件库标题、总数徽标、固定面板骨架和窄视口压缩，`0.3.29` 阶段 C 已接入完整列表交互、搜索、筛选、排序、分页、空/错误状态和行元数据。
- `0.3.30` 阶段 D 代码候选增加文件行主窗口定位、文件夹目录进入、资源管理器显示和直接预览；主窗口清除阻塞目标的查询条件，按当前列表快照计算目标页并滚动到目标行，预览入口复用既有预览会话和资源协议。
- `0.3.31` 阶段 E 代码候选增加悬浮窗的索引 revision 同步、查询序号防旧响应、Windows 路径去重拖放队列、分项记录反馈、分页搜索性能和窗口任务/拖动生命周期清理；`get_floating_files` 查询只读取已校验快照，不会因搜索输入重复扫描整个索引。阶段 F 已完成该计划的 Windows 11/Tauri/WebView2 原生验收，版本入口随后同步到 `0.3.32` 并发布。
- 分组支持创建、重命名和删除；删除分组只解除资料归属，不删除索引记录或原文件。收藏、标签、分组和索引移除写入最多 50 条本地元数据撤销记录，只有当前 revision 和目标状态均匹配时才允许撤销。
- `shared/file-types.json` 是前端和 Rust 共用的类型/预览限制 manifest；`src/lib/ipcContracts.js` 和 `ipcContracts.d.ts` 负责 IPC 结构校验，`features/library` 下的 repository/controller 负责 command 与页面状态协调。
- 预览、设置、重命名、索引移除和原文件删除共用 Dialog 焦点陷阱；窄窗口将资料表切换为保留名称、类型、状态和高频操作的紧凑卡片，样式提供 reduced-motion 和深色模式策略。
- 桌面应用支持把普通文件复制到 Windows 文件剪贴板、同目录重命名和移入系统回收站；复制后用户可在资源管理器中粘贴，应用不选择目标目录、不创建副本、不修改索引。这些操作分别经过确认、Rust 端 ID 查找和路径复核，文件夹及目录临时子项不提供物理操作。
- 桌面应用支持由用户明确点击“用默认程序打开”和“在资源管理器中定位”；Rust 端只从索引按 ID 或登记文件夹 ID 加相对路径取回并重新校验当前路径，通过系统文件关联或资源管理器执行，不开放任意 shell。文件夹和目录临时子项均使用受控定位入口，失效记录保留明确错误状态。
- 桌面应用启动时创建独立的 `floating-ball` 悬浮球窗口。用户可以从资源管理器把普通文件或文件夹拖到球体，Rust 端只登记路径和元数据；重复路径保留原索引 ID、收藏、添加时间和预览状态，并更新悬浮球专用的毫秒级 `lastRecordedAt`。
- 悬浮球面板当前显示索引中的全量文件库条目；每条资料显示文件/文件夹图标、名称、类型、大小、分组、修改时间和失效状态，并通过三个点菜单提供直接预览、资源管理器显示和收藏/取消收藏。路径失效、索引移除、重命名、重新定位、最近打开和原文件操作通过 `index-changed` 事件同步。
- 当前阶段 E 已完成文件库标题、数量读取状态、固定 `360 x 420 DIP` 布局、全量列表、受控搜索、全部/收藏/文件夹/失效筛选、名称/类型/修改时间/最近打开排序、内部分页、加载/空/错误状态、文件定位、文件夹目录、资源管理器定位和直接预览入口，以及 revision 同步、拖放去重、结果反馈、窄窗口和生命周期稳定性；阶段 F 已完成 Windows 11/Tauri/WebView2 原生验收，`v0.3.32` 已发布，浏览器演示数据不会执行真实本地操作。
- 悬浮球使用受控的低频光标位置轮询、阈值滞回和延迟展开；用户可以拖动球体到工作区内自由位置或在 `24 DIP` 范围内贴到边缘。位置独立保存于 app data 目录的 `floating-ball.json` v1，保存的是显示器标识和逻辑坐标，不保存文件路径。
- 悬浮球悬停优化使用 `floatingBallGeometryModel` 的 `ballRect`、`panelRect`、`hostRect` 和 `workArea` 纯模型，以及单一 `floatingBallHoverController` 状态机；面板从球体到面板的交互区域连续，打开前按水平位置选择左/右，空间不足时压缩面板并保留内部滚动。
- 桌面端在启动后创建唯一的“本地资料工作台”系统托盘图标，菜单提供打开主窗口、刷新索引、打开设置、显示/隐藏悬浮窗、最近任务和真正退出入口；托盘创建失败时主窗口保持可用并显示安全错误。
- 设置面板提供“关闭窗口时隐藏到系统托盘”和“显示悬浮窗”。前者只拦截普通主窗口关闭请求，未勾选时关闭主窗口会同时退出应用并清理托盘、悬浮球和预览资源；托盘退出会绕过隐藏逻辑。后者会持久化并在运行时创建/销毁悬浮球，默认值分别为 `false` 和 `true`。
- 无装饰主窗口使用明确的标题栏拖动区域；窗口顶部拖动带和页面标题使用 Tauri `data-tauri-drag-region="deep"`，窗口控制、搜索、排序、资料列表、拖放区和模态对话框均标记为非拖动区域。
- 托盘最近任务与悬浮球共享索引 v5 的最近记录和收藏状态，最多显示 5 项；主窗口最近打开使用独立的 `lastOpenedAt`，每项只携带不透明索引 ID，不在菜单或事件中暴露完整路径。
- 一级列表和文件夹内容按每页 20 条显示，文件夹浏览提供面包屑和返回上级操作。
- 设置面板支持默认排序、排序方向、每页 10/20/50 条、索引移除确认、关闭隐藏到托盘、悬浮窗可见性和正文索引管理；预览大小/图片像素上限只读展示，物理删除确认始终开启。设置窗口打开后会记录 revision/草稿，跨窗口变更会提示并按字段合并；浏览器回退仅在当前会话应用设置。
- 已接入原有索引、预览、窗口和操作 command，以及 `content_index_status`、`search_content`、`search_metadata`、`rebuild_content_index`、`clear_content_index` 和 `cancel_content_index` 六个搜索/正文索引 command；搜索结果只返回不透明资料 ID、受控命中字段/范围和统计，不返回完整路径或正文。

## 预览依赖与边界

- Markdown：`marked@15.0.12` 和 `dompurify@3.4.14`。
- DOCX：`mammoth@1.12.2`。
- XLSX：`xlsx@0.18.5`。
- PDF：`pdfjs-dist@4.10.38`，worker、CMap 和标准字体数据随前端构建产物打包。
- XLSX 解析运行在可终止的 Web Worker 中，主页面只接收已截断的纯字符串和数字数据；切换文件或卸载时终止 Worker。
- Rust：`encoding_rs`、`image`、`regex`、`trash`、`uuid`、`windows-sys`、`zip` 和 HTTP 资源协议依赖均由 `src-tauri/Cargo.toml` 锁定。
- LibreOffice 是 DOC 的可选外部依赖。本实现只探测受控系统路径和 PATH 中的 `soffice` 可执行文件，不把转换器打进安装包；未找到时不把 DOC 标记为可预览。

统一初始限制如下：纯文本/Markdown 2 MiB，DOCX/XLSX 20 MiB，Office ZIP 解压后 100 MiB/2,000 个条目，PDF/图片 50 MiB，视频 512 MiB；图片解码尺寸超过 100 megapixels、PDF 超过 200 页或单页 canvas 超过尺寸/像素上限时拒绝。前端不能通过 options 提高这些限制。PDF 和视频资源支持 Range 请求，资源 URL 只包含随机 `previewId`，不包含原始路径。

Windows WebView2 使用 `http://preview.localhost/<previewId>` 访问受控资源协议，其他平台使用 `preview://localhost/<previewId>`；前端保留旧资源 URL 的兼容归一化，避免二进制预览因平台协议地址不一致而卡在加载状态。

预览结果协议中的资源字段由 Rust 显式序列化为前端使用的 `resourceUrl`、`mediaType`、`byteLength` 和 `supportsRange`，二进制预览适配器通过该字段读取受控资源，不依赖 Rust 默认的 snake_case 字段名。

PDF 使用官方 `PDFDataRangeTransport`，根据真实 `byteLength` 按 64 KiB 块发起受控 Range，大请求再拆为最多 1 MiB 的单请求；DOC 转换得到的 PDF 复用该读取方式。PDF/视频超过 1 MiB 时，无 Range 的 GET 返回 400；较小资源返回完整 200，HEAD 返回真实总长度且无 body。206 的 body、Content-Length 和 Content-Range 保持一致，销毁时中止在途 fetch，视频继续由媒体元素发起 Range。PDF 的 50 MiB、200 页、像素和超时限制保持不变。

阶段 A 新增 `npm.cmd run test:async-state`，以真实 React Hook 和虚拟时钟验证目录导航、索引事件、同步上限及预览结果重试；`test:preview` 包含真实 PDF.js 的小文件、大文件末页、损坏文件和取消回归。`react-test-renderer@19.2.0` 与 `pdf-lib@1.17.1` 仅为项目内开发依赖，分别用于 Hook 挂载和合成无个人信息的 PDF。前者会输出 React 的弃用提示，不作为应用运行时依赖。

预览、资料库核心功能、阶段 F 的设置和显式外部操作，以及此前悬浮球阶段 A-F 的实现、自动验证、Windows 11 桌面手工验收和 `v0.3.6` GitHub Release 均已完成。此前计划阶段 A-J 的代码实现、自动验证、浏览器回退检查和用户 Windows 11/Tauri/WebView2 原生验收均已完成，`v0.3.26` 已创建 Tag 并发布 GitHub Release；悬浮球计划阶段 E `0.3.31` 已完成代码候选、自动验证、浏览器回退检查和 NSIS 候选构建，阶段 F Windows 11/Tauri/WebView2 原生验收已由用户完成，五个版本入口已同步到 `0.3.32`，`v0.3.32` 已创建 Tag 并发布 GitHub Release。当前架构加固阶段 E `0.3.37`、阶段 F `0.3.38`、阶段 G `0.3.39` 和阶段 H `0.3.40` 的代码、门禁、构建和 Windows 11/Tauri/WebView2 原生验收已纳入 `v0.3.40` 发布。不把所有格式写成无条件“已支持”，视频编码、LibreOffice 和 WebView2 Runtime 仍按各自外部依赖边界处理。

依赖审计注意事项：当前公开 `xlsx@0.18.5` 没有可用的 npm 修复版本，并存在已知 Prototype Pollution/ReDoS 报告。应用不打开宏、外部链接或 HTML，限制工作簿大小和展示范围，并在 Worker 中解析以便超时或异常时终止；在替换为有修复的兼容库前，该风险仍需纳入发布判断。

## 当前限制

- `index.json` 仍只保存路径和元数据；正文检索使用独立的 `content-index.json`，预览正文、资源会话 ID 和临时 PDF 不写入 `index.json`。
- SVG、MOV、AVI、MKV 等未登记格式返回 `unsupported`；视频不提供隐藏转码。
- DOC 预览依赖本机 LibreOffice；当前构建未内置或下载 WebView2 Runtime，也未签名。
- 当前不提供批量物理复制/重命名/删除或跨任意历史的通用撤销栈；架构加固阶段 G `0.3.39` 的模块拆分、结构化 IPC 错误和 parity 门禁已完成代码实现，阶段 H `0.3.40` 已完成最终回归和 Windows 11/Tauri/WebView2 原生验收并发布。原阶段 F 的设置和显式外部操作决策记录在 `docs/phase-f-settings-and-external-operations.md`，阶段 G 及后续阶段以 `PROJECT_PLAN.md` 和 `PROJECT_PROGRESS.md` 为准。
- 悬浮球透明置顶窗口、资源管理器真实拖放、位置恢复以及本轮新增的悬停状态机、四边四角几何、跨 DPI 和组合交互均已由用户在 Windows 11 桌面端验收通过；浏览器回退只展示内存演示状态。
- 浏览器回退不会执行真实文件剪贴板、重命名、原文件删除或外部打开/定位；桌面端复制到剪贴板、资源管理器粘贴、设置持久化和显式外部操作已由用户在 Windows 环境完成手工验收。
- 解析失败、缺失、权限不足、过大、转换器缺失、取消、超时和暂不支持均保留索引并在模态对话框显示可执行的下一步。
- 已使用 Windows GNU 工具链构建 x64 NSIS 安装包；安装器签名、WebView2 Runtime 提供方式和 LibreOffice 仍属于发布边界说明。

## 验证

```powershell
npm.cmd run build
npm.cmd run test:library
npm.cmd run test:contracts
npm.cmd run test:async-state
npm.cmd run test:settings
npm.cmd run test:operations
npm.cmd run test:content
  npm.cmd run test:preview
  npm.cmd run test:floating-ball
  npm.cmd run test:tray
  npm.cmd run test:sites
  npm.cmd run verify:loader
```

Rust 侧检查：

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo check --tests
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

`npm.cmd run build` 会生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。浏览器/Sites 模式不会调用真实文件预览、托盘、窗口、递归导入或正文索引 command；此前 Windows 桌面预览、资料库操作、阶段 F、悬浮球基础能力和阶段 H-J 验收记录在根目录 `PROJECT_PROGRESS.md`，新的阶段 A `0.3.27`、阶段 B `0.3.28`、阶段 C `0.3.29`、阶段 D `0.3.30`、悬浮球阶段 E `0.3.31`、已发布阶段 F `0.3.32`、架构加固阶段 B `0.3.34`、阶段 C `0.3.35`、阶段 D `0.3.36`、阶段 E `0.3.37` 和阶段 F `0.3.38` 的代码、自动验证、NSIS 构建结果及用户原生验收记录也记录在同一进度文档中。

悬浮球阶段的自动验证使用 `npm.cmd run test:floating-ball`、`cargo test`、`cargo check` 和 `cargo clippy`；真实 Windows 窗口、文件拖放、多显示器位置和关闭/重启行为的验收记录均保留，阶段 F 的完整 Windows 11/Tauri/WebView2 原生验收已由用户完成，代理不以浏览器页面或开发侧命令结果替代该验收。
