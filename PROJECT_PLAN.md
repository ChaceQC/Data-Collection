# 本地资料工作台 0.3.0 桌面生命周期与发布优化实施计划

> 计划目标版本：`0.3.0`
> 当前应用版本：`0.3.0`（阶段 H 发布门槛已通过）
> 当前阶段：阶段 A-G 实现、Windows 11 手工验收和阶段 H 发布验证已完成
> 计划状态：`0.3.0` 已完成，保留外部依赖和维护风险说明
> 旧计划处理：旧版 `PROJECT_PLAN.md` 内容已移除并由本文件替换；已检查根目录，未发现需要并行维护的独立 `PLAN.md`

## 1. 计划变更与执行目标

### 1.1 本轮范围

本计划承接 `0.2.0` 已完成的资料库、预览、设置和悬浮球能力，只处理以下六项桌面优化：

1. 增加 Windows 系统托盘图标和托盘菜单。
2. 在设置中增加“关闭窗口时隐藏到系统托盘”选项。
3. 在设置中增加“显示悬浮窗”选项，并支持运行时开关和重启恢复。
4. 让无装饰的主窗口拥有明确、稳定、可访问的拖动区域。
5. 发布 Windows 安装包时明确包含与目标架构匹配的 `WebView2Loader.dll`。
6. 在托盘任务列表中为每个任务增加“收藏/取消收藏”操作，并与主窗口、悬浮窗保持一致。

本轮已按本计划落地代码、自动验证和文档同步；`0.2.8` 是在 `0.2.7` 基础上的主窗口拖动修复检查点，随后已完成阶段 H 的 Windows 11 桌面验收、安装后目录检查和 `0.3.0` 发布构建。

### 1.2 当前真实基线

- `prototype/` 是 React 19、Vite 6、Tauri 2.11 系列原型，目标平台为 Windows 11。
- 当前应用、前端包、Tauri 配置和 Rust crate 版本均为 `0.3.0`。
- 主窗口标签为 `main`，使用无原生装饰窗口；窗口顶部拖动带和页面标题使用 Tauri `data-tauri-drag-region="deep"`，窗口控制、拖放区、资料列表和模态内容标记为非拖动区域，用户已完成真实 Windows 拖动验收。
- 悬浮窗标签为 `floating-ball`，已经支持文件拖入、最近 5 条、靠近展开、移动贴边和位置恢复；`showFloatingWindow` 现在决定启动时是否创建，并可在运行时幂等销毁/重建。
- 设置文件位于 Tauri `app_data_dir/settings.json`，当前格式版本为 `2`，保存默认排序、分页数量、索引移除确认、关闭隐藏到托盘和悬浮窗可见性。
- 资料索引位于 `app_data_dir/index.json`，格式版本为 `3`，已有 `favorite`、`addedAt` 和可为空的 `lastRecordedAt` 字段；托盘收藏必须复用现有索引字段，不新增第二套收藏数据。
- `set_favorite`、`get_floating_recent`、`open_main_from_floating` 等能力已由原生托盘菜单统一编排，托盘任务动作只传递不透明索引 ID。
- `prototype/src-tauri/target/release/WebView2Loader.dll` 会在当前构建过程中出现，但它属于构建产物，不应把 `target/` 当作发布配置；阶段 H 已验证 NSIS 安装后的应用目录确实含有该 DLL。
- 当前 `tauri.conf.json` 使用 NSIS 当前用户安装模式，`webviewInstallMode` 为 `skip`。本轮只要求打包 WebView2 loader，不把 WebView2 Runtime 安装器或运行时下载逻辑偷偷扩大到本计划。
- 浏览器/Sites 回退模式不能创建系统托盘、读取真实本地路径或调用桌面窗口 command；回退模式只保留可测试的界面状态。loader 校验脚本只读取构建输出或用户明确提供的安装目录。

### 1.3 总体成功标准

`0.3.0` 发布前，Windows 11 桌面应用必须满足：

- 应用启动后创建唯一托盘图标，托盘图标有产品名称提示，不因重试、窗口重建或多次事件而产生重复图标。
- 托盘菜单可以打开主窗口、显示或隐藏悬浮窗、进入设置、查看最近任务并退出应用；退出菜单是明确的真正退出入口。
- 当“关闭窗口时隐藏到系统托盘”为关闭时，点击主窗口关闭按钮或收到系统关闭请求只隐藏主窗口，进程、托盘和按设置决定的悬浮窗继续运行；用户可从托盘重新打开主窗口。
- 当该选项开启时，托盘退出动作仍能绕过隐藏逻辑并干净退出，不能出现只能结束进程或只能强制关闭的情况。
- “显示悬浮窗”设置默认保持 `0.2.0` 行为为开启；关闭后悬浮窗不显示、不接收拖放和靠近检测，开启后可以在不重启应用的情况下恢复。
- 设置修改经过重启仍保持；设置文件从 v1 迁移到 v2 时旧设置不丢失，损坏或迁移失败不清空资料索引。
- 主窗口的标题栏拖动区域可以移动窗口；按钮、输入框、下拉框、资料列表和文本选择区域不会被误判为拖动。
- 托盘“最近任务”与悬浮窗最近列表使用同一份 Rust 索引状态，最多显示约定数量的最近任务，不向菜单文本或日志写入完整路径。
- 每个托盘任务都有明确的“收藏”或“取消收藏”菜单项；操作成功后主窗口收藏筛选、悬浮窗/托盘标记和重启后的索引状态一致。
- 发布后的安装目录在目标架构下包含 `WebView2Loader.dll`，安装、首次启动、升级安装、卸载和再次安装均通过检查；缺少 WebView2 Runtime 的边界仍按 README 如实说明。
- 现有资料库、预览、主窗口导入、悬浮球记录、位置恢复、浏览器/Sites 构建和原文件安全边界不回归。

### 1.4 明确不纳入本轮

- 不实现开机自启、后台服务、全局快捷键、全局鼠标钩子、通知中心或云端同步。
- 不把“隐藏到托盘”解释为强制开机常驻；是否开机启动仍留在后续独立计划。
- 不把 WebView2 Runtime 安装器、离线 Runtime 或浏览器升级服务打进本轮安装包。
- 不新增全文检索、标签/分组、批量物理文件操作、完整悬浮窗历史或新的预览格式。
- 不复制、移动、重命名或删除用户原文件；托盘收藏只改变索引元数据。

## 2. 产品行为约定

### 2.1 系统托盘生命周期

- 托盘仅在 Tauri 桌面运行时创建，浏览器/Sites 模式不显示模拟托盘，也不调用不存在的桌面 API。
- 托盘图标在 `setup` 中创建，必须在设置和资料索引初始化成功后再绑定动态任务列表；托盘创建失败时主窗口仍可启动，并显示可执行错误。
- 托盘图标只允许存在一个固定 ID，例如 `main-tray`。重试创建时先查找并复用现有图标，不能叠加第二个图标。
- 左键单击托盘图标默认显示并聚焦主窗口；双击不执行第二套隐藏/退出语义，避免不同 Windows Shell 行为造成不一致。
- 右键打开原生菜单。菜单的静态项顺序固定，动态任务项在“最近任务”子菜单中更新。
- 菜单至少包含：
  - `打开主窗口`
  - `显示悬浮窗` 或 `隐藏悬浮窗`，其勾选状态与持久化设置和实际窗口状态一致
  - `最近任务` 子菜单
  - `打开设置`
  - `退出`
