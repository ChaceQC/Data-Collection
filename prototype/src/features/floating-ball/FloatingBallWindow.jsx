import { useEffect, useRef, useState } from "react";
import {
  CheckCircle,
  DownloadSimple,
  Files,
  SpinnerGap,
  WarningCircle,
} from "@phosphor-icons/react";
import {
  canUseFloatingBallRuntime,
  revealFloatingFile,
  listenFloatingEvent,
  openMainFromFloating,
  showMainWindow,
} from "./floatingBallApi.js";
import { getOperationError, parseIndexChangedEvent, parseRevisionEvent } from "../../lib/ipcContracts.js";
import { FloatingBallPanel } from "./FloatingBallPanel.jsx";
import {
  createFloatingBallHoverController,
  isFloatingPanelVisible,
} from "./floatingBallHoverController.js";
import { useFloatingBallWindowGeometry } from "./useFloatingBallWindowGeometry.js";
import { useFloatingBallDrag } from "./useFloatingBallDrag.js";
import { useFloatingBallRecords } from "./useFloatingBallRecords.js";
import {
  DEFAULT_FLOATING_PLACEMENT,
  FLOATING_BALL_CONSTANTS,
  getFloatingLibraryCountPresentation,
} from "./floatingBallModel.js";

const IS_TAURI_RUNTIME = canUseFloatingBallRuntime();

