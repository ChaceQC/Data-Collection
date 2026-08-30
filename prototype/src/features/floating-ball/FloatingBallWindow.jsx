import { useEffect, useRef, useState } from "react";
import {
  ArchiveTrayIcon,
  CheckCircle,
  SpinnerGap,
  WarningCircle,
  X,
} from "@phosphor-icons/react";
import {
  canUseFloatingBallRuntime,
  getFloatingCurrentMonitor,
  getFloatingRecent,
  getFloatingScaleFactor,
  getFloatingWindowPosition,
  listenFloatingDrop,
  listenFloatingEvent,
  listenFloatingMoved,
  loadFloatingPlacement,
  moveFloatingWindow,
  openMainFromFloating,
  recordFloatingPaths,
  resizeFloatingWindow,
  saveFloatingPlacement,
  startFloatingDrag,
} from "./floatingBallApi.js";
import { FloatingBallPanel } from "./FloatingBallPanel.jsx";
import { setFavorite } from "../library/libraryApi.js";
import {
  DEFAULT_FLOATING_PLACEMENT,
  FLOATING_BALL_CONSTANTS,
  getExpandedWindowGeometry,
  getPanelDirection,
  getRecentEntries,
  getRecordMessage,
  getRecordStatus,
  getSnapPlacement,
  dipToPhysicalPosition,
  dipToPhysicalSize,
  mergePendingPaths,
  monitorToWorkArea,
  physicalToDipPosition,
} from "./floatingBallModel.js";

const IS_TAURI_RUNTIME = canUseFloatingBallRuntime();
const DEMO_RECENT = [
  {
    id: "floating-demo-note",
    name: "悬浮球演示.md",
    type: "Markdown",
    kind: "markdown",
    status: "已记录",
    invalid: false,
    recordedAt: 1,
  },
];

