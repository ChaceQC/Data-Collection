import { useEffect, useRef, useState } from "react";
import {
  ArchiveTrayIcon,
  CheckCircle,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  canUseFloatingBallRuntime,
  listenFloatingEvent,
  loadFloatingPlacement,
  openMainFromFloating,
} from "./floatingBallApi.js";
import { FloatingBallPanel } from "./FloatingBallPanel.jsx";
import {
  createFloatingBallHoverController,
  isFloatingPanelVisible,
} from "./floatingBallHoverController.js";
import {
  FLOATING_PANEL_SIZE,
  useFloatingBallWindowGeometry,
} from "./useFloatingBallWindowGeometry.js";
import { useFloatingBallDrag } from "./useFloatingBallDrag.js";
import { useFloatingBallRecords } from "./useFloatingBallRecords.js";
import {
  DEFAULT_FLOATING_PLACEMENT,
  FLOATING_BALL_CONSTANTS,
} from "./floatingBallModel.js";

const IS_TAURI_RUNTIME = canUseFloatingBallRuntime();

export function FloatingBallWindow() {
  const [placement, setPlacement] = useState(DEFAULT_FLOATING_PLACEMENT);
  const [hoverState, setHoverState] = useState("collapsed");
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");
  const placementRef = useRef(placement);
  const panelOpenRef = useRef(false);
  const nearRef = useRef(false);
  const feedbackTimerRef = useRef(null);
  const controllerDisposeTimerRef = useRef(null);
  const controllerRef = useRef(null);
  const openWindowRef = useRef(null);
  const closeWindowRef = useRef(null);
  const hoverErrorRef = useRef(null);
  const latestRevisionRef = useRef(0);

  if (!controllerRef.current) {
    controllerRef.current = createFloatingBallHoverController({
      openDelayMs: FLOATING_BALL_CONSTANTS.openDelayMs,
      closeDelayMs: FLOATING_BALL_CONSTANTS.closeDelayMs,
      onStateChange: (nextState) => {
        panelOpenRef.current = isFloatingPanelVisible(nextState);
        setHoverState(nextState);
        setStatus((current) => current === "recording" || current === "moving"
          ? current
          : isFloatingPanelVisible(nextState) ? "near" : "idle");
      },
      onOpen: (context) => openWindowRef.current?.(context),
      onClose: (context) => closeWindowRef.current?.(context),
      onError: (context) => hoverErrorRef.current?.(context),
    });
  }
  const hoverController = controllerRef.current;
  const panelOpen = isFloatingPanelVisible(hoverState);
  panelOpenRef.current = panelOpen;

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

  const geometry = useFloatingBallWindowGeometry({
    isTauriRuntime: IS_TAURI_RUNTIME,
    placementRef,
    hoverController,
  });
  const records = useFloatingBallRecords({
    isTauriRuntime: IS_TAURI_RUNTIME,
    panelOpenRef,
    setFeedback,
    setStatus,
    showFeedback,
  });
  const drag = useFloatingBallDrag({
    endControllerDrag: hoverController.endDrag,
    isTauriRuntime: IS_TAURI_RUNTIME,
    nearRef,
    placementRef,
    setFeedback,
    setPlacement,
    setStatus,
    showFeedback,
    startControllerDrag: hoverController.beginDrag,
    updateDirection: geometry.updateDirection,
  });
  openWindowRef.current = geometry.openPanelWindow;
  closeWindowRef.current = geometry.closePanelWindow;
  hoverErrorRef.current = handleHoverError;

  useEffect(() => {
    if (!IS_TAURI_RUNTIME) return undefined;
    let disposed = false;
    const unlisten = [];
    const register = (promise) => promise.then((stop) => {
      if (disposed) stop();
      else unlisten.push(stop);
    }).catch(() => undefined);
    register(listenFloatingEvent("floating-near", (event) => {
      nearRef.current = Boolean(event.payload);
      hoverController.nearChanged(nearRef.current);
    }));
    register(listenFloatingEvent("index-changed", (event) => {
      const revision = Number(event.payload?.revision || 0);
      if (revision <= latestRevisionRef.current) return;
      latestRevisionRef.current = revision;
      void records.refreshRecent();
    }));
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, [hoverController]);

  useEffect(() => {
    clearTimeout(controllerDisposeTimerRef.current);
    controllerDisposeTimerRef.current = null;
    return () => {
      clearTimeout(feedbackTimerRef.current);
      clearTimeout(controllerDisposeTimerRef.current);
      controllerDisposeTimerRef.current = window.setTimeout(() => {
        hoverController.dispose();
        controllerDisposeTimerRef.current = null;
      }, 0);
    };
  }, [hoverController]);

  function showFeedback(message, nextStatus, duration = 3200) {
    clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    setStatus(nextStatus);
    if (duration > 0) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback("");
        setStatus(isFloatingPanelVisible(hoverController.getState()) ? "near" : "idle");
      }, duration);
    }
  }

  function handleHoverError({ phase }) {
    if (phase === "open") geometry.resetExpandedLayout();
    showFeedback(
      phase === "close" ? "悬浮球窗口无法收起，请重试" : "最近记录面板无法展开，请重试",
      "error",
    );
  }

  async function handleOpenFile(entry) {
    if (entry.invalid) {
      showFeedback("该记录的路径已失效，请在主窗口中重新定位", "partial-error");
      return;
    }
    if (!IS_TAURI_RUNTIME) return;
    try {
      if (!await hoverController.explicitClose()) return;
      await openMainFromFloating(entry.id);
    } catch (error) {
      const message = typeof error === "string" ? error : error?.message;
      showFeedback(typeof message === "string" && message.length <= 180 ? message : "主窗口无法打开该资料", "error");
    }
  }

  function handlePointerEnter() {
    hoverController.pointerEnter();
  }

  function handlePointerLeave() {
    hoverController.pointerLeave();
  }

  const panel = panelOpen ? (
    <FloatingBallPanel
      recent={records.recent}
      status={status}
      feedback={feedback}
      favoriteBusyId={records.favoriteBusyId}
      onOpenFile={handleOpenFile}
      onToggleFavorite={records.handleFavorite}
      onClose={() => void hoverController.explicitClose()}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    />
  ) : null;
  const ball = (
    <button
      type="button"
      className={`floating-ball-trigger ${drag.moving ? "is-moving" : ""} status-${status}`}
      aria-label={feedback ? `悬浮球：${feedback}` : "悬浮球，打开最近记录"}
      title={feedback || "打开最近记录"}
      aria-expanded={panelOpen}
      data-testid="floating-ball-trigger"
      onPointerDown={drag.handleBallPointerDown}
      onPointerMove={drag.handleBallPointerMove}
      onPointerUp={drag.handleBallPointerUp}
      onPointerCancel={drag.handleBallPointerCancel}
      onClick={() => drag.handleBallClick(hoverController.toggle)}
      onKeyDown={handleBallKeyDown}
    >
      {status === "recording" ? <SpinnerGap className="is-spinning" size={27} weight="bold" /> : <ArchiveTrayIcon size={28} weight="regular" />}
      <span className="sr-only">{feedback || (status === "drag-over" ? "可放置文件" : "准备记录文件")}</span>
    </button>
  );

  return (
    <div
      className={`floating-ball-window state-${hoverState} ${panelOpen ? "is-panel-open" : ""} ${IS_TAURI_RUNTIME ? "" : "is-browser-demo"} direction-${geometry.direction}`}
      data-testid="floating-ball-window"
      style={geometry.getLayoutStyle()}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onDragOver={IS_TAURI_RUNTIME ? undefined : (event) => event.preventDefault()}
      onDrop={records.handleBrowserDrop}
    >
      {panel}
      {ball}
      {status === "error" && <WarningCircle className="floating-ball-error-mark" size={14} weight="fill" aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">{feedback}</span>
      <CheckCircle className="floating-ball-success-mark" size={14} weight="fill" aria-hidden="true" />
    </div>
  );

  function handleBallKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      void hoverController.explicitClose();
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      void hoverController.toggle();
    }
  }
}
