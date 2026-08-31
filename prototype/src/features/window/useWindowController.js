import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  getOperationError,
  invokeCommand,
  parseFloatingOpenEvent,
  parseIndexChangedEvent,
  parseRevisionEvent,
  parseSettingsChangedEvent,
  parseTrayStatus,
  parseWindowStatus,
} from "../../lib/ipcContracts.js";

export function useWindowController({
  isTauriRuntime,
  onIndexChanged,
  onOpenSettings,
  onOpenFloating,
  onSettingsChanged,
  showToast,
}) {
  const [floatingWindowError, setFloatingWindowError] = useState("");
  const [floatingWindowRetrying, setFloatingWindowRetrying] = useState(false);
  const handlersRef = useRef({});
  const showToastRef = useRef(showToast);

  showToastRef.current = showToast;
  handlersRef.current = { onIndexChanged, onOpenFloating, onOpenSettings, onSettingsChanged };

  useEffect(() => {
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    const unlisten = [];
    const register = (promise) => promise.then((stop) => {
      if (disposed) stop();
      else unlisten.push(stop);
    }).catch(() => undefined);

    register(getCurrentWindow().listen("floating-recorded", (event) => {
      const payload = safeParse(parseRevisionEvent, event.payload, "floating-recorded");
      if (payload) handlersRef.current.onIndexChanged(payload.revision);
    }));
    register(getCurrentWindow().listen("floating-open-file", (event) => {
      const payload = safeParse(parseFloatingOpenEvent, event.payload, "floating-open-file");
      if (payload) void handlersRef.current.onOpenFloating(payload);
    }));
    register(getCurrentWindow().listen("index-changed", (event) => {
      const payload = safeParse(parseIndexChangedEvent, event.payload, "index-changed");
      if (payload) handlersRef.current.onIndexChanged(payload.revision);
    }));
    register(getCurrentWindow().listen("open-settings", () => handlersRef.current.onOpenSettings()));
    register(getCurrentWindow().listen("tray-unavailable", (event) => {
      if (typeof event.payload === "string") showToastRef.current(event.payload);
    }));
    register(getCurrentWindow().listen("tray-action-error", (event) => {
      if (typeof event.payload === "string") showToastRef.current(event.payload);
    }));
    register(getCurrentWindow().listen("settings-changed", (event) => {
      const payload = safeParse(parseSettingsChangedEvent, event.payload, "settings-changed");
      if (payload) handlersRef.current.onSettingsChanged(payload.settings, payload.warning);
    }));
    register(getCurrentWindow().listen("floating-window-status", (event) => {
      const payload = safeParse(parseWindowStatus, event.payload, "floating-window-status");
      if (payload) setFloatingWindowError(payload.available ? "" : payload.error || "悬浮球不可用，请重试");
    }));

    invokeCommand("floating_window_status", undefined, parseWindowStatus)
      .then((status) => {
        if (disposed) return;
        const message = status.available ? "" : status.error || "悬浮球不可用，请重试";
        setFloatingWindowError(message);
        if (message) showToastRef.current(message);
      })
      .catch(() => undefined);
    invokeCommand("tray_status", undefined, parseTrayStatus)
      .then((status) => {
        if (!disposed && !status.available) showToastRef.current(status.error || "系统托盘不可用，请检查设置");
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, [isTauriRuntime]);

  const retryFloatingBall = useCallback(async () => {
    if (!isTauriRuntime || floatingWindowRetrying) return;
    setFloatingWindowRetrying(true);
    try {
      const status = await invokeCommand("retry_floating_ball", undefined, parseWindowStatus);
      if (status.available) {
        setFloatingWindowError("");
        showToastRef.current("悬浮球已恢复");
      } else {
        const message = status.error || "悬浮球不可用，请重试";
        setFloatingWindowError(message);
        showToastRef.current(message);
      }
    } catch (error) {
      const message = getOperationError(error, "悬浮球不可用，请重试");
      setFloatingWindowError(message);
      showToastRef.current(message);
    } finally {
      setFloatingWindowRetrying(false);
    }
  }, [floatingWindowRetrying, isTauriRuntime]);

  const handleWindowAction = useCallback(async (action) => {
    if (!isTauriRuntime) {
      showToastRef.current("窗口控制仅在桌面应用中可用");
      return;
    }
    try {
      const currentWindow = getCurrentWindow();
      if (action === "minimize") await currentWindow.minimize();
      if (action === "maximize") await currentWindow.toggleMaximize();
      if (action === "close") await currentWindow.close();
    } catch (error) {
      showToastRef.current(getOperationError(error, "窗口操作失败，请重试"));
    }
  }, [isTauriRuntime]);

  return {
    floatingWindowError,
    floatingWindowRetrying,
    handleWindowAction,
    retryFloatingBall,
  };
}

function safeParse(parser, value, command) {
  try {
    return parser(value, command);
  } catch {
    return null;
  }
}
