# 本地资料工作台

面向 Windows 11 的本地资料收纳、检索与预览桌面应用。项目采用 Tauri 2 构建，文件与索引默认留在本机，支持悬浮球、系统托盘以及常见文档格式的只读预览。

## 项目简介

本地资料工作台用于把分散在电脑中的文件和文件夹集中登记，提供统一的检索、排序、收藏、目录浏览和预览入口。应用遵循 local-first 原则：导入资料时默认只保存路径和文件元数据，不复制原文件，不上传用户内容，也不依赖后端服务或在线账号。

当前发布版本为 `v0.3.40`，上一正式发布版本为 `v0.3.32`，历史基线为 `v0.3.16`。阶段 H `0.3.40` 已完成代码、自动门禁、NSIS、本地合并和用户 Windows 11/Tauri/WebView2 原生验收，并已发布 GitHub Release；浏览器自动化和本地安装包不替代原生验收。项目源码位于 [`prototype/`](prototype/)，根目录的计划和进度记录分别见 [`PROJECT_PLAN.md`](PROJECT_PLAN.md) 与 [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md)。

正式发布的 `0.3.16` 是此前版本的基线。上一正式发布版本 `v0.3.26` 新增了阶段 A-B 的多选上下文、列表滚动、portal 行菜单、紧凑导入条和活动筛选反馈，阶段 C 的预览失败恢复、相邻资料浏览和预览快捷操作，阶段 D 的单条标签/分组编辑、资料详情和分组删除确认，阶段 E 的操作中心、操作历史和设置冲突保护，阶段 F 的主窗口快捷键、Shift 范围选择、预览方向键、焦点隔离和响应式细节，阶段 G 的 v5 索引迁移、最近打开和悬浮球连续工作流，阶段 H 的 DOCX Worker、可取消清理和大型输出保护，阶段 I 的递归导入、导入策略、进度、取消、超时和安全上限，以及阶段 J 的纯文本/Markdown 正文索引、正则搜索、摘要高亮、增量同步、重建/清除和损坏隔离；这些新增能力的 Windows 11/Tauri 原生验收已由用户完成。

## 功能概览