- `退出`必须设置内部 `is_exiting` 标志，先停止靠近检测、关闭悬浮窗和预览资源，再允许主窗口销毁；关闭事件不能把显式退出再次转成隐藏到托盘。
- 托盘事件处理只接受内部菜单 ID，不接受前端传入的任意路径、命令行或脚本；所有文件操作通过索引 ID 重新查询并校验。
- 托盘图标、菜单句柄和动态子菜单的销毁必须在应用退出时完成；退出后不得遗留监控线程、事件监听或临时菜单对象。

### 2.2 隐藏到托盘设置

设置界面使用清晰的用户文案“关闭窗口时隐藏到系统托盘”，内部字段命名为 `hideToTray`。该字段只控制主窗口关闭请求，不改变普通最小化行为。

- 默认值为 `false`，保持 `0.2.0` 的关闭即退出行为，避免升级后用户突然无法退出应用。
- `hideToTray=false`：
  - 点击自定义关闭按钮、系统关闭按钮或收到 `CloseRequested` 时执行正常退出流程。
  - 托盘仍可用于打开主窗口和执行显式退出，但不保留隐藏进程。
- `hideToTray=true`：
  - 普通关闭请求调用 `prevent_close` 或等价拦截，然后隐藏主窗口并保留托盘。
  - 已打开的悬浮窗按 `showFloatingWindow` 继续保持或隐藏，不因主窗口关闭而强制销毁。
  - 从托盘打开主窗口时恢复、聚焦并置前，不创建第二个主窗口。
- 托盘菜单的“退出”使用独立的受控退出路径，必须在 `is_exiting=true` 后再关闭主窗口，绕过隐藏逻辑。
- 托盘创建失败时不能把 `hideToTray=true` 伪装成可用。应用应保留主窗口可见或在关闭前显示“托盘不可用，无法安全隐藏”的提示，并记录不含路径的错误。
- 设置保存成功和运行时应用成功必须分开处理。若文件写入成功但运行时状态变更失败，应显示警告、保留用户选择并提供重试，不得显示“已完成”。

### 2.3 显示悬浮窗设置

设置界面使用“显示悬浮窗”复选框，内部字段命名为 `showFloatingWindow`。

- 默认值为 `true`，保持当前 `0.2.0` 的悬浮球行为。
- 从 `true` 改为 `false`：
  - 停止靠近检测线程和悬浮窗事件监听。
  - 隐藏或销毁 `floating-ball` 窗口，具体方式以 Tauri 生命周期验证结果为准；必须确保它不在任务栏、不会接收文件拖放，也不会继续写位置。
  - 托盘菜单改为“显示悬浮窗”，主窗口和托盘任务列表仍然可用。
- 从 `false` 改为 `true`：
  - 使用现有 `create_floating_ball` 和位置恢复逻辑创建或显示窗口。
  - 若窗口创建失败，设置值仍反映用户意图，但返回 `available=false` 和可读错误，托盘和主窗口提供“重试”路径。
  - 成功后重新启动靠近检测并加载最近列表，不重复创建窗口。
- 应用重启时先读取设置，再决定是否创建悬浮窗。设置关闭时不能短暂闪现悬浮球。
- `hideToTray=true` 且 `showFloatingWindow=false` 的组合必须可用；此时托盘是唯一常驻入口，菜单必须仍能打开主窗口和退出。
- 浏览器模式可以用内存布尔值演示设置切换，但必须明确标注“仅当前浏览器会话有效”，不能声称影响系统窗口。

### 2.4 主窗口拖动

- 主窗口继续使用无装饰配置，但必须有一个语义明确的标题栏/拖动带，而不是依赖整个页面的隐式鼠标事件。
- 标题栏拖动区域至少覆盖品牌和页面标题的空白区域；窗口控制按钮、设置入口、搜索框、下拉框、资料行、链接和可选中文本区域必须标记为 `data-tauri-drag-region="false"` 或使用等价排除策略。
- 使用 Tauri 2 的 `data-tauri-drag-region="deep"` 官方机制覆盖窗口顶部拖动带和页面标题；只有在当前 WebView2 版本下无法稳定识别时，才再在主窗口 feature 中使用 `getCurrentWindow().startDragging()` 的指针封装。
- 拖动开始前不能阻止按钮点击、文本选择、键盘焦点或资料拖放；拖动阈值和指针捕获必须集中在窗口交互模块。
- 拖动过程中主窗口不能改变大小、触发最大化或误关闭；双击行为是否最大化必须与现有窗口控件约定一致，并单独验收。
- 需要为高 DPI、负坐标多显示器、窗口最大化后恢复和窄窗口布局保留可见标题、控制按钮和焦点状态。

### 2.5 托盘任务列表与收藏

托盘任务列表以现有索引为唯一事实来源，默认展示最近通过悬浮球记录的任务，最多 5 项，与 `get_floating_recent` 的排序和去重规则一致。

- 每项只使用 `id`、名称、类型、失效状态、收藏状态和记录时间构造菜单，不把完整路径放入菜单、事件 payload 或普通日志。
- 文件名中的换行、制表符、控制字符和过长文本必须清理/截断，菜单 ID 使用不透明稳定 ID，例如 `tray-task-open:<id>` 和 `tray-task-favorite:<id>`。
- 每个任务使用子菜单或等价的两个明确菜单动作：
  - `打开任务`
  - `收藏` 或 `取消收藏`
- 点击“打开任务”复用 `open_main_from_floating` 或同等共享服务：唤起主窗口、按 ID 定位资料，失效路径只显示重新定位提示。
- 点击“收藏/取消收藏”复用现有 `set_favorite` 的存储逻辑，禁止在托盘模块复制索引写入代码。
- 收藏成功后必须：
  - 原子写入 `index.json`；
  - 更新主窗口收藏计数和筛选结果；
  - 重新构建托盘任务菜单，使文字和动作立刻反映新状态；
  - 发送已有 `index-changed` 或新增的 `favorite-changed` 事件给悬浮窗，避免显示旧状态。
- 任务已被主窗口移除、物理删除、重命名或重新定位时，托盘下一次打开菜单必须重新取索引快照；不能保留幽灵菜单项。
- 任务列表为空、索引读取失败、某项失效或任务数量超过 5 时都要有明确的禁用/提示项，不伪造可点击任务。
- 托盘菜单动态刷新要有去抖和句柄替换策略，避免每次收藏点击都叠加旧菜单、泄漏事件闭包或造成菜单打开时崩溃。

### 2.6 `WebView2Loader.dll` 发布语义

