# 本地资料工作台原型

这是基于 `AGENT.md` 方案 3“收纳入口”实现的本地资料工作台。当前版本包含 Tauri 2 桌面外壳、真实文件索引和统一预览适配器；浏览器运行时仍保留原型回退，用于 Sites 构建和界面验收。

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

安装包输出到 `src-tauri/target/release/bundle/nsis/`。当前安装模式为当前用户安装，构建配置不打包 WebView2 安装程序；Windows 11 目标机需要已有 WebView2 Runtime。

## 当前范围

- Tauri 运行时通过原生选择器和桌面拖放获取真实路径，由 Rust 校验并登记文件名、类型、大小和修改时间。
- 导入文件夹会登记为一条文件夹记录，不在一级列表展开其中的文件；点击文件夹后按需读取直接子项并支持进入子目录。不跟随符号链接或 Windows reparse point，单次读取最多 20,000 项。
- 索引保存于 Tauri app data 目录的版本 `2` `index.json`，记录路径、文件元数据、`favorite` 和 `addedAt`，不复制文件内容；重复导入会更新元数据并保留已有收藏和添加时间。
- 设置保存于同一 Tauri app data 目录的版本 `1` `settings.json`，记录默认排序、每页数量和索引移除确认偏好；设置与索引分开原子写入，损坏设置回退安全默认值且不会清空索引。
- 失效路径可以通过用户明确选择的同类型新文件或文件夹重新定位，不会自动移动、复制或删除原文件。
- 点击普通文件行会打开模态预览对话框；关闭对话框、切换资料、目录返回和窗口退出都会释放当前预览会话。
- 纯文本和 Markdown 使用 Rust 受限读取，支持 UTF-8 BOM、UTF-8 和 GB18030 判断；Markdown 的渲染结果经过 DOMPurify 清理，原文、HTML、JS、JSON 和配置内容都按安全文本显示。
- 已接入 PNG、JPG、JPEG、WEBP、GIF、BMP 图片适配器，以及 MP4、WEBM 原生视频适配器。图片支持适应窗口、实际尺寸、缩放、旋转和尺寸信息；视频不自动播放，编码能力以当前 WebView2 为准。
- XLSX/XLS 使用 SheetJS 读取受控资源，支持 Sheet 切换、空值、日期、数字和基础格式；最多显示 100 个 Sheet、每个 Sheet 首屏 500 行/50 列，公式只显示缓存值或安全文本，不执行宏、公式代码、外部链接或嵌入对象。
- DOCX 使用 Mammoth 转为 HTML 后再次清理，支持标题、段落、列表、表格和常见内嵌图片；复杂分页、字体、批注、目录和高级排版可能与原文不同。
- PDF 使用 PDF.js worker 通过 canvas 分页渲染，支持上一页/下一页和缩放；PDF 内容不作为可信 HTML 注入。
- DOC 通过受控系统探测定位 LibreOffice `soffice.exe`，以参数数组转换到应用临时目录中的 PDF，再交给 PDF.js 预览；缺少转换器时返回明确的 `converter-missing` 状态。
- 浏览器运行时继续使用内存演示数据和 HTML 文件选择器，不触碰真实文件；浏览器中收藏和索引移除只模拟内存状态。
- 资料库视图支持收藏/取消收藏、从索引移除、按名称/类型/状态搜索、按添加时间/修改时间/名称/大小排序和每页 20 条分页；最近添加使用持久化 `addedAt`。
- 桌面应用支持把普通文件复制到 Windows 文件剪贴板、同目录重命名和移入系统回收站；复制后用户可在资源管理器中粘贴，应用不选择目标目录、不创建副本、不修改索引。这些操作分别经过确认、Rust 端 ID 查找和路径复核，文件夹及目录临时子项不提供物理操作。
- 桌面应用支持由用户明确点击“用默认程序打开”和“在资源管理器中定位”；Rust 端只从索引按 ID 取回并重新校验当前路径，通过系统文件关联或资源管理器执行，不开放任意 shell。文件夹只提供资源管理器定位，失效记录和目录临时子项不提供外部操作。
- 一级列表和文件夹内容按每页 20 条显示，文件夹浏览提供面包屑和返回上级操作。
- 设置面板支持默认排序、排序方向、每页 10/20/50 条和索引移除确认；预览大小/图片像素上限只读展示，物理删除确认始终开启。浏览器回退仅在当前会话应用设置。
- 已接入 `load_file_index`、`list_directory`、`index_paths`、`reposition_file`、`set_favorite`、`remove_index_entry`、`copy_indexed_file`、`open_indexed_file`、`reveal_indexed_file`、`rename_indexed_file`、`delete_original_file`、`load_settings`、`update_settings`、`can_preview`、`load_preview` 和 `dispose_preview` 十六个 Tauri command。

