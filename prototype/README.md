# 本地资料工作台原型

这是基于 `AGENT.md` 方案 3“收纳入口”实现的本地资料工作台。当前版本 `0.3.16` 是在 `0.3.6` 基础上合并阶段 A-I 并完成阶段 J 发布验收后的整体版本，包含 Tauri 2 桌面外壳、真实文件索引、统一预览适配器、悬浮球和系统托盘生命周期代码；用户已确认阶段 A-J 对应的 Windows 11/Tauri/WebView2 桌面验收完成，浏览器运行时仍只保留安全的原型回退。

## 启动

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
- 导入文件夹会登记为一条文件夹记录，不在一级列表展开其中的文件；点击文件夹后按需读取直接子项并支持进入子目录。目录 command 只接受已登记文件夹 ID 加受控相对路径片段，不跟随符号链接或 Windows reparse point，单次读取最多 20,000 项。
- 索引保存于 Tauri app data 目录的版本 `4` `index.json`，记录路径、文件元数据、`favorite`、`addedAt`、`lastRecordedAt`、标签和可选分组引用；分组表与有限的索引撤销日志同样只保存元数据，不复制文件内容。v1/v2/v3 索引迁移会保留用户字段并为新字段补空值，重复 ID/路径按稳定顺序合并。每次索引变更携带单调 revision，刷新请求不会用旧响应覆盖新状态。
- 索引损坏、未知版本或迁移写入失败时会先保留备份并进入可操作恢复状态；主窗口提供诊断导出和重建空索引入口。设置损坏时会备份原文件、修复为安全默认值并显示明确提示。
- 设置保存于同一 Tauri app data 目录的版本 `2` `settings.json`，记录默认排序、每页数量、索引移除确认、`hideToTray` 和 `showFloatingWindow`；读取版本 `1` 时保留旧字段并原子迁移。
- 失效路径可以通过用户明确选择的同类型新文件或文件夹重新定位，不会自动移动、复制或删除原文件。
- 点击普通文件行会打开模态预览对话框；关闭对话框、切换资料、目录返回和窗口退出都会取消当前预览任务并释放资源会话。
- 纯文本和 Markdown 使用 Rust 受限读取，支持 UTF-8 BOM、UTF-8 和 GB18030 判断；Markdown 的渲染结果经过 DOMPurify 清理，原文、HTML、JS、JSON 和配置内容都按安全文本显示。
- 已接入 PNG、JPG、JPEG、WEBP、GIF、BMP 图片适配器，以及 MP4、WEBM 原生视频适配器。图片支持适应窗口、实际尺寸、缩放、旋转和尺寸信息；视频不自动播放，编码能力以当前 WebView2 为准。
- XLSX/XLS 使用 SheetJS 在可终止 Worker 中按工作表惰性读取受控资源，支持 Sheet 切换、空值、日期、数字和基础格式；Rust 先限制 Office ZIP 解压后体积和条目数量，前端最多显示 100 个 Sheet、每个 Sheet 首屏 500 行/50 列及 25,000 个单元格，公式只显示缓存值或安全文本，不执行宏、公式代码、外部链接或嵌入对象。
- DOCX 使用 Mammoth 转为 HTML 后再次清理，支持标题、段落、列表、表格和常见内嵌图片；复杂分页、字体、批注、目录和高级排版可能与原文不同。
- PDF 使用 PDF.js worker 通过 canvas 分页渲染，内置 CMap/标准字体数据并按设备像素比完成整页绘制后再显示，支持上一页/下一页和缩放；PDF 内容不作为可信 HTML 注入。
- DOC 通过受控系统探测定位 LibreOffice `soffice.exe`，使用隔离的临时用户 profile 以参数数组转换到应用临时目录中的 PDF，再交给 PDF.js 预览；输出大小、PDF 签名、超时、退出码和临时目录均受控，缺少转换器时返回明确的 `converter-missing` 状态。
- 浏览器运行时继续使用内存演示数据和 HTML 文件选择器，不触碰真实文件；浏览器中收藏和索引移除只模拟内存状态。
- 资料库视图支持收藏/取消收藏、从索引移除、按名称/类型/状态/位置/标签搜索、按添加时间/修改时间/名称/大小排序和每页 20 条分页；“最近添加”按持久化 `addedAt` 排序并限制为最近 50 条，目录视图不再使用临时 `addedAt` 排序。类型、标签、分组、收藏和失效路径可以组合筛选。
- 资料库使用语义化表格；位置可省略、展开、复制并通过受控 command 定位，分组单独显示为一列，标签显示在名称下方。行操作收进更多菜单，并将“删除原文件”放在独立危险操作分组；主索引支持多选、批量收藏/标签/分组/移除、部分成功报告、取消/超时和受控重试。
- 分组支持创建、重命名和删除；删除分组只解除资料归属，不删除索引记录或原文件。收藏、标签、分组和索引移除写入最多 50 条本地元数据撤销记录，只有当前 revision 和目标状态均匹配时才允许撤销。
- `shared/file-types.json` 是前端和 Rust 共用的类型/预览限制 manifest；`src/lib/ipcContracts.js` 和 `ipcContracts.d.ts` 负责 IPC 结构校验，`features/library` 下的 repository/controller 负责 command 与页面状态协调。
- 预览、设置、重命名、索引移除和原文件删除共用 Dialog 焦点陷阱；窄窗口将资料表切换为保留名称、类型、状态和高频操作的紧凑卡片，样式提供 reduced-motion 和深色模式策略。
- 桌面应用支持把普通文件复制到 Windows 文件剪贴板、同目录重命名和移入系统回收站；复制后用户可在资源管理器中粘贴，应用不选择目标目录、不创建副本、不修改索引。这些操作分别经过确认、Rust 端 ID 查找和路径复核，文件夹及目录临时子项不提供物理操作。
- 桌面应用支持由用户明确点击“用默认程序打开”和“在资源管理器中定位”；Rust 端只从索引按 ID 或登记文件夹 ID 加相对路径取回并重新校验当前路径，通过系统文件关联或资源管理器执行，不开放任意 shell。文件夹和目录临时子项均使用受控定位入口，失效记录不提供外部操作。
- 桌面应用启动时创建独立的 `floating-ball` 悬浮球窗口。用户可以从资源管理器把普通文件或文件夹拖到球体，Rust 端只登记路径和元数据；重复路径保留原索引 ID、收藏、添加时间和预览状态，并更新悬浮球专用的毫秒级 `lastRecordedAt`。
- 悬浮球最近面板只显示最近 5 条通过悬浮球成功记录的资料，主窗口导入不会自动进入该列表；每条记录提供收藏/取消收藏按钮，路径失效、索引移除、重命名、重新定位和原文件操作通过 `index-changed` 事件同步。
- 悬浮球使用受控的低频光标位置轮询、阈值滞回和延迟展开；用户可以拖动球体到工作区内自由位置或在 `24 DIP` 范围内贴到边缘。位置独立保存于 app data 目录的 `floating-ball.json` v1，保存的是显示器标识和逻辑坐标，不保存文件路径。
- 悬浮球悬停优化使用 `floatingBallGeometryModel` 的 `ballRect`、`panelRect`、`hostRect` 和 `workArea` 纯模型，以及单一 `floatingBallHoverController` 状态机；面板从球体到面板的交互区域连续，打开前按水平位置选择左/右，空间不足时压缩面板并保留内部滚动。
- 桌面端在启动后创建唯一的“本地资料工作台”系统托盘图标，菜单提供打开主窗口、刷新索引、打开设置、显示/隐藏悬浮窗、最近任务和真正退出入口；托盘创建失败时主窗口保持可用并显示安全错误。
- 设置面板提供“关闭窗口时隐藏到系统托盘”和“显示悬浮窗”。前者只拦截普通主窗口关闭请求，未勾选时关闭主窗口会同时退出应用并清理托盘、悬浮球和预览资源；托盘退出会绕过隐藏逻辑。后者会持久化并在运行时创建/销毁悬浮球，默认值分别为 `false` 和 `true`。
- 无装饰主窗口使用明确的标题栏拖动区域；窗口顶部拖动带和页面标题使用 Tauri `data-tauri-drag-region="deep"`，窗口控制、搜索、排序、资料列表、拖放区和模态对话框均标记为非拖动区域。
- 托盘最近任务与悬浮球共享索引 v4 的最近记录和收藏状态，最多显示 5 项；每项只携带不透明索引 ID，不在菜单或事件中暴露完整路径。
- 一级列表和文件夹内容按每页 20 条显示，文件夹浏览提供面包屑和返回上级操作。
- 设置面板支持默认排序、排序方向、每页 10/20/50 条、索引移除确认、关闭隐藏到托盘和悬浮窗可见性；预览大小/图片像素上限只读展示，物理删除确认始终开启。浏览器回退仅在当前会话应用设置。
- 已接入 `load_file_index`、`list_directory`、`reveal_directory_child`、`index_paths`、`refresh_index`、`reposition_file`、`record_floating_paths`、`get_floating_recent`、`open_main_from_floating`、`load_floating_placement`、`save_floating_placement`、`floating_window_status`、`retry_floating_ball`、`set_favorite`、`remove_index_entry`、`copy_indexed_file`、`open_indexed_file`、`reveal_indexed_file`、`rename_indexed_file`、`delete_original_file`、`set_entry_tags`、`set_entry_group`、`create_group`、`rename_group`、`delete_group`、`batch_set_favorite`、`batch_remove_index_entries`、`batch_update_tags`、`batch_set_group`、`cancel_batch_operation`、`undo_last`、`get_index_recovery`、`reset_index_recovery`、`export_index_diagnostic`、`load_settings`、`update_settings`、`set_floating_window_visible`、`show_main_window`、`tray_status`、`exit_app`、`can_preview`、`load_preview`、`dispose_preview` 和 `cancel_preview_task` 四十四个 Tauri command。