export function FloatingBallWindow() {
  const [recent, setRecent] = useState(IS_TAURI_RUNTIME ? [] : DEMO_RECENT);
  const [placement, setPlacement] = useState(DEFAULT_FLOATING_PLACEMENT);
  const [panelOpen, setPanelOpen] = useState(false);
  const [direction, setDirection] = useState("left");
  const [status, setStatus] = useState("idle");
  const [feedback, setFeedback] = useState("");
  const [moving, setMoving] = useState(false);
  const [ballOffset, setBallOffset] = useState({ x: 0, y: 0 });
  const placementRef = useRef(placement);
  const panelOpenRef = useRef(false);
  const movingRef = useRef(false);
  const directionRef = useRef("left");
  const recordingRef = useRef(false);
  const favoriteBusyRef = useRef("");
  const [favoriteBusyId, setFavoriteBusyId] = useState("");
  const pendingPathsRef = useRef([]);
  const dragMovedRef = useRef(false);
  const dragStartedRef = useRef(false);
  const pointerStartRef = useRef(null);
  const dragPrepareRef = useRef(Promise.resolve());
  const nearRef = useRef(false);
  const manualCollapseRef = useRef(false);
  const nearTimerRef = useRef(null);
  const closeTimerRef = useRef(null);
  const placementTimerRef = useRef(null);
  const feedbackTimerRef = useRef(null);
  const anchorPositionRef = useRef(null);
  const anchorScaleFactorRef = useRef(null);

  useEffect(() => {
    placementRef.current = placement;
  }, [placement]);

  useEffect(() => {
    if (!IS_TAURI_RUNTIME) return undefined;
    let cancelled = false;
    Promise.all([loadFloatingPlacement(), getFloatingRecent()])
      .then(([loadedPlacement, loadedRecent]) => {
        if (cancelled) return;
        setPlacement(loadedPlacement);
        setRecent(getRecentEntries(loadedRecent));
      })
      .catch(() => {
        if (!cancelled) setFeedback("悬浮球状态读取失败，请重试");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!IS_TAURI_RUNTIME) return undefined;
    let disposed = false;
    const unlisten = [];
    const register = (promise) => promise.then((stop) => {
      if (disposed) stop();
      else unlisten.push(stop);
    }).catch(() => undefined);
    register(listenFloatingEvent("floating-near", (event) => scheduleNear(Boolean(event.payload))));
    register(listenFloatingEvent("index-changed", () => void refreshRecent()));
    register(listenFloatingDrop(handleDropEvent));
    register(listenFloatingMoved((event) => {
      dragMovedRef.current = true;
      schedulePlacementSave(event.payload);
    }));
    return () => {
      disposed = true;
      unlisten.forEach((stop) => stop());
    };
  }, []);

  useEffect(() => () => {
    clearTimeout(nearTimerRef.current);
    clearTimeout(closeTimerRef.current);
    clearTimeout(placementTimerRef.current);
    clearTimeout(feedbackTimerRef.current);
  }, []);

  function showFeedback(message, nextStatus, duration = 3200) {
    clearTimeout(feedbackTimerRef.current);
    setFeedback(message);
    setStatus(nextStatus);
    if (duration > 0) {
      feedbackTimerRef.current = window.setTimeout(() => {
        setFeedback("");
        setStatus(panelOpenRef.current ? "near" : "idle");
      }, duration);
    }
  }

  async function refreshRecent() {
    if (!IS_TAURI_RUNTIME) return;
    try {
      setRecent(getRecentEntries(await getFloatingRecent()));
    } catch {
      showFeedback("最近记录暂时无法刷新", "error");
    }
  }

  async function handleFavorite(entry) {
    if (!entry?.id || favoriteBusyRef.current) return;
    const favorite = !entry.favorite;
    favoriteBusyRef.current = entry.id;
    setFavoriteBusyId(entry.id);
    try {
      if (IS_TAURI_RUNTIME) {
        const entries = await setFavorite(entry.id, favorite);
        const updatedEntry = entries.find((item) => item.id === entry.id);
        setRecent((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite: updatedEntry?.favorite ?? favorite } : item
        )));
      } else {
        setRecent((current) => current.map((item) => (
          item.id === entry.id ? { ...item, favorite } : item
        )));
      }
      showFeedback(favorite ? "已加入收藏" : "已取消收藏", "recorded");
    } catch (error) {
      showFeedback(typeof error === "string" ? error : "收藏状态更新失败，请重试", "error");
    } finally {
      favoriteBusyRef.current = "";
      setFavoriteBusyId("");
    }
  }

  function scheduleNear(nextNear) {
    const changed = nearRef.current !== nextNear;
    nearRef.current = nextNear;
    if (nextNear) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
      if (movingRef.current || manualCollapseRef.current) return;
      setStatus("near");
      if (!changed && (panelOpenRef.current || nearTimerRef.current)) return;
      nearTimerRef.current = window.setTimeout(() => {
        nearTimerRef.current = null;
        if (!movingRef.current) void openPanel();
      }, FLOATING_BALL_CONSTANTS.openDelayMs);
    } else {
      manualCollapseRef.current = false;
      clearTimeout(nearTimerRef.current);
      nearTimerRef.current = null;
      if (!changed && (closeTimerRef.current || !panelOpenRef.current)) return;
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        if (!movingRef.current) void closePanel();
      }, FLOATING_BALL_CONSTANTS.closeDelayMs);
    }
  }

  async function openPanel() {
    if (panelOpenRef.current || movingRef.current) return;
    manualCollapseRef.current = false;
    clearTimeout(nearTimerRef.current);
    nearTimerRef.current = null;
    panelOpenRef.current = true;
    setPanelOpen(true);
    setStatus("near");
    if (!IS_TAURI_RUNTIME) return;
    try {
      const [position, monitor, scaleFactor] = await Promise.all([
        getFloatingWindowPosition(),
        getFloatingCurrentMonitor(),
        getFloatingScaleFactor(),
      ]);
      const factor = resolveScaleFactor(monitor, scaleFactor);
      const ballPosition = physicalToDipPosition(position, factor);
      const workArea = monitor ? monitorToWorkArea(monitor) : { x: 0, y: 0, width: 1920, height: 1080 };
      const nextDirection = getPanelDirection(placementRef.current, workArea, ballPosition);
      const geometry = getExpandedWindowGeometry(ballPosition, nextDirection, {}, workArea);
      anchorPositionRef.current = ballPosition;
      anchorScaleFactorRef.current = factor;
      directionRef.current = nextDirection;
      setDirection(nextDirection);
      setBallOffset({ x: geometry.ballOffsetX, y: geometry.ballOffsetY });
      const physicalSize = dipToPhysicalSize(geometry, factor);
      const physicalPosition = dipToPhysicalPosition(geometry, factor);
      await resizeFloatingWindow(physicalSize.width, physicalSize.height);
      await moveFloatingWindow(physicalPosition.x, physicalPosition.y);
    } catch {
      panelOpenRef.current = false;
      setPanelOpen(false);
      anchorPositionRef.current = null;
      anchorScaleFactorRef.current = null;
      setBallOffset({ x: 0, y: 0 });
      showFeedback("最近记录面板无法展开，请重试", "error");
    }
  }

  async function closePanel(explicit = false) {
    if (!panelOpenRef.current) return;
    if (explicit) manualCollapseRef.current = true;
    clearTimeout(nearTimerRef.current);
    nearTimerRef.current = null;
    clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    let closeFailed = false;
    if (IS_TAURI_RUNTIME) {
      try {
        const [position, monitor, scaleFactor] = await Promise.all([
          getFloatingWindowPosition(),
          getFloatingCurrentMonitor(),
          getFloatingScaleFactor(),
        ]);
        const factor = anchorScaleFactorRef.current || resolveScaleFactor(monitor, scaleFactor);
        const currentPosition = physicalToDipPosition(position, factor);
        const collapsed = anchorPositionRef.current || currentPosition;
        const physicalPosition = dipToPhysicalPosition(collapsed, factor);
        const physicalSize = dipToPhysicalSize(
          { width: FLOATING_BALL_CONSTANTS.ballSizeDip, height: FLOATING_BALL_CONSTANTS.ballSizeDip },
          factor,
        );
        await moveFloatingWindow(physicalPosition.x, physicalPosition.y);
        await resizeFloatingWindow(physicalSize.width, physicalSize.height);
      } catch {
        closeFailed = true;
        showFeedback("悬浮球窗口无法收起，请重试", "error");
      }
    }
    panelOpenRef.current = false;
    setPanelOpen(false);
    anchorPositionRef.current = null;
    anchorScaleFactorRef.current = null;
    setBallOffset({ x: 0, y: 0 });
    setStatus(closeFailed ? "error" : movingRef.current ? "moving" : "idle");
  }

  function handleDropEvent(event) {
    const type = event.payload?.type;
    if (type === "enter" || type === "over") {
      setStatus("drag-over");
      return;
    }
    if (type === "leave") {
      if (!recordingRef.current) setStatus(panelOpenRef.current ? "near" : "idle");
      return;
    }
    if (type === "drop") {
      void recordPaths(event.payload?.paths || []);
    }
  }

  function recordPaths(paths) {
    const nextPaths = mergePendingPaths([], paths);
    if (!nextPaths.length) {
      showFeedback("没有找到可记录的路径", "error");
      return;
    }
    if (recordingRef.current) {
      pendingPathsRef.current = mergePendingPaths(pendingPathsRef.current, nextPaths);
      return;
    }
    void processRecordPaths(nextPaths);
  }

  async function processRecordPaths(paths) {
    recordingRef.current = true;
    setStatus("recording");
    setFeedback("正在记录资料...");
    try {
      const result = await recordFloatingPaths(paths);
      setRecent(getRecentEntries(result.recent));
      showFeedback(getRecordMessage(result), getRecordStatus(result));
    } catch (error) {
      showFeedback(typeof error === "string" ? error : "悬浮球记录失败，请重试", "error");
    } finally {
      recordingRef.current = false;
      const pendingPaths = pendingPathsRef.current;
      pendingPathsRef.current = [];
      if (pendingPaths.length) void processRecordPaths(pendingPaths);
    }
  }

  function handleBrowserDrop(event) {
    if (IS_TAURI_RUNTIME) return;
    event.preventDefault();
    const files = [...(event.dataTransfer?.files || [])].slice(0, 8);
    if (!files.length) return;
    const timestamp = Date.now();
    const additions = files.map((file, index) => ({
      id: `floating-demo-${timestamp}-${index}`,
      name: file.name || "未命名资料",
      type: "演示记录",
      kind: "other",
      status: "已记录",
      invalid: false,
      recordedAt: timestamp + index,
    }));
    setRecent((current) => getRecentEntries([...additions, ...current]));
    showFeedback(`演示记录 ${additions.length} 项`, "recorded");
  }

  async function handleOpenFile(entry) {
    if (entry.invalid) {
      showFeedback("该记录的路径已失效，请在主窗口中重新定位", "partial-error");
    }
    if (!IS_TAURI_RUNTIME) return;
    try {
      await closePanel();
      await openMainFromFloating(entry.id);
    } catch (error) {
      showFeedback(typeof error === "string" ? error : "主窗口无法打开该资料", "error");
    }
  }

  function handleBallPointerDown(event) {
    if (!IS_TAURI_RUNTIME || event.button !== 0) return;
    pointerStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    dragStartedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleBallPointerMove(event) {
    const start = pointerStartRef.current;
    if (!IS_TAURI_RUNTIME || !start || start.id !== event.pointerId || dragStartedRef.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
    dragStartedRef.current = true;
    dragMovedRef.current = true;
    movingRef.current = true;
    setMoving(true);
    setStatus("moving");
    clearTimeout(nearTimerRef.current);
    clearTimeout(closeTimerRef.current);
    dragPrepareRef.current = panelOpenRef.current ? closePanel() : Promise.resolve();
    void dragPrepareRef.current.then(() => startFloatingDrag()).catch(() => {
      movingRef.current = false;
      setMoving(false);
      showFeedback("悬浮球无法移动，请重试", "error");
    });
  }

  function handleBallPointerUp(event) {
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerStartRef.current = null;
    if (!dragStartedRef.current) {
      movingRef.current = false;
      setMoving(false);
      return;
    }
    if (movingRef.current) schedulePlacementSave();
  }

  function handleBallClick() {
    if (movingRef.current) {
      if (dragMovedRef.current || dragStartedRef.current) return;
      clearTimeout(placementTimerRef.current);
      movingRef.current = false;
      setMoving(false);
    }
    if (panelOpenRef.current) void closePanel(true);
    else void openPanel();
  }

  function schedulePlacementSave(position) {
    if (!IS_TAURI_RUNTIME || !movingRef.current) return;
    clearTimeout(placementTimerRef.current);
    placementTimerRef.current = window.setTimeout(() => void finishMove(position), FLOATING_BALL_CONSTANTS.placementSaveDebounceMs);
  }

  async function finishMove(lastPosition) {
    let saveFailed = false;
    try {
      const [currentPosition, monitor, scaleFactor] = await Promise.all([
        lastPosition ? Promise.resolve(lastPosition) : getFloatingWindowPosition(),
        getFloatingCurrentMonitor(),
        getFloatingScaleFactor(),
      ]);
      const factor = resolveScaleFactor(monitor, scaleFactor);
      const workArea = monitor ? monitorToWorkArea(monitor) : { x: 0, y: 0, width: 1920, height: 1080 };
      const currentPositionDip = physicalToDipPosition(currentPosition, factor);
      const nextPlacement = getSnapPlacement(
        currentPositionDip,
        workArea,
        monitor?.name || "primary",
      );
      const savedPlacement = await saveFloatingPlacement(nextPlacement);
      placementRef.current = savedPlacement;
      setPlacement(savedPlacement);
      setDirection(getPanelDirection(savedPlacement, workArea, currentPositionDip));
      setFeedback("");
    } catch {
      saveFailed = true;
      showFeedback("位置无法保存，下次启动可能回到安全默认位置", "error");
    } finally {
      movingRef.current = false;
      dragMovedRef.current = false;
      setMoving(false);
      setStatus(saveFailed ? "error" : nearRef.current ? "near" : "idle");
    }
  }

  function handleBallKeyDown(event) {
    if (event.key === "Escape" || event.key === "Esc") {
      event.preventDefault();
      void closePanel(true);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      if (panelOpenRef.current) void closePanel();
      else void openPanel();
    }
  }

  function handlePointerEnter() {
    if (!IS_TAURI_RUNTIME) scheduleNear(true);
  }

  function handlePointerLeave() {
    if (!IS_TAURI_RUNTIME) scheduleNear(false);
  }

  const panel = panelOpen ? (
    <FloatingBallPanel
      recent={recent}
      status={status}
      feedback={feedback}
      favoriteBusyId={favoriteBusyId}
      onOpenFile={handleOpenFile}
      onToggleFavorite={handleFavorite}
    />
  ) : null;
  const ball = (
    <button
      type="button"
      className={`floating-ball-trigger ${moving ? "is-moving" : ""} status-${status}`}
      aria-label={feedback ? `悬浮球：${feedback}` : "悬浮球，打开最近记录"}
      title={feedback || "打开最近记录"}
      aria-expanded={panelOpen}
      data-testid="floating-ball-trigger"
      onPointerDown={handleBallPointerDown}
      onPointerMove={handleBallPointerMove}
      onPointerUp={handleBallPointerUp}
      style={{ "--floating-ball-offset-x": `${ballOffset.x}px`, "--floating-ball-offset-y": `${ballOffset.y}px` }}
      onClick={handleBallClick}
      onKeyDown={handleBallKeyDown}
    >
      {status === "recording" ? <SpinnerGap className="is-spinning" size={27} weight="bold" /> : <ArchiveTrayIcon size={28} weight="regular" />}
      <span className="sr-only">{feedback || (status === "drag-over" ? "可放置文件" : "准备记录文件")}</span>
    </button>
  );

  return (
    <div
      className={`floating-ball-window ${panelOpen ? "is-panel-open" : ""} ${IS_TAURI_RUNTIME ? "" : "is-browser-demo"} direction-${direction}`}
      data-testid="floating-ball-window"
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onDragOver={IS_TAURI_RUNTIME ? undefined : (event) => event.preventDefault()}
      onDrop={handleBrowserDrop}
    >
      {direction === "left" || direction === "up" ? panel : null}
      {ball}
      {direction === "right" || direction === "down" ? panel : null}
      {status === "error" && <WarningCircle className="floating-ball-error-mark" size={14} weight="fill" aria-hidden="true" />}
      {panelOpen && <button type="button" className="floating-ball-close-hint" aria-label="收起最近记录" title="收起" onClick={() => void closePanel(true)}><X size={13} weight="bold" /></button>}
      <span className="sr-only" aria-live="polite">{feedback}</span>
      <CheckCircle className="floating-ball-success-mark" size={14} weight="fill" aria-hidden="true" />
    </div>
  );
}

function resolveScaleFactor(monitor, windowScaleFactor) {
  const factor = Number(monitor?.scaleFactor ?? windowScaleFactor);
  return factor > 0 ? factor : 1;
}
