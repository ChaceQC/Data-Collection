# 本地资料工作台

面向 Windows 11 的本地资料收纳、检索与预览桌面应用。项目采用 Tauri 2 构建，文件与索引默认留在本机，支持悬浮球、系统托盘以及常见文档格式的只读预览。

## 项目简介

本地资料工作台用于把分散在电脑中的文件和文件夹集中登记，提供统一的检索、排序、收藏、目录浏览和预览入口。应用遵循 local-first 原则：导入资料时默认只保存路径和文件元数据，不复制原文件，不上传用户内容，也不依赖后端服务或在线账号。

当前版本为 `0.3.6`，已完成悬浮球悬停状态机、工作区几何、边缘方向回退、面板命中和多显示器/DPI 优化；用户已确认 Windows 11 桌面端全部验收场景通过，`v0.3.6` 已正式发布。项目源码位于 [`prototype/`](prototype/)，根目录的计划和进度记录分别见 [`PROJECT_PLAN.md`](PROJECT_PLAN.md) 与 [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md)。

当前开发分支已实现新计划阶段 A-I 的代码和阶段级自动验证，包括登记路径授权、索引 revision 刷新、索引恢复、文件操作待同步记录、可取消预览、共享 IPC 契约、语义资料表、位置搜索、标签/分组、批量索引操作和有限撤销；这些改动尚未提升正式版本，也未替代对应的 Windows 11 手工验收。

## 功能概览

- 通过文件选择器、文件夹选择器或桌面端拖放登记文件和文件夹。
- 保存路径、显示名、类型、大小、修改时间、收藏状态、标签、分组和预览状态等索引信息。
- 按名称、类型、状态、位置和标签搜索，按添加时间、修改时间、名称或大小排序，并支持分页；类型、标签、分组、收藏和失效路径可以组合筛选。
- 浏览已登记的文件夹和子目录；失效路径可以由用户选择同类型的新路径重新定位。
- 目录浏览和预览只接受已登记文件夹 ID 及受控相对路径片段，不接受前端传入的任意本地路径。
- 支持文本、Markdown、图片、视频、XLS/XLSX、DOCX、PDF 和 DOC 的受控只读预览。
- 索引刷新使用 revision 事件合并旧响应；索引损坏会保留备份并提供诊断导出和重建空索引入口，设置损坏会提示已使用默认值。
- 提供悬浮球和系统托盘，悬浮球可记录最近拖入的资料，托盘和主窗口共享最近记录与收藏状态。
- 悬浮球面板使用统一的悬停状态机和工作区几何模型，覆盖球体到面板的连续命中、按水平位置向左/右展开、面板内部滚动和键盘收起。
- 在桌面端提供明确触发的复制、重命名、回收站删除、默认程序打开和资源管理器定位操作，并在执行前进行必要确认。
- 提供默认排序、分页数量、关闭时隐藏到托盘和悬浮窗可见性等设置；未启用关闭隐藏时，关闭主窗口会退出应用并清理托盘与悬浮球。
- 桌面端刷新入口会保留当前选择、目录面包屑、页码和滚动位置；关闭或切换预览时会取消未完成的 DOC、XLSX、PDF 和媒体任务。
- 资料库使用语义化表格，分组单独显示为一列，位置可省略、展开和复制；行操作通过更多菜单分组，支持多选和批量收藏、标签、分组及索引移除。重命名会在输入框内显示非法字符、扩展名、冲突和空值原因，预览/设置/确认窗口共享键盘焦点管理。
- 文件类型和预览限制由 `prototype/shared/file-types.json` 统一提供，前端 IPC/API 通过运行时契约校验；窄窗口会切换为保留名称、类型、状态和高频操作的紧凑列表。

## 使用者说明

### 运行条件

- Windows 11。
- 已安装 Microsoft WebView2 Runtime；当前安装包不内置 WebView2 安装程序。
- 预览 `.doc` 文件时需要本机安装 LibreOffice；其他已接入格式不依赖 LibreOffice。

### 基本使用流程