- 通过文件选择器、文件夹选择器或桌面端拖放登记文件和文件夹。
- 保存路径、显示名、类型、大小、修改时间、收藏状态、标签、分组和预览状态等索引信息。
- 按名称、类型、状态、位置和标签搜索，按添加时间、修改时间、名称或大小排序，并支持分页；类型、标签、分组、收藏和失效路径可以组合筛选。
- 支持“文件名和元数据 / 正文”搜索范围切换；桌面元数据搜索在 Rust 侧使用受控线性时间 regex，正文索引覆盖共享文件类型清单中 `kind` 为 `text` 或 `markdown` 的纯文本内容，不限于 `.txt`，两种范围都支持受控正则搜索、命中字段、短摘要和高亮。
- 浏览已登记的文件夹和子目录；失效路径可以由用户选择同类型的新路径重新定位。
- 目录浏览和预览只接受已登记文件夹 ID 及受控相对路径片段，不接受前端传入的任意本地路径。
- 支持文本、Markdown、图片、视频、XLS/XLSX、DOCX、PDF 和 DOC 的受控只读预览。
- 索引刷新使用 revision 事件合并旧响应；索引损坏会保留备份并提供诊断导出和重建空索引入口，设置损坏会提示已使用默认值。
- 提供悬浮球和系统托盘，悬浮球文件库展示全部登记资料，支持文件名/元数据搜索、全部/收藏/文件夹/失效筛选、名称/类型/修改时间/最近打开排序和受控分页；托盘仍保留独立的“最近记录”语义，二者共享索引和收藏状态。
- 悬浮球文件库的文件行通过三个点菜单提供主窗口定位、文件夹目录进入、直接预览、资源管理器显示和收藏操作；这些入口使用不透明资料 ID，浏览器回退只显示演示限制。
- 悬浮球面板使用统一的悬停状态机和工作区几何模型，覆盖球体到面板的连续命中、按水平位置向左/右展开、面板内部滚动和键盘收起；阶段 D 的默认面板约为 `360 x 420 DIP`，窄视口会安全压缩并保留内部滚动。
- 在桌面端提供明确触发的复制、重命名、回收站删除、默认程序打开和资源管理器定位操作，并在执行前进行必要确认。
- 提供默认排序、分页数量、关闭时隐藏到托盘和悬浮窗可见性等设置；未启用关闭隐藏时，关闭主窗口会退出应用并清理托盘与悬浮球。
- 提供操作中心，记录导入、刷新、单条和批量索引操作的进行中、完成、部分完成、失败、取消和超时状态；批量逐项结果、跳过原因和可重试项可在 toast 消失后查看。
- `0.3.37` 阶段 E 候选统一检查 `index.json`、`content-index.json`、`settings.json`、`operation-history.json`、`floating-ball.json` 和 `pending-operations.json` 的目录、symlink/reparse、原始字节上限、备份和原子写入边界；重复启动会聚焦已有实例，带路径参数时复用受控导入流程。
- `0.3.38` 阶段 F 候选将预览资源绑定到注册时的文件快照，并在资源请求和实际读取前后复核路径、大小与文件身份；PDF/视频首包有界并支持 `Range`，预览状态通过带 revision 校验的 mutation 持久化，只有实际渲染成功才同时更新 `ready` 和 `lastOpenedAt`。
- `0.3.39` 阶段 G 按副作用边界拆出导入、单条 mutation、批量、文件、历史和悬浮球 action service；Rust 公开 command 入口拆分为索引、预览、正文、事件和批量模块，storage 增加状态、持久化、mutation、undo 和待同步操作模块。业务错误统一为受限的 `code/message/retryable/state` 契约，parity 脚本检查 JS 白名单、Rust handler、build manifest、capability 和 generated ACL。
- 桌面端刷新入口会保留当前选择、目录面包屑、页码和滚动位置；关闭或切换预览时会取消未完成的 DOC、XLSX、PDF 和媒体任务，并清理 Worker、资源会话和 DOC 临时目录。
- 主窗口区分“最近添加”“最近打开”和悬浮球/托盘的“最近记录”；只有预览成功或默认程序打开成功的资料才进入“最近打开”，并限制数量。
- 资料库使用语义化表格，分组单独显示为一列，位置可省略、展开和复制；行操作通过更多菜单分组，支持多选和批量收藏、标签、分组及索引移除。重命名会在输入框内显示非法字符、扩展名、冲突和空值原因，预览/设置/确认窗口共享键盘焦点管理。
- 文件类型和预览限制由 `prototype/shared/file-types.json` 统一提供，前端 IPC/API 通过运行时契约校验；窄窗口会切换为保留名称、类型、状态和高频操作的紧凑列表。
- `0.3.18` 候选会在切换导航、搜索、筛选或目录时清空批量选择，同时保留当前预览焦点；刷新索引只移除已经不存在的选择，并保存列表上下文的滚动位置规则。
- `0.3.18` 候选的行菜单通过 document overlay 定位，支持上下展开、窗口边界约束和基础菜单键盘操作；已有资料时导入区收缩为紧凑条，筛选条件和当前/总结果数直接显示在资料列表上方。
- `0.3.19` 候选的预览窗口从当前可见列表快照计算上一项/下一项；失败状态提供重试、重新定位、默认程序打开、资源管理器定位或返回列表动作，DOC 转换器缺失会说明 LibreOffice 依赖。浏览器回退明确标记为“浏览器演示限制”。
- `0.3.20` 候选的行菜单为主索引资料提供详情、标签编辑和分组编辑；详情弹窗展示元数据并提供预览、收藏、复制位置、定位和默认程序打开，标签 chip 可直接进入标签筛选，删除分组前显示影响数量并要求确认。
- `0.3.21` 候选的操作历史保存在独立的 `operation-history.json` 中，最多保留 100 条，只保存操作类型、计数、状态、受控资料 ID、原因和重试参数，不保存文件内容或完整路径；设置文件升级为带 revision 的 v3，旧 v1/v2 设置会原子迁移。
- `0.3.22` 候选增加主窗口内的 `Ctrl+F`、`F5`、`Ctrl+O`、`Ctrl+Shift+O` 和 `Ctrl+Z` 快捷键，支持当前列表上下文内的 Shift 范围选择、预览左右键切换、层级 Escape 和弹层焦点回收；快捷键不会注册为系统级全局热键。
- `0.3.23` 候选将索引从 v4 安全迁移到 v5，增加可选 `lastOpenedAt`；预览或默认程序打开成功后记录最近打开，主窗口新增最近打开导航，悬浮球打开资料会定位到主窗口的预览或文件夹目录。迁移前保留索引备份，索引不保存正文或日志中的完整路径。
- `0.3.24` 候选将 DOCX 的 Mammoth 转换移入可终止的 Web Worker；下载、解析、HTML 清理和资源释放均受取消/关闭路径管理，转换结果限制为 8 MiB 和 50,000 个元素，30 秒后显示超时状态。DOCX 仍保持只读和 HTML 安全清理。
- `0.3.25` 候选的文件夹导入默认只登记文件夹本身；用户可明确选择递归导入，配置支持格式范围、隐藏/系统项排除、递归深度和条目上限。扫描通过进度事件执行，可取消、超时并在一次原子合并中保留部分结果；操作中心展示扫描摘要、跳过原因和当前会话重试入口。
- `0.3.26` 候选增加独立的 `content-index.json` 正文索引；启动、导入、刷新和索引变更后后台增量同步，设置可查看条目数/占用大小/失败数并执行重建、取消和清除。正文正则由 Rust `regex` 线性时间引擎执行，表达式、正文单文件、总索引、摘要和结果数量均有上限；元数据正则也有输入长度和语法校验。
- `0.3.27` 阶段 A 代码候选新增独立的 `get_floating_files` 文件库查询契约：从索引投影不透明资料 ID、名称、类型、状态、收藏、文件夹和分组元数据，支持受限搜索、筛选、稳定排序和分页；返回携带 revision，但不返回完整路径、正文、缩略图或外部命令输出。`0.3.28` 阶段 B 完成文件库标题、总数徽标和固定骨架，`0.3.29` 阶段 C 已接入全量列表、搜索、筛选、排序、分页、空/错误状态、行元数据和浏览器演示数据。
- `0.3.30` 阶段 D 代码候选增加文件行主窗口定位、文件夹目录进入、资源管理器显示和直接预览入口；主窗口按当前索引 revision 重新定位并滚动到目标行，预览继续复用既有会话、资源协议和失败状态。
- `0.3.31` 阶段 E 代码候选增加悬浮窗的索引 revision 同步、查询序号防旧响应、Windows 路径去重拖放队列、分项记录反馈、分页搜索性能和窗口任务/拖动生命周期清理；`get_floating_files` 查询只读取已校验快照，不会因搜索输入重复扫描整个索引。阶段 F 已完成该计划的 Windows 11/Tauri/WebView2 原生验收，随后发布为 `v0.3.32`。