- `WebView2Loader.dll` 是 WebView2 加载器，不等于 WebView2 Runtime。安装包必须包含 loader，但本轮不承诺离线提供 Runtime。
- 构建时必须按目标架构选择 DLL。当前发布目标为 Windows x64；若未来增加 x86 或 arm64，必须为每个 target 使用独立资源并拒绝错架构文件。
- 不把 `target/` 中的偶然构建产物视为发布配置。应采用以下受控路径之一，并在实现阶段以实际 Tauri bundler 行为验证：
  - 从已锁定的 `webview2-com-sys` 构建输出复制到明确的 staging 目录，再由 `bundle.resources`/NSIS 配置打包；
  - 或确认 Tauri 已自动把同一架构 loader 放在应用可执行文件旁，仅补充构建断言和安装包检查，不再重复放置第二份 DLL。
- 若使用构建脚本，脚本必须：
  - 只读取项目依赖输出或明确配置的 SDK 目录；
  - 检查文件存在、大小大于零、目标架构和 SHA-256；
  - 在找不到或架构不匹配时让发布构建失败；
  - 不从网络下载未审计的 DLL，不把密钥或完整本机路径写入普通日志。
- NSIS 安装后的最终检查点是“应用主 exe 同目录存在 `WebView2Loader.dll`”，不能只检查 `target/release` 或临时资源目录。
- README 必须同时说明 loader 已随安装包提供、WebView2 Runtime 仍按当前 `skip` 策略依赖目标机已有安装，避免用户误解。

### 2.7 隐私、安全和数据边界

- 托盘菜单可以显示用户主动登记的文件名，但不显示完整路径、文件内容、访问令牌或系统用户名。
- 菜单事件只携带索引 ID；Rust 端重新从 `AppState` 查找记录并执行路径校验。
- 不向托盘模块开放任意文件系统、shell、命令行或外部 URL 权限。
- 设置和索引继续使用临时文件加原子替换；托盘刷新失败不能回滚已经成功的收藏写入。
- 所有错误文案限制长度，不包含内部堆栈、临时目录、命令参数和密钥。

## 3. 技术架构与契约

### 3.1 目标数据流

```text
Windows Shell
    |
    +--> 托盘图标/原生菜单
    |       |
    |       +--> 打开主窗口 / 设置 / 显示悬浮窗
    |       +--> 最近任务 -> 打开任务 / 收藏
    |
    +--> 主窗口关闭请求
            |
            v
      lifecycle controller
        |             |
        |             +--> hideToTray=true: hide main, keep tray
        |             +--> explicit exit: close all and exit
        |
        +--> SettingsState v2
        +--> FloatingBallState
        +--> AppState/index.json v3
        +--> WebView2Loader.dll release gate
```

调用方向保持为：

```text
React 主窗口/设置
  -> typed settings/window API
  -> Tauri command or window event
  -> Rust lifecycle/tray/storage service
  -> app state, windows, index.json or native menu
```

托盘原生事件可以直接调用共享 Rust service，但不能另写一套收藏、路径校验或窗口退出逻辑。所有入口最终都汇聚到同一套 service。

### 3.2 设置格式 v2

当前设置格式从 `1` 提升为 `2`，示例文档结构如下：

```json
{
  "version": 2,
  "settings": {
    "defaultSort": {
      "key": "addedAt",
      "direction": "desc"
    },
    "pageSize": 20,
    "confirmBeforeRemove": true,
    "hideToTray": false,
    "showFloatingWindow": true
  }
}
```

实现要求：

- Rust `PersistedSettings`、`SettingsUpdate`、`AppSettings` 和前端 `DEFAULT_SETTINGS`/`normalizeSettings` 同步增加两个布尔字段。
- 读取 v1 时保留 `defaultSort`、`pageSize` 和 `confirmBeforeRemove`，补入 `hideToTray=false`、`showFloatingWindow=true`，再以原子方式迁移为 v2。
- 迁移写入失败时保留可恢复的旧文件和内存快照，不能写出半个 v2 文档或清空设置。
- 文件损坏、未知版本、字段不是布尔值或现有字段非法时，使用安全默认值；不得把错误设置传播为“托盘可用”。
- `previewLimits` 仍为只读派生值，不写入持久化设置。
- 前端设置保存必须把两个新字段传入 `update_settings`，浏览器回退只更新会话内状态。
- 未来如增加启动项或通知偏好，不在本轮擅自复用这两个字段。

### 3.3 托盘和窗口服务边界

建议新增或拆分以下职责，实际文件名可依现有目录风格微调，但职责不得重新合并到单个大函数：

| 服务/模块 | 责任 | 不负责 |
| --- | --- | --- |
| `windows/tray.rs` | 创建托盘、构造静态/动态菜单、分发菜单 ID、刷新任务列表、处理托盘点击 | 直接解析路径、复制收藏写入逻辑 |
| `windows/lifecycle.rs` | 关闭请求、隐藏/显示主窗口、显式退出、`is_exiting` 和窗口清理 | 资料索引排序和菜单文案 |
| `windows/floating_ball.rs` | 创建、显示、隐藏、销毁悬浮窗，启动/停止靠近检测 | 托盘菜单布局 |
| `storage/settings.rs` | 设置 v1 到 v2 迁移、验证、原子持久化 | 直接操作窗口句柄 |
| `storage/mod.rs` | 现有索引和收藏状态 | 读取托盘 UI 状态 |
| `commands/settings.rs` | 前端设置读写和运行时应用结果映射 | 绕过 SettingsState 写文件 |
| `commands/library.rs` | 现有收藏入口和索引事件 | 维护第二份托盘缓存 |

### 3.4 建议 command、事件和菜单 ID

实际实现以当前 Tauri 2.11 编译结果为准，契约先固定如下：

| 名称 | 入参 | 返回值/事件 | 说明 |
| --- | --- | --- | --- |
| `load_settings` | 无 | `AppSettings` | 返回 v2 规范化设置 |
| `update_settings` | `SettingsUpdate` | `AppSettings` + 运行时状态事件 | 原子保存后应用窗口/托盘行为 |
| `set_floating_window_visible` | `visible: bool` | `FloatingWindowStatus` | 供托盘和设置复用，必须幂等 |
| `show_main_window` | 无 | 成功状态 | 显示、聚焦并置前已有 `main` 窗口 |
| `tray_status` | 无 | `TrayStatus` | 主窗口启动时读取托盘是否可用和安全错误 |
| `get_floating_recent` | 无 | 最近任务列表 | 托盘和悬浮窗共享排序、去重和最多 5 条规则 |
| `set_favorite` | `fileId`, `favorite` | 索引快照或受影响 ID | 托盘和主窗口共用，不接受路径 |
| `open_main_from_floating` | `fileId` | 成功状态/定位事件 | 托盘打开任务复用同一逻辑 |

建议事件：

- `settings-changed`：包含规范化布尔设置和运行时可用状态，不包含路径。
- `floating-window-status`：包含 `visible`、`available` 和安全错误文案。
- `index-changed` 或 `favorite-changed`：只包含受影响 ID，触发托盘、悬浮窗和主窗口刷新。
- `app-exit-requested`：仅供内部协调，不开放给浏览器模式。