export function FloatingBallWindow() {
  const [placement, setPlacement] = useState(DEFAULT_FLOATING_PLACEMENT);
  const [hoverState, setHoverState] = useState("collapsed");
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");
  const [actionBusyId, setActionBusyId] = useState("");
  const placementRef = useRef(placement);
  const panelOpenRef = useRef(false);
  const nearRef = useRef(false);
  const feedbackTimerRef = useRef(null);
  const controllerDisposeTimerRef = useRef(null);
  const controllerRef = useRef(null);
  const openWindowRef = useRef(null);
  const closeWindowRef = useRef(null);
  const hoverErrorRef = useRef(null);
  const actionBusyRef = useRef("");
  const indexChangedHandlerRef = useRef(null);

  if (!controllerRef.current) {
    controllerRef.current = createFloatingBallHoverController({
      openDelayMs: FLOATING_BALL_CONSTANTS.openDelayMs,
      closeDelayMs: FLOATING_BALL_CONSTANTS.closeDelayMs,
      onStateChange: (nextState) => {
        panelOpenRef.current = isFloatingPanelVisible(nextState);
        setHoverState(nextState);
        setStatus((current) => current === "recording" || current === "moving" || current === "drag-over"
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
    setStatus,
    showFeedback,
  });
  indexChangedHandlerRef.current = records.handleIndexChanged;
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
      const payload = safeParse(parseIndexChangedEvent, event.payload, "index-changed");
      if (payload) indexChangedHandlerRef.current?.(payload);
    }));
    register(listenFloatingEvent("floating-recorded", (event) => {
      const payload = safeParse(parseRevisionEvent, event.payload, "floating-recorded");
      if (payload) indexChangedHandlerRef.current?.(payload);
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
      phase === "close" ? "悬浮球窗口无法收起，请重试" : "文件库面板无法展开，请重试",
      "error",
    );
  }

  async function handleOpenFile(entry) {
    await openEntryInMain(entry, "locate");
  }

  async function handlePreviewFile(entry) {
    if (entry?.kind === "folder" || entry?.invalid) return;
    await openEntryInMain(entry, "preview");
  }

  async function openEntryInMain(entry, action) {
    if (!entry?.id || actionBusyRef.current) return;
    if (!IS_TAURI_RUNTIME) {
      showFeedback("浏览器演示仅展示文件库，未打开本地文件", "partial-error");
      return;
    }
    actionBusyRef.current = entry.id;
    setActionBusyId(entry.id);
    try {
      await openMainFromFloating(entry.id, action);
      if (!await hoverController.explicitClose()) {
        showFeedback("主窗口已打开，但悬浮球无法收起，请重试", "partial-error");
      }
    } catch (error) {
      showFeedback(getOperationError(error, "主窗口无法打开该资料"), "error");
    } finally {
      actionBusyRef.current = "";
      setActionBusyId("");
    }
  }

  async function handleReveal(entry) {
    if (!entry?.id || actionBusyRef.current) return;
    if (!IS_TAURI_RUNTIME) {
      showFeedback("浏览器演示仅展示文件库，未启动资源管理器", "partial-error");
      return;
    }
    actionBusyRef.current = entry.id;
    setActionBusyId(entry.id);
    try {
      const result = await revealFloatingFile(entry.id);
      showFeedback(`已在资源管理器中定位：${result.name}`, "recorded");
    } catch (error) {
      showFeedback(getOperationError(error, "无法在资源管理器中定位，请检查路径"), "error");
    } finally {
      actionBusyRef.current = "";
      setActionBusyId("");
    }
  }

  async function handleOpenLibrary() {
    if (!IS_TAURI_RUNTIME) {
      showFeedback("浏览器演示仅展示文件库，未打开主窗口", "partial-error");
      return;
    }
    try {
      if (!await hoverController.explicitClose()) return;
      await showMainWindow();
    } catch (error) {
      const message = typeof error === "string" ? error : error?.message;
      showFeedback(typeof message === "string" && message.length <= 180 ? message : "主窗口无法打开，请重试", "error");
    }
  }

  function handlePointerEnter() {
    hoverController.pointerEnter();
  }

  function handlePointerLeave() {
    hoverController.pointerLeave();
  }

  const count = getFloatingLibraryCountPresentation(records.libraryCount, records.libraryCountStatus);
  const statusMark = status === "recorded" ? (
    <CheckCircle className="floating-ball-status-mark floating-ball-status-mark-success" size={14} weight="fill" aria-hidden="true" />
  ) : status === "partial-error" || status === "error" ? (
    <WarningCircle className="floating-ball-status-mark floating-ball-status-mark-error" size={14} weight="fill" aria-hidden="true" />
  ) : null;
  const panel = panelOpen && (!IS_TAURI_RUNTIME || geometry.layoutReady) ? (
    <FloatingBallPanel
      files={records.files}
      filesStatus={records.filesStatus}
      filesRefreshing={records.filesRefreshing}
      revision={records.revision}
      query={records.query}
      searchInput={records.searchInput}
      total={records.total}
      page={records.page}
      emptyState={records.emptyState}
      libraryCount={records.libraryCount}
      libraryCountStatus={records.libraryCountStatus}
      status={status}
      feedback={feedback}
      favoriteBusyId={records.favoriteBusyId}
      actionBusyId={actionBusyId}
      onOpenFile={handleOpenFile}
      onPreviewFile={handlePreviewFile}
      onReveal={handleReveal}
      onToggleFavorite={records.handleFavorite}
      onOpenLibrary={handleOpenLibrary}
      onSearchChange={records.handleSearchInput}
      onFilterChange={records.handleFilterChange}
      onSortKeyChange={records.handleSortKeyChange}
      onDirectionToggle={records.handleDirectionToggle}
      onPreviousPage={records.handlePreviousPage}
      onNextPage={records.handleNextPage}
      onRetry={() => records.refreshFiles({ initial: true })}
      onClose={() => void hoverController.explicitClose()}
      onClearSearch={records.clearSearch}
      onClearFilters={records.clearFilters}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
    />
  ) : null;
  const ball = (
    <button
      type="button"
      className={"floating-ball-trigger" + (drag.moving ? " is-moving" : "") + " status-" + status}
      aria-label={feedback ? "悬浮球：" + feedback : "悬浮球，打开文件库（" + count.label + "）"}
      title={feedback || "打开文件库"}
      aria-expanded={panelOpen}
      data-testid="floating-ball-trigger"
      data-status={status}
      data-library-count-state={count.state}
      onPointerDown={drag.handleBallPointerDown}
      onPointerMove={drag.handleBallPointerMove}
      onPointerUp={drag.handleBallPointerUp}
      onPointerCancel={drag.handleBallPointerCancel}
      onClick={() => drag.handleBallClick(hoverController.toggle)}
      onKeyDown={handleBallKeyDown}
    >
      {status === "recording" ? <SpinnerGap className="is-spinning" size={27} weight="bold" aria-hidden="true" /> : status === "drag-over" ? <DownloadSimple size={28} weight="bold" aria-hidden="true" /> : <Files size={28} weight="regular" aria-hidden="true" />}
      {count.state !== "error" && (
        <span className={"floating-ball-count-badge floating-ball-count-badge-" + count.state} aria-hidden="true" data-testid="floating-ball-count-badge">
          {count.state === "loading" ? <SpinnerGap className="is-spinning" size={11} weight="bold" /> : count.display}
        </span>
      )}
      {statusMark}
      <span className="sr-only">{feedback || (status === "drag-over" ? "可放置文件" : "准备记录文件")}</span>
    </button>
  );

  return (
    <div
      className={"floating-ball-window state-" + hoverState + (panelOpen ? " is-panel-open" : "") + (IS_TAURI_RUNTIME ? "" : " is-browser-demo") + " direction-" + geometry.direction}
      data-testid="floating-ball-window"
      data-status={status}
      data-library-count-state={count.state}
      style={geometry.getLayoutStyle()}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onDragOver={IS_TAURI_RUNTIME ? undefined : handleBrowserDragOver}
      onDragLeave={IS_TAURI_RUNTIME ? undefined : handleBrowserDragLeave}
      onDrop={records.handleBrowserDrop}
    >
      {panel}
      {ball}
      <span className="sr-only" aria-live="polite">{feedback}</span>
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

  function handleBrowserDragOver(event) {
    event.preventDefault();
    if (status !== "recording") setStatus("drag-over");
  }

  function handleBrowserDragLeave(event) {
    if (event.currentTarget === event.target && status !== "recording") {
      setStatus(panelOpenRef.current ? "near" : "idle");
    }
  }
}

function safeParse(parser, value, command) {
  try {
    return parser(value, command);
  } catch {
    return null;
  }
}