`0.3.34` 阶段 B 代码候选将索引可变状态收敛为单一一致快照，entries、groups、undo、recovery、pending 操作和 revision 在同一提交边界内读取；索引、settings 和正文索引均在原子持久化成功后替换内存快照，前端丢弃旧 revision 事件和响应。该版本仍为未发布候选，原生验收待执行。
`0.3.35` 阶段 C 代码候选将主窗口元数据搜索移到 Rust `regex` 服务，固定搜索字段为名称、类型、状态、标签、分组和受控位置摘要；正则表达式限制为 256 个字符、64 KiB 编译/DFA 预算，结果只携带 revision、不透明资料 ID、命中字段和最多受控高亮范围。桌面输入使用 140ms 防抖，并以请求序号、搜索上下文和索引 revision 丢弃旧响应；浏览器回退仍使用内存演示模型，不把 JavaScript 正则路径当作桌面实现。该版本仍为未发布候选，Windows 11/Tauri/WebView2 原生验收待执行。
`0.3.36` 阶段 D 代码候选将撤销差分、索引合并、索引去重和刷新映射改为一次构造的 ID/路径索引，避免对 20,000 条索引重复线性查找；批量收藏、标签、分组和移除只对受影响 ID 应用更新。直接导入和悬浮球记录在扫描前限制为最多 256 条路径、单路径 32 KiB、总输入 4 MiB，正文同步在总容量判断前使用文件 metadata size 做可行性筛选，并按 revision 合并 pending 任务。该版本仍为未发布候选，Windows 11/Tauri/WebView2 原生验收待执行。