建议菜单 ID：

- `tray-open-main`
- `tray-toggle-floating`
- `tray-open-settings`
- `tray-exit`
- `tray-task-open:<opaque-id>`
- `tray-task-favorite:<opaque-id>`

菜单 ID 解析必须拒绝空 ID、超长 ID、包含路径分隔符的伪造 ID 和未知前缀。

### 3.5 窗口状态机

主窗口、托盘和悬浮窗共享以下受控状态：

| 状态 | 主窗口 | 托盘 | 悬浮窗 | 可执行动作 |
| --- | --- | --- | --- | --- |
| `visible` | 可见/聚焦 | 可用 | 按设置 | 拖动、关闭、打开设置 |
| `hidden-to-tray` | 隐藏 | 可用 | 按设置 | 托盘打开、切换悬浮窗、退出 |
| `floating-disabled` | 可见或隐藏 | 可用 | 不可见 | 设置开启悬浮窗 |
| `floating-error` | 可用 | 可用 | 不可用 | 重试、关闭设置、退出 |
| `exiting` | 正在关闭 | 正在清理 | 正在关闭 | 不再接受隐藏/刷新 |

状态转换必须幂等。例如连续点击“显示悬浮窗”不能创建两个窗口，连续关闭请求只能产生一次隐藏或退出动作。

### 3.6 权限和构建配置

- 原生托盘使用 Rust 端 Tauri API；前端只获得必要的窗口、事件和设置 command 权限。
- 审查 `prototype/src-tauri/capabilities/default.json`、`capabilities/floating.json`、自动生成 permission 文件和 `build.rs` 的 command 清单，移除不再需要的宽权限。
- 主窗口必须保留 `core:window:allow-start-dragging` 或等价能力；悬浮窗只保留自身移动、尺寸和事件能力。
- `tauri.conf.json` 只增加托盘需要的图标/资源和窗口行为配置，不开放任意 shell。
- `Cargo.toml` 只启用当前 Tauri 版本所需的 tray feature；不要因为 Cargo.lock 已有传递依赖就假设代码可以直接使用托盘 API。

## 4. 分阶段实施清单

当前发布版本为 `0.3.0`。阶段 A-G 的代码和自动验证已经落地，用户已完成阶段 H 的 Windows 手工验收和安装后检查；本次发布包含 `0.2.8` 主窗口拖动修复检查点。

### 阶段 A：契约、设置迁移和验证骨架

阶段版本：`0.2.1`

目标：先把设置 v2、窗口/托盘状态机和可测试契约落地，不改变默认用户行为。

实施清单：

- [x] 在 `prototype/src-tauri/src/storage/settings.rs` 增加 `hide_to_tray`、`show_floating_window`，将设置格式提升到 v2。
- [x] 实现 v1 到 v2 的兼容读取、原子迁移、非法值回退和旧文件保护。
- [x] 在 `prototype/src/features/settings/settingsModel.js`、`settingsApi.js` 和 `SettingsPanel.jsx` 增加两个复选框、默认值、规范化和保存传参。
- [x] 定义 `FloatingWindowStatus`、`AppLifecycleState`、托盘任务行和菜单 ID 的 Rust/前端类型边界，禁止携带完整路径。
- [x] 为运行时设置应用预留 `settings-changed`/`floating-window-status` 事件，保持浏览器模式安全回退。
- [x] 为设置迁移、默认值、重启持久化、布尔字段校验和旧字段保留补充 Rust 与前端针对性测试。
- [x] 在 `prototype/tests/` 增加托盘模型或菜单 ID 的纯函数测试入口，覆盖文案清理、ID 解析、收藏动作和空列表模型。
- [x] 更新 `prototype/README.md` 的设置格式说明，并区分已实现能力与待验收行为。

阶段完成条件：

- [x] v1 设置读取后得到正确的 v2 默认字段，已有排序/分页/确认偏好不变。
- [x] 损坏设置、未知版本和迁移写入失败不会清空索引或产生半写文件（迁移写入失败的专门故障注入仍待补充，代码路径已保持原子写入保护）。
- [x] 设置面板可在浏览器回退中展示并切换两个选项，桌面端请求契约已通过编译。
- [x] 针对性设置/模型测试和 `cargo fmt --check` 通过。
- [x] `PROJECT_PROGRESS.md` 已记录实际改动、测试结果、风险和阶段 B 的具体入口。
- [x] 版本入口已从阶段 A 的 `0.2.1` 检查点继续推进并统一为发布版本 `0.3.0`：`prototype/package.json`、package-lock 根包、`tauri.conf.json`、`Cargo.toml`、Cargo.lock 根包、README 和进度文档。

### 阶段 B：系统托盘图标、静态菜单和退出生命周期

阶段版本：`0.2.2`

目标：建立唯一托盘图标和可靠的打开/设置/退出路径。

实施清单：

- [x] 新增 `prototype/src-tauri/src/windows/tray.rs`，封装托盘创建、图标、tooltip、静态菜单和事件分发。
- [x] 在 `prototype/src-tauri/src/windows/lifecycle.rs` 中集中处理 `is_exiting`、主窗口显示/聚焦、关闭和资源清理。
- [x] 在 `prototype/src-tauri/src/lib.rs` 的 `setup` 和 `RunEvent::Exit` 中按顺序初始化/销毁 SettingsState、TrayState、FloatingBallState 和 PreviewState。
- [x] 注册 `tray-open-main`、`tray-open-settings`、`tray-exit`，菜单事件不依赖前端页面是否已加载。
- [x] 托盘图标创建失败时保留主窗口可用，向主窗口发送无路径错误；重试不会重复创建图标。
- [x] 检查托盘图标资源，确认 `prototype/src-tauri/icons/icon.ico` 在构建和 NSIS 配置中可用。
- [x] 审查 `Cargo.toml` 的 Tauri tray feature、capability 和生成 schema，只授予实际需要的权限。
- [x] 增加托盘模型测试：静态顺序、ID 唯一性约束、退出标志和重复创建保护模型。

阶段完成条件：

- [x] Windows 开发运行时只出现一个托盘图标，tooltip 和右键菜单可用。
- [x] “打开主窗口”和“打开设置”可以从隐藏、最小化和首次启动状态唤起已有主窗口。
- [x] “退出”可以绕过隐藏逻辑，关闭主窗口、悬浮窗和预览资源且进程结束。
- [x] 托盘创建失败时主窗口仍可导入和预览资料，不出现崩溃或死循环。
- [x] `cargo check`、托盘针对性测试和最小前端构建通过。
- [x] 版本和 `PROJECT_PROGRESS.md` 已同步到发布版本 `0.3.0`，并保留阶段历史。

### 阶段 C：关闭时隐藏到托盘

阶段版本：`0.2.3`

目标：实现 `hideToTray` 的持久化语义和主窗口关闭拦截。

实施清单：