## 预览依赖与边界

- Markdown：`marked@15.0.12` 和 `dompurify@3.4.14`。
- DOCX：`mammoth@1.12.2`。
- XLSX：`xlsx@0.18.5`。
- PDF：`pdfjs-dist@4.10.38`，worker、CMap 和标准字体数据随前端构建产物打包。
- XLSX 解析运行在可终止的 Web Worker 中，主页面只接收已截断的纯字符串和数字数据；切换文件或卸载时终止 Worker。
- Rust：`encoding_rs`、`image`、`trash`、`uuid`、`windows-sys`、`zip` 和 HTTP 资源协议依赖均由 `src-tauri/Cargo.toml` 锁定。
- LibreOffice 是 DOC 的可选外部依赖。本实现只探测受控系统路径和 PATH 中的 `soffice` 可执行文件，不把转换器打进安装包；未找到时不把 DOC 标记为可预览。

统一初始限制如下：纯文本/Markdown 2 MiB，DOCX/XLSX 20 MiB，Office ZIP 解压后 100 MiB/2,000 个条目，PDF/图片 50 MiB，视频 512 MiB；图片解码尺寸超过 100 megapixels、PDF 超过 200 页或单页 canvas 超过尺寸/像素上限时拒绝。前端不能通过 options 提高这些限制。PDF 和视频资源支持 Range 请求，资源 URL 只包含随机 `previewId`，不包含原始路径。