## 使用者说明

### 运行条件

- Windows 11。
- 已安装 Microsoft WebView2 Runtime；当前安装包不内置 WebView2 安装程序。
- 预览 `.doc` 文件时需要本机安装 LibreOffice；其他已接入格式不依赖 LibreOffice。

### 基本使用流程

1. 启动“本地资料工作台”，使用导入入口选择文件或文件夹。
2. 也可以在桌面端把文件或文件夹拖到悬浮球，资料会登记到索引并在悬浮球文件库面板中显示；当前 `v0.3.32` 发布版已提供全量列表、搜索、筛选、排序、分页、revision 同步、重复路径抑制以及文件定位、文件夹目录、资源管理器显示和直接预览入口，阶段 F 原生验收已完成。
3. 在资料库中搜索、排序、分页或收藏资料；点击文件可以打开预览，点击文件夹可以进入目录。
4. 通过预览窗口查看内容。关闭预览、切换资料或退出应用时，当前预览会话会被释放。
5. 需要对原文件进行操作时，使用文件行中的明确操作入口。复制、重命名和移入回收站等操作不会由导入流程自动执行。
6. 在设置中调整排序方式、每页数量、关闭窗口行为和悬浮窗显示状态。

### 支持格式与限制

| 类型 | 格式 | 说明 |
| --- | --- | --- |
| 文本与 Markdown | 共享 manifest 中 `kind=text` 或 `kind=markdown` 的登记格式 | 只读查看，支持 UTF-8 BOM、UTF-8 和常见中文 Windows 编码判断；Markdown 渲染结果会经过安全清理，也可建立本地正文索引。 |
| 图片 | `.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.bmp` | 支持适应窗口、实际尺寸、缩放、旋转和尺寸信息。 |
| 视频 | `.mp4`、`.webm` | 不自动播放，具体编码能力取决于 Windows WebView2。 |
| 工作簿 | `.xlsx`、`.xls` | 支持切换工作表和基础表格查看；不执行宏、公式代码、外部链接或嵌入对象。 |
| Word 文档 | `.docx` | 在可终止的 Worker 中转换，支持标题、段落、列表、表格和常见内嵌图片；转换 HTML 限制为 8 MiB/50,000 个元素，复杂排版可能与原文不同。 |
| PDF | `.pdf` | 使用 PDF.js 分页和缩放，包含字体/CMap 资源和整页绘制保护；内容不会作为可信 HTML 执行。 |
| 旧版 Word 文档 | `.doc` | 通过本机 LibreOffice 转换为临时 PDF 后预览；缺少转换器时无法预览。 |

导入、预览和正文索引都设置了大小、读取范围和解析限制。SVG、MOV、AVI、MKV 等未登记格式会显示为暂不支持。当前发布版本仍不提供云同步、在线账号或批量物理复制/重命名/删除；阶段 G `0.3.39` 的模块拆分、结构化 IPC 错误、parity 门禁、本地 NSIS 候选、本地合并和 Windows 11/Tauri 原生验收均已完成，阶段 H `0.3.40` 已完成最终回归和用户原生验收并发布。正文索引只写入 Tauri app data 下独立的 `content-index.json`，不写入 `index.json`，也不把正文写入日志、toast、URL、操作历史或诊断导出。`v0.3.40` 已正式发布并创建 Tag/GitHub Release；旧悬浮球阶段 E/F 的 Windows 原生安装、真实拖放、混合 DPI、多显示器、资源管理器、文件预览和悬浮球生命周期验收均已由用户单独确认，当前架构加固阶段 B/C/D 的原生验收仍按本进度文档记录，阶段 E/F/G/H 的当前代码和验收状态已纳入 `v0.3.40`，浏览器回退和自动化结果仍按各自边界记录。

### 数据与隐私