- [x] 在 `main` 窗口事件处理器中区分普通关闭请求和显式退出请求，避免 `CloseRequested` 递归触发。
- [x] `hideToTray=false` 时保持正常退出；`hideToTray=true` 时拦截关闭并隐藏主窗口。
- [x] 自定义关闭按钮、系统标题栏关闭、Alt+F4 和托盘退出分别走同一生命周期 service 的不同入口。
- [x] 从托盘打开主窗口时执行 `show`、`unminimize`、`set_focus` 和置前，不能创建第二个窗口。
- [x] 托盘不可用时阻止“无提示隐藏”，向主窗口提供可执行提示。
- [x] 为关闭、恢复、重复关闭、显式退出、应用异常和设置重启恢复增加 Rust/Windows 侧测试或可重复手工记录。
- [x] 在主窗口 UI 中保持关闭、最小化和最大化按钮的可见焦点及正确文案。
- [x] 更新 README，明确“隐藏到托盘”只控制关闭请求，不等于开机自启。

阶段完成条件：

- [x] 两种设置值下，主窗口关闭行为与约定一致。
- [x] `hideToTray=true` 时托盘仍可打开主窗口和退出；没有孤留悬浮窗或无法退出的进程。
- [x] 快速连续点击关闭/打开不会产生多窗口、多托盘图标或状态错乱。
- [x] 浏览器/Sites 构建不调用关闭拦截 API。
- [x] 版本和进度已同步到发布版本 `0.3.0`，并保留 `0.2.3` 阶段历史。

### 阶段 D：显示悬浮窗设置和运行时切换

阶段版本：`0.2.4`

目标：把已有悬浮球生命周期接入 `showFloatingWindow`，支持不重启切换。

实施清单：

- [x] 在 `prototype/src-tauri/src/windows/floating_ball.rs` 和 `windows/mod.rs` 增加幂等的显示、隐藏、销毁、重建入口。
- [x] 启动 `setup` 时先读取 SettingsState，再决定是否创建 `floating-ball`；关闭设置时不得闪现悬浮窗。
- [x] 从设置面板保存后立即应用可见性；关闭窗口时停止/恢复靠近检测和拖放监听。
- [x] 在托盘菜单中增加“显示悬浮窗/隐藏悬浮窗”，动作同时更新设置持久化值，不另造临时状态。
- [x] 悬浮窗创建失败时返回 `FloatingWindowStatus`，保留用户意图、显示可读错误并提供重试。
- [x] 保证 `hideToTray` 与 `showFloatingWindow` 的四种组合在代码路径上可用，尤其是“隐藏到托盘 + 不显示悬浮窗”。
- [x] 处理索引事件、位置文件、预览资源和退出清理在悬浮窗关闭后的行为，避免遗留线程或窗口句柄。
- [x] 增加设置模型、Rust 状态机和 Windows 手工检查：运行时切换、重启恢复、创建失败、重复切换、显示器位置恢复。

阶段完成条件：

- [x] 设置关闭悬浮窗后，球体不显示、不接收文件拖放、不继续靠近轮询。
- [x] 设置重新开启后，原位置或安全回退位置恢复，最近列表和索引仍一致。
- [x] 托盘开关与设置面板开关互相反映，重启后保持最后选择。
- [x] 悬浮窗创建失败不阻塞主窗口和托盘退出。
- [x] `npm.cmd run test:settings`、`npm.cmd run test:floating-ball`、`cargo check` 和构建通过。
- [x] 版本和进度已同步到发布版本 `0.3.0`，并保留 `0.2.4` 阶段历史。

### 阶段 E：主窗口拖动区域

阶段版本：`0.2.5`

目标：让无装饰主窗口拥有可预测的拖动体验，不破坏页面交互。

实施清单：

- [x] 在 `prototype/src/App.jsx` 和相关布局中建立明确的标题栏拖动区域，给交互控件增加排除标记。
- [x] 使用 Tauri 2 的 `data-tauri-drag-region="deep"` 覆盖窗口顶部拖动带和页面标题；悬浮球保留独立的拖动 API，资料行不直接调用窗口 API。
- [x] 检查窗口控制按钮、设置入口、搜索、排序、拖放区、资料表格、预览模态框和文本选择的非拖动标记。
- [x] 保持现有主窗口最小尺寸、最大化/还原、键盘焦点和高 DPI 布局；拖动逻辑不修改悬浮窗位置。
- [x] 为拖动区域保留鼠标、指针和键盘可访问状态，不把整个页面设为不可选择。
- [x] 保持浏览器回退的非 Tauri 行为，不调用真实窗口 API。
- [x] 编写最小前端测试或手工检查记录，覆盖拖动命中、排除控件、双显示器和最大化恢复。

阶段完成条件：

- [x] Windows 下可从标题栏空白区域拖动主窗口到不同显示器和负坐标区域。
- [x] 所有按钮、输入框、下拉框、资料行和预览控件仍能正常点击、选择和拖放。
- [x] 快速拖动、双击标题栏和窗口最大化/还原没有卡死、跳位或误关闭。
- [x] `npm.cmd run build`、相关前端测试和 `cargo check` 通过。
- [x] 版本和进度已同步到发布版本 `0.3.0`，并保留 `0.2.5` 阶段历史。

### 阶段 F：托盘最近任务和收藏操作

阶段版本：`0.2.6`

目标：把最近任务列表和现有收藏能力接入原生托盘。

实施清单：

- [x] 在 `storage` 中复用共享的最近任务查询/排序/去重函数，保证悬浮窗和托盘使用同一规则。
- [x] 扩展 `FloatingRecentEntry`，只返回菜单所需字段并带上 `favorite`、`invalid` 和记录时间。
- [x] 在 `windows/tray.rs` 构造最多 5 个任务子菜单；任务为空、失效或名称非法时使用禁用/安全提示项。
- [x] 为每个任务增加“打开任务”和“收藏/取消收藏”两个明确动作，动作 ID 只携带不透明索引 ID。
- [x] 托盘打开任务复用主窗口唤起和 `floating-open-file` 定位事件，文件夹、普通文件、失效路径行为与悬浮球一致。
- [x] 托盘收藏复用 `storage::set_favorite` 共享服务，并通过 `index-changed` 让主窗口和悬浮球刷新。
- [x] 在主窗口收藏、移除、删除、重命名和重新定位后刷新托盘菜单并清理旧任务快照。
- [x] 处理动态菜单刷新并发、窗口未显示、快速连续点击、索引写入失败和托盘句柄失效。
- [x] 增加 Rust/前端菜单模型、ID 解析、收藏持久化和跨窗口同步测试。

阶段完成条件：

- [x] 托盘最近任务与悬浮窗最近 5 条顺序、数量和失效状态一致。
- [x] 每项任务都能看到并执行“收藏/取消收藏”，操作后主窗口收藏筛选和重启状态一致。
- [x] 任务被移除或原文件删除后，托盘不会保留可点击幽灵项。
- [x] 文件名含中文、空格、换行和超长文本时菜单仍可读且不泄露完整路径。
- [x] 快速连续收藏不会丢更新、重复菜单或崩溃。
- [x] 相关前端/Rust 测试和构建通过，版本和进度已同步到发布版本 `0.3.0`，并保留 `0.2.6` 阶段历史。