## 预览依赖与边界

- Markdown：`marked@15.0.12` 和 `dompurify@3.4.14`。
- DOCX：`mammoth@1.12.2`。
- XLSX：`xlsx@0.18.5`。
- PDF：`pdfjs-dist@4.10.38`，worker 随前端构建产物打包。
- XLSX 解析运行在可终止的 Web Worker 中，主页面只接收已截断的纯字符串和数字数据；切换文件或卸载时终止 Worker。
- Rust：`encoding_rs`、`image`、`trash`、`uuid`、`windows-sys` 和 HTTP 资源协议依赖均由 `src-tauri/Cargo.toml` 锁定。
- LibreOffice 是 DOC 的可选外部依赖。本实现只探测受控系统路径和 PATH 中的 `soffice` 可执行文件，不把转换器打进安装包；未找到时不把 DOC 标记为可预览。

统一初始限制如下：纯文本/Markdown 2 MiB，DOCX/XLSX 20 MiB，PDF/图片 50 MiB，视频 512 MiB；图片解码尺寸超过 100 megapixels 时拒绝。前端不能通过 options 提高这些限制。PDF 和视频资源支持 Range 请求，资源 URL 只包含随机 `previewId`，不包含原始路径。

Windows WebView2 使用 `http://preview.localhost/<previewId>` 访问受控资源协议，其他平台使用 `preview://localhost/<previewId>`；前端保留旧资源 URL 的兼容归一化，避免二进制预览因平台协议地址不一致而卡在加载状态。

预览结果协议中的资源字段由 Rust 显式序列化为前端使用的 `resourceUrl`、`mediaType`、`byteLength` 和 `supportsRange`，二进制预览适配器通过该字段读取受控资源，不依赖 Rust 默认的 snake_case 字段名。

PDF 的初始无范围请求返回完整 `200` 响应，客户端明确发起的范围请求仍按 `Content-Range` 分段返回，以兼容 PDF.js 的文件长度探测和分页读取。

预览、资料库核心功能以及阶段 F 的设置和显式外部操作已完成代码接入、开发侧检查，并已由用户完成 Windows 11/WebView2 桌面验收；版本当前仍维持 `0.1.0`，等待统一的发布版本判断。不把所有格式写成无条件“已支持”，视频编码和 LibreOffice 仍按各自外部依赖边界处理。

依赖审计注意事项：当前公开 `xlsx@0.18.5` 没有可用的 npm 修复版本，并存在已知 Prototype Pollution/ReDoS 报告。应用不打开宏、外部链接或 HTML，限制工作簿大小和展示范围，并在 Worker 中解析以便超时或异常时终止；在替换为有修复的兼容库前，该风险仍需纳入发布判断。

## 当前限制

- 索引仍只保存路径和元数据，预览正文、资源会话 ID 和临时 PDF 不写入 `index.json`。
- SVG、MOV、AVI、MKV 等未登记格式返回 `unsupported`；视频不提供隐藏转码。
- DOC 预览依赖本机 LibreOffice；当前构建未内置或下载 WebView2 Runtime，也未签名。
- 标签/分组、全文检索、批量操作和通用撤销栈尚未实现；阶段 F 的数据模型、影响范围和失败恢复决策记录在 `docs/phase-f-settings-and-external-operations.md`。
- 浏览器回退不会执行真实文件剪贴板、重命名、原文件删除或外部打开/定位；桌面端复制到剪贴板、资源管理器粘贴、设置持久化和显式外部操作已由用户在 Windows 环境完成手工验收。
- 解析失败、缺失、权限不足、过大、转换器缺失和暂不支持均保留索引并在模态对话框显示可执行的下一步。
- 已使用 Windows GNU 工具链构建 x64 NSIS 安装包；安装器签名、WebView2 Runtime 提供方式和 LibreOffice 仍属于发布边界说明。

## 验证

```powershell
npm.cmd run build
npm.cmd run test:library
npm.cmd run test:settings
npm.cmd run test:preview
npm.cmd run test:sites
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

`npm.cmd run build` 会生成 Sites 所需的 `dist/client/index.html`、`dist/server/index.js` 和 `dist/.openai/hosting.json`。浏览器/Sites 模式不会调用真实文件预览 command；Windows 桌面预览、资料库操作和阶段 F 已使用无敏感夹具完成用户手工验收，具体通过项记录在根目录 `PROJECT_PROGRESS.md`。