此前产品路线的阶段 E `0.3.21` 已实现操作结果中心、受限操作历史和设置 revision 冲突保护，阶段 F `0.3.22` 已实现主窗口键盘操作、范围选择、预览方向键和响应式/无障碍细节，阶段 G `0.3.23` 已实现最近打开和悬浮球连续工作流，阶段 H `0.3.24` 已实现 DOCX 后台转换、输出限制和可取消预览，阶段 I `0.3.25` 已实现递归导入、导入策略、扫描进度、取消/超时、跳过摘要和安全上限，阶段 J `0.3.26` 已实现纯文本/Markdown 正文索引、正则搜索、摘要高亮、增量更新、重建/清除和损坏隔离；当前悬浮球文件库计划的阶段 F `0.3.32` 已验收并发布，完整状态与发布记录见 `PROJECT_PROGRESS.md`。

应用设置、资料索引、独立正文索引、操作历史和悬浮球位置保存在 Tauri 的本地应用数据目录中，不写入项目目录。正文索引会为已登记的纯文本和 Markdown 生成受限本地缓存，清除或重建不会修改原文件；正文不会进入操作历史、日志、toast、URL 或诊断导出。操作历史仅保存必要的状态和受控 ID，损坏时会在备份成功后回退为空历史，备份失败则保留原文件并显示可恢复提示。导入资料不会自动复制、移动或删除原文件；所有物理文件操作都必须由用户明确触发。浏览器回退模式只用于演示界面和内存状态，不能代替桌面端的真实文件、托盘和窗口能力。
阶段 D 保持 `index.json`、`content-index.json` 和操作历史格式不变。直接导入和悬浮球记录最多接收 256 条路径、单路径 32 KiB、总输入 4 MiB，超限请求在扫描前拒绝。正文同步失败仍与主索引隔离；连续索引 revision 只保留最新待处理快照。
阶段 E 保持现有 index/settings/content/operation/placement 格式版本不变；app data 原始读取上限、备份命名和目标目录检查由 Rust 统一执行。第二次启动的显示请求由单实例机制转发，文件参数只在 Rust 内进入受控导入流程，事件仅返回计数和不透明 ID。浏览器回退不模拟单实例、真实 app data 或 Windows 文件身份检查。

## 开发者说明

### 技术栈

- 桌面框架：Tauri 2。
- 前端：React 19、Vite 6、JavaScript/JSX。
- 原生层：Rust stable。
- 预览依赖：Marked、DOMPurify、Mammoth（DOCX Worker）、SheetJS、PDF.js，以及 Rust 侧用于 Office 容器边界检查的 zip。
- 目标平台：Windows 11 x64；安装包目标为 NSIS。

### 环境准备

安装并确认以下工具可用：

- Node.js 与 npm。
- Rust stable toolchain、Cargo 以及 Tauri 2 所需的 Windows 构建工具。
- Windows 11 上的 WebView2 Runtime。
- LibreOffice（仅在需要验证 `.doc` 预览时需要）。

### 获取依赖与启动

前端和 Tauri 项目位于 `prototype` 目录：

```powershell
cd prototype
npm.cmd install
```

启动 Tauri 桌面开发版：

```powershell
npm.cmd run tauri:dev
```

启动浏览器回退模式：

```powershell
npm.cmd run dev -- --host 127.0.0.1 --port 49217 --strictPort
```

浏览器回退模式使用内存演示数据和 HTML 文件选择器，不访问真实文件系统，也不提供系统托盘、悬浮窗和桌面文件操作能力。需要验证这些能力时，应使用 Tauri 桌面开发版。

### 构建与验证

生成前端和 Sites 产物：

```powershell
npm.cmd run build
```

生成 Windows x64 NSIS 安装包并验证 `WebView2Loader.dll`：

```powershell
npm.cmd run tauri:build
```

安装包输出目录为 `prototype/src-tauri/target/release/bundle/nsis/`。也可以单独检查 loader：

```powershell
npm.cmd run verify:loader
```

### 发布 Release