Windows WebView2 使用 `http://preview.localhost/<previewId>` 访问受控资源协议，其他平台使用 `preview://localhost/<previewId>`；前端保留旧资源 URL 的兼容归一化，避免二进制预览因平台协议地址不一致而卡在加载状态。

预览结果协议中的资源字段由 Rust 显式序列化为前端使用的 `resourceUrl`、`mediaType`、`byteLength` 和 `supportsRange`，二进制预览适配器通过该字段读取受控资源，不依赖 Rust 默认的 snake_case 字段名。

PDF 的初始无范围请求返回完整 `200` 响应，客户端明确发起的范围请求仍按 `Content-Range` 分段返回，以兼容 PDF.js 的文件长度探测和分页读取。

预览、资料库核心功能、阶段 F 的设置和显式外部操作，以及悬浮球阶段 A-F 的实现、自动验证、Windows 11 桌面手工验收和 `v0.3.6` GitHub Release 均已完成。新计划阶段 A-I 的代码级实现、自动验证和 Windows 11/Tauri/WebView2 桌面验收已完成，并作为整体纳入 `v0.3.16` 发布；阶段 J 的用户验收和发布门禁确认已完成。不把所有格式写成无条件“已支持”，视频编码、LibreOffice 和 WebView2 Runtime 仍按各自外部依赖边界处理。