### 阶段 G：`WebView2Loader.dll` 打包与安装布局

阶段版本：`0.2.7`

目标：将 loader 作为可验证的 Windows 发布产物放入安装后的应用目录。

实施清单：

- [x] 记录当前 `tauri build` 生成的 loader 来源、目标架构、文件大小和 SHA-256，不提交 `target/` 文件。
- [x] 在 `prototype/scripts/` 增加受控的 loader 校验脚本，并让发布脚本失败即停。
- [x] 确认 Tauri 自动打包路径，release 构建断言 loader 与主 exe 同目录；安装后目录仍保留手工检查项。
- [x] 只允许 x64 目标使用 x64 loader；架构不匹配、文件缺失或空文件时拒绝检查通过。
- [x] 检查 `bundle.resources`、NSIS 模板和安装目录布局，避免把 loader 放入运行时不可见的嵌套目录。
- [x] 更新 `.gitignore`，继续忽略 `target/`、安装包和临时 staging。
- [x] 在 README 中区分 loader 与 WebView2 Runtime，并记录 Runtime 仍需目标机已有安装的边界。
- [x] 增加构建后检查脚本，支持 release 目录和用户明确提供的安装目录。

阶段完成条件：

- [x] `npm.cmd run tauri:build` 在当前锁定依赖和可复现项目命令下通过。
- [x] NSIS 安装包解包/安装后，应用主 exe 同目录存在正确架构的 `WebView2Loader.dll`。
- [x] 首次启动、升级安装、卸载和再次安装不丢 DLL，不产生多余临时 loader。
- [x] WebView2 Runtime 缺失时的错误边界与 README 一致，没有把 loader 误报成完整 Runtime。
- [x] 版本和进度已同步到发布版本 `0.3.0`，并保留 DLL 来源、hash、检查命令和结果。

### 阶段 H：集成回归、Windows 验收和 `0.3.0` 发布

> 说明：阶段 H 是本计划完成后的最终发布节点，不是新的 `0.2.x` 中间阶段。阶段 A-G 每完成一个阶段分别更新 `0.2.1` 至 `0.2.7`；主窗口拖动修复使用 `0.2.8` 补丁检查点；阶段 H 的全部发布门槛已通过，当前版本为 `0.3.0`。

阶段完成版本：`0.3.0`

目标：完成全部功能的组合验收、文档同步和 Windows x64 安装包发布门槛。

实施清单：

- [x] 更新 `prototype/README.md`，写清托盘菜单、关闭隐藏语义、悬浮窗开关、拖动区域、任务收藏和 loader/Runtime 边界。
- [x] 更新 `PROJECT_PROGRESS.md`，记录阶段 A-G 的实际完成项、验证命令、手工验收结果、阻塞和下一步。
- [x] 检查设置 v2、索引 v3、悬浮球位置文件 v1、托盘菜单状态和事件契约的文档/代码一致性。
- [x] 检查 `lib.rs` 的 setup、close request、RunEvent::Exit 顺序，避免隐藏、退出、异常和窗口重试互相递归。
- [x] 检查主窗口与悬浮窗 capability、自动生成 permission、Tauri command 清单和构建资源配置。
- [x] 执行最小必要自动验证，不为发布重复运行与本轮无关的大量压力测试。
- [x] 用户已使用无敏感信息的真实 Windows 文件和目录完成第 6.3 节手工验收；浏览器演示不能替代系统托盘、关闭、窗口拖动和安装包检查。
- [x] 用户已确认 P0/P1 问题清零、loader 安装后检查通过、文档和版本入口一致，版本更新为 `0.3.0`。
- [x] 生成并检查 Windows x64 NSIS 安装包；不上传远程仓库、不提交安装包或签名私钥。实际安装目录检查仍保留在上一项手工验收中。

最终完成条件：

- [x] 六项用户需求全部在 Windows 11 桌面端通过验收。
- [x] 现有资料库、预览、索引收藏、悬浮球记录和 Sites 构建没有回归。
- [x] 设置 v1 到 v2 迁移、索引 v3 保留、原子写入和错误回退通过验证。
- [x] 安装后的应用目录含正确 `WebView2Loader.dll`，Runtime 依赖和未签名状态在 README 中如实说明。
- [x] `0.3.0` 在前端包、锁文件、Tauri 配置、Rust crate、README、计划和进度文档中一致。

## 5. 预期文件变更

### 5.1 预计新增文件

- `prototype/src-tauri/src/windows/tray.rs`：托盘图标、菜单构造、动态任务刷新和菜单事件分发。
- `prototype/src-tauri/src/windows/lifecycle.rs`：主窗口关闭/隐藏/显示/退出状态机。
- `prototype/src-tauri/src/commands/window.rs` 或等价模块：前端需要的主窗口/悬浮窗状态 command。
- `prototype/tests/tray-model.test.mjs`：菜单 ID、文案清理、任务排序和收藏动作纯函数测试。
- `prototype/scripts/prepare-webview2-loader.mjs` 或 `verify-webview2-loader.mjs`：loader 来源、架构、hash 和安装布局检查。
- `prototype/src-tauri/resources/windows/x64/WebView2Loader.dll`：只有在来源、许可证、架构和仓库策略允许固定资源时才新增；优先复用可复现构建输出。

### 5.2 必须检查或修改的现有文件

- `prototype/src-tauri/src/lib.rs`：状态注册、setup 顺序、托盘创建、关闭请求和退出清理。
- `prototype/src-tauri/src/windows/mod.rs`、`floating_ball.rs`：悬浮窗显示/隐藏/重建和清理。
- `prototype/src-tauri/src/storage/settings.rs`、`commands/settings.rs`：设置 v2、迁移和运行时应用结果。
- `prototype/src-tauri/src/storage/mod.rs`、`commands/library.rs`：共享最近任务/收藏服务和跨窗口事件。
- `prototype/src-tauri/build.rs`、`commands/mod.rs`：command 清单和编译注册。
- `prototype/src-tauri/Cargo.toml`、`Cargo.lock`：Tauri tray feature 和实际新增依赖/锁定版本。
- `prototype/src-tauri/tauri.conf.json`：窗口行为、托盘资源、loader 资源和 NSIS 配置。
- `prototype/src-tauri/capabilities/default.json`、`capabilities/floating.json`、`permissions/`、`gen/schemas/`：最小权限和生成结果。
- `prototype/src/features/settings/settingsModel.js`、`settingsApi.js`、`SettingsPanel.jsx`：两个新设置和错误反馈。
- `prototype/src/features/floating-ball/floatingBallApi.js`、`FloatingBallWindow.jsx`、`FloatingBallPanel.jsx`：可见性、状态刷新和收藏标记同步。
- `prototype/src/App.jsx`、`prototype/src/main.jsx`、`prototype/src/styles.css`：主窗口拖动区域、设置状态和托盘/窗口错误提示。
- `prototype/tests/settings-model.test.mjs`、`floating-ball-model.test.mjs` 及新增测试文件。
- `prototype/package.json`、`package-lock.json`、`prototype/README.md`、`PROJECT_PROGRESS.md`。