发布流程由 [`release.yml`](.github/workflows/release.yml) 管理。本轮 [`v0.3.32`](https://github.com/ChaceQC/Data-Collection/releases/tag/v0.3.32) 已按以下流程发布；后续版本将版本号替换为对应的 `vX.Y.Z`：

```powershell
git tag vX.Y.Z
git push origin vX.Y.Z
```

每个 Release 包含两个资源：

- Windows x64 NSIS 安装包：适合正常安装和卸载。
- Windows x64 便携 ZIP：解压后包含 `local-material-workbench.exe` 和 `WebView2Loader.dll`，适合不运行安装器的场景；目标设备仍需要已有 WebView2 Runtime。

Action 会拒绝版本标签与 `prototype/package.json`、`package-lock.json`、Tauri 配置或 Rust crate 版本不一致的发布请求。便携 ZIP 只包含应用运行所需的主程序和 loader，不包含构建缓存、测试夹具、用户资料或本地配置。

Release 构建使用 GitHub 公共托管的 `windows-2022` x64 runner。该标签对应 Windows Server 2022 构建镜像，GitHub 公共托管环境没有通用的 x64 Windows 11 runner 标签；这不会改变应用以 Windows 11 为目标平台的定位。安装、首次启动、托盘、悬浮窗和安装包目录等真实桌面验收仍应在 Windows 11 上执行。若改用 Windows 11 self-hosted runner，应将 Action 的 `runs-on` 改为实际配置的 runner 标签。

前端针对性测试：

```powershell
npm.cmd run test:library
npm.cmd run test:contracts
npm.cmd run test:settings
npm.cmd run test:operations
npm.cmd run test:content
npm.cmd run test:preview
npm.cmd run test:floating-ball
npm.cmd run test:tray
npm.cmd run test:sites
```

Rust 检查：

```powershell
cd src-tauri
cargo fmt --check
cargo check
cargo check --tests
cargo test
cargo clippy --all-targets --all-features -- -D warnings
```

### 代码结构

```text
prototype/
  src/                 # React 页面与各功能模块
    components/        # 通用 Dialog 和界面基础组件
    lib/               # 跨 feature 的文件类型与 IPC 契约
    features/library/  # 文件索引、列表、搜索和目录浏览
    features/preview/  # 各格式预览器及资源安全边界
    features/settings/ # 设置状态和设置面板
    features/operations/ # 操作中心和操作历史
    features/floating-ball/
                       # 悬浮球、最近资料与文件库候选
  src-tauri/
    src/commands/      # Tauri command 入口
    src/filesystem/    # 路径校验和文件系统操作
    src/preview/       # 预览适配器和受控资源协议
    src/storage/       # 本地索引、正文索引、设置、操作历史和位置存储
    src/windows/       # 托盘、窗口生命周期和 Windows 集成
  shared/              # 前端与 Rust 共用的文件类型/预览限制 manifest
  tests/               # 模型测试与无敏感测试夹具
```

前端交互应通过类型化的 Tauri command 进入 Rust 层，由 Rust 负责路径校验、索引持久化、文件读取和外部进程生命周期。新增预览格式时，应接入统一的预览注册表和资源协议，不能在列表组件中散落格式判断，也不能绕过安全边界直接读取任意本地路径。

### 开发约定

- 项目文档、终端输出和手工编辑的文本文件使用 UTF-8。
- 用户文件只在用户明确操作后复制、移动、重命名或删除；默认不引入账号、云同步和遥测。
- 不把用户文件内容、真实路径、密钥、令牌或私钥写入日志、测试夹具和提交记录。
- 新增代码、测试、构建或架构变化时同步更新 `PROJECT_PROGRESS.md`；计划性工作遵循 `PROJECT_PLAN.md`。
- 提交前检查 `git status`、改动内容和 `git diff --check`，不要提交构建产物、缓存、真实资料或本地配置。
- 版本号在前端 package、Tauri 配置和 Rust crate 入口保持一致，当前发布版本为 `v0.3.40`，上一正式发布版本为 `v0.3.32`，历史基线为 `v0.3.16`；阶段 B/C/D 的 Windows 11/Tauri/WebView2 原生验收仍按 `PROJECT_PROGRESS.md` 记录，阶段 E/F/G/H 的当前代码和验收状态已纳入 `v0.3.40`。

## 参考文档

- [`prototype/README.md`](prototype/README.md)：原型目录内的详细功能、预览依赖和桌面验收说明。
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md)：项目阶段计划和完成条件。
- [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md)：已完成事项、验证结果、风险和下一步记录。
- [`docs/phase-f-settings-and-external-operations.md`](docs/phase-f-settings-and-external-operations.md)：设置、外部文件操作和失败恢复边界。
- [`AGENT.md`](AGENT.md)：项目开发协作约束。
