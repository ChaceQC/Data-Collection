import { useEffect, useRef, useState } from "react";
import {
  getFloatingCurrentMonitor,
  getFloatingScaleFactor,
  getFloatingWindowPosition,
  listenFloatingMoved,
  saveFloatingPlacement,
  startFloatingDrag,
} from "./floatingBallApi.js";
import {
  FLOATING_BALL_CONSTANTS,
  getPanelDirection,
  getSnapPlacement,
  physicalToDipPosition,
} from "./floatingBallModel.js";
import {
  FLOATING_PANEL_SIZE,
  resolveScaleFactor,
  resolveWorkArea,
} from "./useFloatingBallWindowGeometry.js";

export function useFloatingBallDrag({
  isTauriRuntime,
  nearRef,
  placementRef,
  setFeedback,
  setPlacement,
  setStatus,
  showFeedback,
  startControllerDrag,
  endControllerDrag,
  updateDirection,
}) {
  const [moving, setMoving] = useState(false);
  const showFeedbackRef = useRef(showFeedback);
  const movingRef = useRef(false);
  const pointerStartRef = useRef(null);
  const dragMovedRef = useRef(false);
  const dragStartedRef = useRef(false);
  const dragEndedRef = useRef(false);
  const nativeDragStartedRef = useRef(false);
  const placementTimerRef = useRef(null);
  const disposedRef = useRef(false);
  showFeedbackRef.current = showFeedback;

  useEffect(() => {
    disposedRef.current = false;
    if (!isTauriRuntime) return undefined;
    let disposed = false;
    let unlisten;
    listenFloatingMoved((event) => {
      if (disposed || disposedRef.current || !nativeDragStartedRef.current) return;
      dragMovedRef.current = true;
      schedulePlacementSave(event.payload);
    })
      .then((stop) => {
        if (disposed) stop();
        else unlisten = stop;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
      disposedRef.current = true;
      clearTimeout(placementTimerRef.current);
      endControllerDrag({ reopen: false });
    };
  }, [endControllerDrag, isTauriRuntime]);

  function handleBallPointerDown(event) {
    if (disposedRef.current || !isTauriRuntime || event.button !== 0) return;
    pointerStartRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
    dragMovedRef.current = false;
    dragStartedRef.current = false;
    dragEndedRef.current = false;
    nativeDragStartedRef.current = false;
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }

  function handleBallPointerMove(event) {
    const start = pointerStartRef.current;
    if (disposedRef.current || !isTauriRuntime || !start || start.id !== event.pointerId || dragStartedRef.current) return;
    if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 6) return;
    dragStartedRef.current = true;
    dragMovedRef.current = true;
    movingRef.current = true;
    setMoving(true);
    setStatus("moving");
    void startControllerDrag()
      .then(async (prepared) => {
        if (disposedRef.current || !prepared || dragEndedRef.current || !movingRef.current) {
          if (!prepared || dragEndedRef.current) {
            movingRef.current = false;
            setMoving(false);
          }
          return;
        }
        // Mark the native drag before handing control to Windows. The native
        // message can produce Moved events before the IPC promise settles.
        nativeDragStartedRef.current = true;
        await startFloatingDrag();
        if (dragEndedRef.current || !movingRef.current) return;
      })
      .catch(() => {
        if (disposedRef.current) return;
        endControllerDrag({ reopen: false });
        nativeDragStartedRef.current = false;
        movingRef.current = false;
        setMoving(false);
        showFeedbackRef.current("悬浮球无法移动，请重试", "error");
      });
  }

  function handleBallPointerUp(event) {
    if (disposedRef.current) return;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    pointerStartRef.current = null;
    const wasDrag = dragStartedRef.current;
    dragStartedRef.current = false;
    if (!wasDrag) return;
    dragEndedRef.current = true;
    endControllerDrag();
    if (nativeDragStartedRef.current) {
      schedulePlacementSave();
    } else {
      movingRef.current = false;
      setMoving(false);
    }
  }

  function handleBallPointerCancel(event) {
    handleBallPointerUp(event);
  }

  function handleBallClick(toggle) {
    if (disposedRef.current || dragMovedRef.current || movingRef.current) return;
    void toggle();
  }

  function schedulePlacementSave(position) {
    if (disposedRef.current || !isTauriRuntime || !nativeDragStartedRef.current) return;
    clearTimeout(placementTimerRef.current);
    placementTimerRef.current = window.setTimeout(() => void finishMove(position), FLOATING_BALL_CONSTANTS.placementSaveDebounceMs);
  }

  async function finishMove(lastPosition) {
    if (disposedRef.current) return;
    let saveFailed = false;
    try {
      const [currentPosition, monitor, scaleFactor] = await Promise.all([
        lastPosition ? Promise.resolve(lastPosition) : getFloatingWindowPosition(),
        getFloatingCurrentMonitor(),
        getFloatingScaleFactor(),
      ]);
      const factor = resolveScaleFactor(monitor, scaleFactor);
      const workArea = resolveWorkArea(monitor, factor);
      const currentPositionDip = physicalToDipPosition(currentPosition, factor);
      const nextPlacement = getSnapPlacement(
        currentPositionDip,
        workArea,
        monitor?.name || "primary",
      );
      const savedPlacement = await saveFloatingPlacement(nextPlacement);
      if (disposedRef.current) return;
      placementRef.current = savedPlacement;
      setPlacement(savedPlacement);
      updateDirection(getPanelDirection(savedPlacement, workArea, currentPositionDip, FLOATING_PANEL_SIZE));
      setFeedback("");
    } catch {
      if (disposedRef.current) return;
      saveFailed = true;
      showFeedbackRef.current("位置无法保存，下次启动可能回到安全默认位置", "error");
    } finally {
      if (disposedRef.current) return;
      // Windows may finish the non-client drag without sending pointerup back
      // to the WebView. The debounced final position is therefore also the
      // authoritative drag-end signal.
      endControllerDrag();
      nativeDragStartedRef.current = false;
      dragMovedRef.current = false;
      movingRef.current = false;
      setMoving(false);
      setStatus(saveFailed ? "error" : nearRef.current ? "near" : "idle");
    }
  }

  return {
    handleBallClick,
    handleBallPointerCancel,
    handleBallPointerDown,
    handleBallPointerMove,
    handleBallPointerUp,
    moving,
  };
}
