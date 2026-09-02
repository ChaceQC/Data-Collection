import { useEffect, useRef, useState } from "react";
import {
  getFloatingCurrentMonitor,
  getFloatingScaleFactor,
  getFloatingWindowPosition,
  moveFloatingWindow,
  resizeFloatingWindow,
} from "./floatingBallApi.js";
import {
  FLOATING_BALL_CONSTANTS,
  getExpandedWindowGeometry,
  getPanelDirection,
  dipToPhysicalPosition,
  dipToPhysicalSize,
  monitorToWorkArea,
  physicalToDipPosition,
} from "./floatingBallModel.js";

export const FLOATING_PANEL_SIZE = Object.freeze({
  width: FLOATING_BALL_CONSTANTS.panelWidthDip,
  height: FLOATING_BALL_CONSTANTS.panelHeightDip,
});

const FALLBACK_WORK_AREA = Object.freeze({
  x: 0,
  y: 0,
  width: 1920,
  height: 1080,
  scaleFactor: 1,
});

export function useFloatingBallWindowGeometry({ isTauriRuntime, placementRef, hoverController }) {
  const [direction, setDirection] = useState("left");
  const [layout, setLayout] = useState(null);
  const [layoutReady, setLayoutReady] = useState(!isTauriRuntime);
  const anchorPositionRef = useRef(null);
  const anchorScaleFactorRef = useRef(null);
  const windowTaskRef = useRef(Promise.resolve());
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  async function openPanelWindow({ operationId }) {
    if (disposedRef.current) return { stale: true };
    if (!isTauriRuntime) return true;
    setLayoutReady(false);
    return enqueueWindowTask(async () => {
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      const [position, monitor, scaleFactor] = await Promise.all([
        getFloatingWindowPosition(),
        getFloatingCurrentMonitor(),
        getFloatingScaleFactor(),
      ]);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      const factor = resolveScaleFactor(monitor, scaleFactor);
      const workArea = resolveWorkArea(monitor, factor);
      const ballPosition = physicalToDipPosition(position, factor);
      const nextDirection = getPanelDirection(
        placementRef.current,
        workArea,
        ballPosition,
        FLOATING_PANEL_SIZE,
      );
      const geometry = getExpandedWindowGeometry(
        ballPosition,
        nextDirection,
        FLOATING_PANEL_SIZE,
        workArea,
      );
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      anchorPositionRef.current = geometry.ballRect;
      anchorScaleFactorRef.current = factor;
      setDirection(nextDirection);
      setLayout(geometry);
      const physicalSize = dipToPhysicalSize(geometry.hostRect, factor);
      const physicalPosition = dipToPhysicalPosition(geometry.hostRect, factor);
      // Put the collapsed window inside the target work area before growing it.
      // Resizing first can make a near-edge window span another monitor and
      // trigger a DPI change before the final position is applied.
      await moveFloatingWindow(physicalPosition.x, physicalPosition.y);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      await resizeFloatingWindow(physicalSize.width, physicalSize.height);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      setLayoutReady(true);
      return true;
    });
  }

  async function closePanelWindow({ operationId }) {
    if (disposedRef.current) return { stale: true };
    if (!isTauriRuntime) {
      resetExpandedLayout();
      return true;
    }
    setLayoutReady(false);
    return enqueueWindowTask(async () => {
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      const [position, monitor, scaleFactor] = await Promise.all([
        getFloatingWindowPosition(),
        getFloatingCurrentMonitor(),
        getFloatingScaleFactor(),
      ]);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      const factor = anchorScaleFactorRef.current || resolveScaleFactor(monitor, scaleFactor);
      const currentPosition = physicalToDipPosition(position, factor);
      const collapsedPosition = anchorPositionRef.current || currentPosition;
      const physicalPosition = dipToPhysicalPosition(collapsedPosition, factor);
      const physicalSize = dipToPhysicalSize({
        width: FLOATING_BALL_CONSTANTS.ballSizeDip,
        height: FLOATING_BALL_CONSTANTS.ballSizeDip,
      }, factor);
      await moveFloatingWindow(physicalPosition.x, physicalPosition.y);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      await resizeFloatingWindow(physicalSize.width, physicalSize.height);
      if (disposedRef.current || !hoverController.isOperationCurrent(operationId)) return { stale: true };
      resetExpandedLayout();
      return true;
    });
  }

  function enqueueWindowTask(task) {
    const nextTask = windowTaskRef.current.then(task, task);
    windowTaskRef.current = nextTask.catch(() => undefined);
    return nextTask;
  }

  function resetExpandedLayout() {
    anchorPositionRef.current = null;
    anchorScaleFactorRef.current = null;
    setLayout(null);
    setLayoutReady(!isTauriRuntime);
  }

  return {
    closePanelWindow,
    direction,
    getLayoutStyle: () => getLayoutStyle(layout),
    layoutReady,
    openPanelWindow,
    resetExpandedLayout,
    updateDirection: setDirection,
  };
}

export function resolveWorkArea(monitor, scaleFactor) {
  if (!monitor) return { ...FALLBACK_WORK_AREA, scaleFactor };
  const workArea = { ...monitorToWorkArea(monitor, scaleFactor), scaleFactor };
  if (workArea.width <= 0 || workArea.height <= 0) return { ...FALLBACK_WORK_AREA, scaleFactor };
  return workArea;
}

export function resolveScaleFactor(monitor, windowScaleFactor) {
  const factor = Number(monitor?.scaleFactor ?? windowScaleFactor);
  return factor > 0 ? factor : 1;
}

function getLayoutStyle(layout) {
  if (!layout) return undefined;
  return {
    "--floating-ball-ball-x": `${layout.ballOffsetX}px`,
    "--floating-ball-ball-y": `${layout.ballOffsetY}px`,
    "--floating-ball-panel-x": `${layout.panelOffsetX}px`,
    "--floating-ball-panel-y": `${layout.panelOffsetY}px`,
    "--floating-ball-panel-width": `${layout.panelRect.width}px`,
    "--floating-ball-panel-height": `${layout.panelRect.height}px`,
  };
}