### 5.3 不应修改的边界

- 不修改 `prototype/worker/index.js`、`prototype/scripts/prepare-sites-build.mjs` 和 `prototype/tests/sites-worker.test.mjs` 的既有职责，除非回归证据证明必须修复。
- 不把托盘任务路径写入前端 URL、普通日志、错误提示或浏览器回退数据。
- 不提交 `prototype/src-tauri/target/`、NSIS 安装包、真实用户文件、测试用户路径、临时 staging、私钥或访问令牌。
- 不把托盘收藏变成文件复制、移动、重命名或删除。

## 6. 最小验证矩阵

### 6.1 文档和静态检查

每个阶段完成后执行与改动范围匹配的最小检查：

```powershell
Get-Content -Encoding utf8 PROJECT_PLAN.md
Get-Content -Encoding utf8 PROJECT_PROGRESS.md
rg -n "PLAN\.md|0\.3\.0|0\.2\.[1-8]|hideToTray|showFloatingWindow|WebView2Loader\.dll" PROJECT_PLAN.md PROJECT_PROGRESS.md prototype
git diff --check
git status --short
```

检查要求：

- 文档为 UTF-8，无乱码、控制字符和行尾空白。
- 旧计划的悬浮球专属“阶段 A-E 完成/0.2.0 发布”表述不再作为本轮当前执行入口；历史进度可以保留为历史记录。
- 根目录不存在需要并行维护的旧 `PLAN.md`。
- 当前阶段未完成项使用未勾选状态；不能把设计或计划写成已实现。

### 6.2 前端和 Rust 自动验证

设置、托盘模型或窗口行为有改动时，优先执行：

```powershell
cd prototype
npm.cmd run test:settings
npm.cmd run test:floating-ball
npm.cmd run test:tray
npm.cmd run build
npm.cmd run test:sites
```

如果新增测试脚本名称不同，必须同步 `package.json` 和本计划，不伪造不存在的命令。Rust 按范围执行：

```powershell
cd src-tauri
cargo fmt --check
cargo test settings
cargo test tray
cargo check
cargo clippy --all-targets --all-features -- -D warnings
```

最低覆盖项：

- 设置 v1 到 v2 迁移、默认值、非法值、损坏文件和原子写入失败保护。
- `hideToTray` 关闭/退出状态机的幂等性和显式退出绕过。
- `showFloatingWindow` 四种组合、重复开关、创建失败和重启恢复。
- 托盘静态菜单顺序、动态任务最多 5 条、空/失效项、菜单 ID 解析和危险字符清理。
- 收藏写入保留记录 ID、路径、`addedAt`、`lastRecordedAt` 和其他用户字段，并向各窗口发出刷新事件。
- 主窗口拖动区域的命中/排除规则不影响按钮、文本选择和资料拖放。
- loader 文件存在、目标架构、hash 检查和安装路径验证逻辑。

### 6.3 Windows 11 手工验收清单

用户使用不含个人信息的测试文件和目录进行，记录日期、Windows/WebView2 Runtime 信息、构建版本、测试夹具、通过项、失败项和是否阻断 `0.3.0`：

1. 首次启动应用，确认任务栏不出现额外主窗口图标，系统托盘出现且只有一个本产品图标，tooltip 正确。
2. 左键单击托盘图标，确认主窗口显示、聚焦、置前；重复点击不创建第二个窗口。
3. 右键托盘，确认静态菜单顺序、设置入口、悬浮窗开关和退出入口可用，键盘可导航。
4. `hideToTray=false` 时点击主窗口关闭、按 Alt+F4 和使用系统关闭请求，确认应用正常退出。
5. `hideToTray=true` 时重复上述关闭动作，确认主窗口隐藏、托盘仍在、进程未退出，托盘打开可恢复。
6. 在隐藏状态点击托盘“退出”，确认应用、悬浮窗、预览资源和托盘图标全部结束，不需要强制结束进程。
7. 设置 `showFloatingWindow=false`，确认悬浮球立即不可见、不接收文件拖放、不继续靠近展开；重启后仍关闭。
8. 再开启 `showFloatingWindow`，确认悬浮球恢复到原位置或安全可见位置，最近记录和托盘仍一致。
9. 测试 `hideToTray` 与 `showFloatingWindow` 的四种组合，尤其确认两项都关闭时托盘仍能打开主窗口和退出。
10. 将鼠标拖动主窗口标题栏空白区域到另一块显示器；确认按钮、搜索、下拉框、资料行、预览和文本选择不会误拖动窗口。
11. 从悬浮球记录至少 6 个不同资料，打开托盘“最近任务”，确认最多 5 条、顺序和悬浮窗一致。
12. 对托盘任务执行“收藏”和“取消收藏”，确认主窗口收藏筛选、悬浮窗/托盘状态和重启后的状态一致。
13. 在主窗口移除、重命名、重新定位或删除某个最近任务，确认托盘下一次打开没有幽灵项目，失效项有正确提示。
14. 使用中文名、空格、超长名、带换行字符的安全测试文件，确认菜单文本被清理且不显示完整路径。
15. 安装 `0.3.0` NSIS 包，检查安装目录主 exe 同目录存在 `WebView2Loader.dll`；启动、升级、卸载、重装各执行一次。
16. 在已有 WebView2 Runtime 的 Windows 11 环境启动并打开文本、图片、Office、PDF、视频等既有预览；确认 loader 在安装目录且没有误报 Runtime 已被内置。
17. 在浏览器回退和 Sites 构建中确认没有托盘 API、真实路径、窗口拖动 command 或安装资源错误。

本次清单 1-17 已由用户完成 Windows 11 手工验收；后续涉及托盘、关闭语义、窗口拖动或安装目录的改动必须重新执行对应检查，不能用浏览器截图替代。

### 6.4 安装包和发布验证

阶段 G 后、阶段 H 发布前执行：

```powershell
cd prototype
npm.cmd run build
npm.cmd run test:library
npm.cmd run test:settings
npm.cmd run test:preview
npm.cmd run test:floating-ball
npm.cmd run test:tray
npm.cmd run test:sites
npm.cmd run tauri:build
```

然后检查：

```powershell
Get-Item src-tauri/target/release/WebView2Loader.dll
Get-FileHash src-tauri/target/release/WebView2Loader.dll -Algorithm SHA256
Get-ChildItem src-tauri/target/release/bundle/nsis
git status --short
```

发布门槛：

- 安装包架构为 Windows x64，产品版本和文件名为 `0.3.0`。
- 从安装包实际安装或解包后的目录检查 `WebView2Loader.dll`，不能只检查 Cargo 构建缓存。
- 安装、首次启动、设置重启恢复、托盘退出、卸载和重装通过。
- 安装包不含测试夹具、真实用户数据、日志、临时路径、签名私钥或无关 DLL。
- loader 来源、hash、目标架构和 Runtime 依赖写入 `PROJECT_PROGRESS.md`，但不写入敏感本机路径。

