use tauri::{AppHandle, Runtime, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

use super::monitor::BALL_SIZE_DIP;
use super::FLOATING_BALL_LABEL;

pub fn build_window<R: Runtime>(app: &AppHandle<R>) -> Result<WebviewWindow<R>, String> {
    WebviewWindowBuilder::new(
        app,
        FLOATING_BALL_LABEL,
        WebviewUrl::App("index.html?window=floating-ball".into()),
    )
    .title("本地资料工作台悬浮球")
    .inner_size(BALL_SIZE_DIP, BALL_SIZE_DIP)
    .resizable(false)
    .decorations(false)
    .transparent(true)
    .always_on_top(true)
    .skip_taskbar(true)
    .shadow(false)
    .focused(false)
    .visible(false)
    .build()
    .map_err(|_| "悬浮球窗口无法创建，请重试".to_string())
}