依赖审计注意事项：当前公开 `xlsx@0.18.5` 没有可用的 npm 修复版本，并存在已知 Prototype Pollution/ReDoS 报告。应用不打开宏、外部链接或 HTML，限制工作簿大小和展示范围，并在 Worker 中解析以便超时或异常时终止；在替换为有修复的兼容库前，该风险仍需纳入发布判断。

## 当前限制

- 索引仍只保存路径和元数据，预览正文、资源会话 ID 和临时 PDF 不写入 `index.json`。
- SVG、MOV、AVI、MKV 等未登记格式返回 `unsupported`；视频不提供隐藏转码。
- DOC 预览依赖本机 LibreOffice；当前构建未内置或下载 WebView2 Runtime，也未签名。
- 当前不提供全文检索、批量物理复制/重命名/删除或跨任意历史的通用撤销栈；阶段 G-I 的位置搜索、标签/分组、批量索引操作和有限撤销已随 `0.3.16` 发布。阶段 F 的原始数据模型、影响范围和失败恢复决策记录在 `docs/phase-f-settings-and-external-operations.md`。
- 悬浮球透明置顶窗口、资源管理器真实拖放、位置恢复以及本轮新增的悬停状态机、四边四角几何、跨 DPI 和组合交互均已由用户在 Windows 11 桌面端验收通过；浏览器回退只展示内存演示状态。
- 浏览器回退不会执行真实文件剪贴板、重命名、原文件删除或外部打开/定位；桌面端复制到剪贴板、资源管理器粘贴、设置持久化和显式外部操作已由用户在 Windows 环境完成手工验收。
- 解析失败、缺失、权限不足、过大、转换器缺失和暂不支持均保留索引并在模态对话框显示可执行的下一步。
- 已使用 Windows GNU 工具链构建 x64 NSIS 安装包；安装器签名、WebView2 Runtime 提供方式和 LibreOffice 仍属于发布边界说明。

## 验证

```powershell
npm.cmd run build
npm.cmd run test:library
npm.cmd run test:contracts
npm.cmd run test:settings
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

`npm.cmd run build` 会生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。浏览器/Sites 模式不会调用真实文件预览、托盘或窗口 command；上一版 Windows 桌面预览、资料库操作、阶段 F、悬浮球基础能力和阶段 H 验收记录在根目录 `PROJECT_PROGRESS.md`，当前新计划阶段 A-I 的代码级验证、阶段 J 发布验收和 Windows 11/Tauri/WebView2 桌面验收已完成，并作为整体纳入 `0.3.16`。

悬浮球阶段的自动验证使用 `npm.cmd run test:floating-ball`、`cargo test`、`cargo check` 和 `cargo clippy`；真实 Windows 窗口、文件拖放、多显示器位置和关闭/重启行为的验收记录均保留，本轮悬停面板优化的四边四角、DPI 和组合行为已由用户完成手工确认，代理不以浏览器页面或开发侧命令结果替代该验收。