## 7. 版本与进度同步规则

### 7.1 固定版本表

| 完成节点 | 版本 | 主要同步内容 |
| --- | --- | --- |
| 本计划重写完成 | `0.2.0` | 只替换计划并记录进度，不修改代码版本 |
| 阶段 A 完成 | `0.2.1` | 设置 v2、契约、测试骨架、包/Tauri/Rust/锁文件/README/进度 |
| 阶段 B 完成 | `0.2.2` | 托盘图标、静态菜单、生命周期、权限和进度 |
| 阶段 C 完成 | `0.2.3` | 关闭隐藏到托盘、退出路径、README、版本和进度 |
| 阶段 D 完成 | `0.2.4` | 悬浮窗显示设置、运行时切换、版本和进度 |
| 阶段 E 完成 | `0.2.5` | 主窗口拖动区域、窗口行为验证、版本和进度 |
| 阶段 F 完成 | `0.2.6` | 托盘最近任务、收藏动作、同步事件、版本和进度 |
| 阶段 G 完成 | `0.2.7` | loader 资源、NSIS 安装目录验证、版本和进度 |
| 主窗口拖动修复检查点 | `0.2.8` | 顶部拖动带、标题栏原生拖动标记、交互排除、版本和进度 |
| 计划完成，阶段 H 发布门槛通过 | `0.3.0` | 全部代码、锁文件、README、计划、进度、安装包和发布记录 |

### 7.2 每阶段必须执行的同步动作

1. 完成该阶段代码、针对性自动测试和约定的 Windows 手工检查。
2. 更新 `PROJECT_PROGRESS.md` 的日期、已完成、进行中、阻塞与风险、下一步、涉及文件和验证结果。
3. 同步 `prototype/package.json`、package-lock 根包、`prototype/src-tauri/tauri.conf.json`、`Cargo.toml` 和 Cargo.lock 根包版本；第三方依赖版本不能被全局替换。
4. 更新 `prototype/README.md` 的当前能力、使用方式和外部依赖边界，不把浏览器演示或未验收功能写成桌面已支持。
5. 检查 capability、自动生成 permission、构建资源和 `.gitignore`，排除安装包、DLL 临时副本、真实路径和密钥。
6. 只勾选已经实际完成且有验证证据的清单；阻塞项保持未完成，并保留恢复步骤。

`0.3.0` 不是计划重写当天的版本，也不是只完成源码后的版本；本次已在阶段 A-G、Windows 11 手工验收、安装后 loader 检查、文档同步和发布构建全部通过后更新。

## 8. 风险、回退和故障处理

### 8.1 主要风险

- Tauri 2 tray API、Windows Shell 菜单事件和图标生命周期在不同 WebView2/Windows 版本上可能有差异，必须以安装后的真实桌面行为为准。
- 无装饰窗口的 `CloseRequested`、隐藏和显式退出可能互相递归；需要独立的退出标志和幂等清理。
- 设置保存和窗口运行时应用是两个失败点，可能出现“偏好已保存但窗口创建失败”；必须返回可读警告和重试入口。
- 悬浮窗关闭/重建与靠近检测线程、位置保存、索引事件存在竞态，不能只依赖前端布尔状态。
- Native menu 的动态子菜单对超长文件名、旧句柄和快速刷新较敏感，需限制文案长度并集中替换句柄。
- `WebView2Loader.dll` 可能已经由 Tauri 自动产出；重复打包可能导致目录冲突或错误架构，必须先检查真实输出再增加显式资源。
- loader 与 Runtime 是不同组件。只带 loader 不能解决目标机没有 WebView2 Runtime 的问题，不能在发布说明中混淆。
- 收藏更新如果没有广播事件，主窗口、悬浮窗和托盘会短暂显示不同状态；必须以 Rust 持久化索引为准并支持重新拉取。

### 8.2 回退策略

- 托盘创建失败：主窗口保持可用；若 `hideToTray=true`，关闭前显示无法安全隐藏的提示，允许用户关闭设置或显式退出。
- 托盘动态菜单刷新失败：保留静态打开/设置/退出菜单，任务列表显示“暂时无法读取”，不影响索引和主窗口。
- 设置 v2 迁移失败：保留旧文件，使用安全默认值运行；禁止静默覆盖旧设置。
- 悬浮窗创建失败：主窗口和托盘继续工作，设置保留用户意图并提供重试；不把失败显示成已开启。
- 主窗口拖动在某个环境不稳定：保留可用的标题栏控制和托盘恢复能力，先关闭拖动区域扩展，不能破坏按钮和资料交互。
- loader 资源缺失或架构不符：发布构建失败并保留上一版 `0.2.x`，不得发布一个无法验证的安装包。
- 收藏写入失败：保持原收藏值和索引快照，托盘显示失败提示；不修改用户原文件。

### 8.3 回滚边界

- 每阶段完成后形成可定位的 Git 提交或本地检查点，版本只回退到最近一个已验证的 `0.2.x`。
- 回滚托盘功能不能删除已有 `settings.json`、`index.json` 或 `floating-ball.json`；未识别的新设置字段按迁移策略保留或安全忽略。
- 回滚发布资源时删除的是构建配置/临时 staging，不删除用户安装目录中的用户数据。
- 不使用 `git reset --hard` 或覆盖用户未提交改动；只撤销本轮明确产生的文件。

## 9. 当前执行入口

当前执行入口：

本文件继续是唯一当前执行入口；根目录未发现独立旧 `PLAN.md`。阶段 A-G 的代码、权限、事件、自动测试和开发构建已落地，阶段 H 的 Windows 11 手工验收和 NSIS 安装后 loader 检查也已完成，当前版本为 `0.3.0`。后续执行入口转为维护现有外部依赖边界；涉及托盘、关闭语义、窗口拖动或安装目录的改动必须重新执行对应验收。

### 当前实现快照

| 范围 | 当前状态 | 证据 |
| --- | --- | --- |
| 阶段 A 设置 v2 | 已实现并自动验证 | Rust 迁移/非法值测试、`test:settings` |
| 阶段 B-C 托盘与关闭生命周期 | 已实现并完成桌面验收 | `windows/tray.rs`、`windows/lifecycle.rs`、`cargo check`、用户验收 |
| 阶段 D 悬浮窗运行时开关 | 已实现并完成桌面验收 | `show_floating_ball`/`hide_floating_ball`、设置事件、用户验收 |
| 阶段 E 主窗口拖动区域 | 已实现并完成 Windows 拖动验收 | 顶部拖动带、`data-tauri-drag-region="deep"`、非拖动排除标记、用户验收 |
| 阶段 F 托盘最近任务/收藏 | 已实现并完成桌面菜单验收 | 共享 `floating_recent`、托盘模型测试、用户验收 |
| 阶段 G loader | 已完成开发构建、release 和安装后检查 | `verify-webview2-loader.mjs`、`tauri:build`、用户验收 |
| 阶段 H `0.3.0` | 已完成 | Windows 11 手工验收、文档同步、版本统一和发布构建 |