1. 启动“本地资料工作台”，使用导入入口选择文件或文件夹。
2. 也可以在桌面端把文件或文件夹拖到悬浮球，资料会登记到索引并出现在悬浮球最近列表中。
3. 在资料库中搜索、排序、分页或收藏资料；点击文件可以打开预览，点击文件夹可以进入目录。
4. 通过预览窗口查看内容。关闭预览、切换资料或退出应用时，当前预览会话会被释放。
5. 需要对原文件进行操作时，使用文件行中的明确操作入口。复制、重命名和移入回收站等操作不会由导入流程自动执行。
6. 在设置中调整排序方式、每页数量、关闭窗口行为和悬浮窗显示状态。

### 支持格式与限制

| 类型 | 格式 | 说明 |
| --- | --- | --- |
| 文本与 Markdown | `.txt`、`.md` | 只读查看，支持 UTF-8 BOM、UTF-8 和常见中文 Windows 编码判断；Markdown 渲染结果会经过安全清理。 |
| 图片 | `.png`、`.jpg`、`.jpeg`、`.webp`、`.gif`、`.bmp` | 支持适应窗口、实际尺寸、缩放、旋转和尺寸信息。 |
| 视频 | `.mp4`、`.webm` | 不自动播放，具体编码能力取决于 Windows WebView2。 |
| 工作簿 | `.xlsx`、`.xls` | 支持切换工作表和基础表格查看；不执行宏、公式代码、外部链接或嵌入对象。 |
| Word 文档 | `.docx` | 支持标题、段落、列表、表格和常见内嵌图片；复杂排版可能与原文不同。 |
| PDF | `.pdf` | 使用 PDF.js 分页和缩放，包含字体/CMap 资源和整页绘制保护；内容不会作为可信 HTML 执行。 |
| 旧版 Word 文档 | `.doc` | 通过本机 LibreOffice 转换为临时 PDF 后预览；缺少转换器时无法预览。 |

导入和预览都设置了大小、读取范围和图片解码尺寸限制。SVG、MOV、AVI、MKV 等未登记格式会显示为暂不支持。当前版本仍不提供云同步、在线账号、全文检索或批量物理复制/重命名/删除；阶段 G-I 的位置、标签/分组、批量索引操作和有限撤销已在开发分支实现，待版本门禁和 Windows 11 手工验收后再发布。

### 数据与隐私

应用设置、资料索引和悬浮球位置保存在 Tauri 的本地应用数据目录中，不写入项目目录，也不默认保存完整文档内容。导入资料不会自动复制、移动或删除原文件；所有物理文件操作都必须由用户明确触发。浏览器回退模式只用于演示界面和内存状态，不能代替桌面端的真实文件、托盘和窗口能力。

## 开发者说明

### 技术栈

- 桌面框架：Tauri 2。
- 前端：React 19、Vite 6、JavaScript/JSX。
- 原生层：Rust stable。
- 预览依赖：Marked、DOMPurify、Mammoth、SheetJS、PDF.js，以及 Rust 侧用于 Office 容器边界检查的 zip。
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

发布流程由 [`release.yml`](.github/workflows/release.yml) 管理。将与项目版本一致的 `vX.Y.Z` 标签推送到 GitHub 后，Action 会在 Windows 2022 runner 上执行依赖安装、Tauri 构建和版本校验，并自动创建或更新对应的 GitHub Release：

```powershell
git tag v0.3.6
git push origin v0.3.6
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
    features/floating-ball/
                       # 悬浮球与最近资料
  src-tauri/
    src/commands/      # Tauri command 入口
    src/filesystem/    # 路径校验和文件系统操作
    src/preview/       # 预览适配器和受控资源协议
    src/storage/       # 本地索引、设置和位置存储
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
- 版本号在前端 package、Tauri 配置和 Rust crate 入口保持一致，当前发布版本为 `0.3.6`；用户 Windows 11 手工验收已全部通过。

## 参考文档

- [`prototype/README.md`](prototype/README.md)：原型目录内的详细功能、预览依赖和桌面验收说明。
- [`PROJECT_PLAN.md`](PROJECT_PLAN.md)：项目阶段计划和完成条件。
- [`PROJECT_PROGRESS.md`](PROJECT_PROGRESS.md)：已完成事项、验证结果、风险和下一步记录。
- [`docs/phase-f-settings-and-external-operations.md`](docs/phase-f-settings-and-external-operations.md)：设置、外部文件操作和失败恢复边界。
- [`AGENT.md`](AGENT.md)：项目开发协作约束。
