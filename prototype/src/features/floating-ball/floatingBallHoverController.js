export const FLOATING_HOVER_STATES = Object.freeze([
  "collapsed",
  "hover-pending",
  "opening",
  "open",
  "close-pending",
  "closing",
  "dragging",
]);

const PANEL_VISIBLE_STATES = new Set(["opening", "open", "close-pending", "closing"]);

export function isFloatingPanelVisible(state) {
  return PANEL_VISIBLE_STATES.has(state);
}

export function createFloatingBallHoverController(options = {}) {
  const schedule = options.scheduler || {
    set: (callback, delay) => setTimeout(callback, delay),
    clear: (timer) => clearTimeout(timer),
  };
  const openDelayMs = Number.isFinite(options.openDelayMs) ? options.openDelayMs : 120;
  const closeDelayMs = Number.isFinite(options.closeDelayMs) ? options.closeDelayMs : 250;
  const onOpen = typeof options.onOpen === "function" ? options.onOpen : async () => true;
  const onClose = typeof options.onClose === "function" ? options.onClose : async () => true;
  const onStateChange = typeof options.onStateChange === "function" ? options.onStateChange : () => {};
  const onError = typeof options.onError === "function" ? options.onError : () => {};

  let state = "collapsed";
  let pointerInside = false;
  let near = false;
  let moving = false;
  let suppressOpen = false;
  let destroyed = false;
  let operationId = 0;
  let openTimer = null;
  let closeTimer = null;
  let operationPromise = null;

  function emitState(nextState) {
    if (state === nextState) return;
    const previous = state;
    state = nextState;
    try {
      onStateChange(nextState, previous);
    } catch {
      // State notifications must not break the hover lifecycle.
    }
  }

  function clearOpenTimer() {
    if (openTimer !== null) schedule.clear(openTimer);
    openTimer = null;
  }

  function clearCloseTimer() {
    if (closeTimer !== null) schedule.clear(closeTimer);
    closeTimer = null;
  }

  function invalidate() {
    operationId += 1;
    return operationId;
  }

  function hasPresence() {
    return pointerInside || near;
  }

  function isCurrent(candidate) {
    return !destroyed && candidate === operationId;
  }

  function scheduleOpen(reason = "hover") {
    if (destroyed || moving || suppressOpen || isFloatingPanelVisible(state) || state === "dragging") return;
    clearCloseTimer();
    if (openTimer !== null) return;
    emitState("hover-pending");
    openTimer = schedule.set(() => {
      openTimer = null;
      if (!hasPresence() || moving || suppressOpen || destroyed) {
        emitState("collapsed");
        return;
      }
      void beginOpen(reason);
    }, openDelayMs);
  }

  async function beginOpen(reason) {
    if (destroyed || moving || suppressOpen) return false;
    clearCloseTimer();
    const currentOperationId = invalidate();
    emitState("opening");
    const result = await settleOperation(onOpen({ operationId: currentOperationId, reason }));
    if (!isCurrent(currentOperationId) || state !== "opening") return false;
    if (result?.stale) return false;
    if (result === false) {
      fail("open", currentOperationId);
      return false;
    }
    emitState("open");
    return true;
  }

  function scheduleClose(reason = "leave") {
    if (destroyed || moving || !isFloatingPanelVisible(state)) return;
    clearOpenTimer();
    if (closeTimer !== null) return;
    emitState("close-pending");
    closeTimer = schedule.set(() => {
      closeTimer = null;
      if (hasPresence() || moving || destroyed) {
        if (!moving) emitState("open");
        return;
      }
      operationPromise = beginClose(reason);
    }, closeDelayMs);
  }

  async function beginClose(reason, explicit = false) {
    if (destroyed || moving) return false;
    clearOpenTimer();
    clearCloseTimer();
    if (explicit) suppressOpen = true;
    if (state === "collapsed") return true;
    if (state === "hover-pending") {
      emitState("collapsed");
      return true;
    }
    if (state === "closing" && operationPromise) return operationPromise;
    const currentOperationId = invalidate();
    emitState("closing");
    const result = await settleOperation(onClose({ operationId: currentOperationId, reason }));
    if (!isCurrent(currentOperationId) || state !== "closing") return false;
    if (result?.stale) return false;
    if (result === false) {
      fail("close", currentOperationId);
      return false;
    }
    emitState("collapsed");
    if (hasPresence() && !suppressOpen) scheduleOpen("reenter");
    return true;
  }

  function fail(phase, currentOperationId) {
    if (!isCurrent(currentOperationId)) return;
    if (phase === "open") emitState("collapsed");
    else emitState("open");
    reportError(phase, currentOperationId);
  }

  function reportError(phase, currentOperationId) {
    try {
      onError({ phase, operationId: currentOperationId });
    } catch {
      // Error reporting must not lock the floating ball in a transitional state.
    }
  }

  function pointerEnter() {
    if (destroyed) return;
    pointerInside = true;
    suppressOpen = false;
    if (state === "close-pending") {
      clearCloseTimer();
      emitState("open");
      return;
    }
    if (state === "closing") return;
    scheduleOpen("pointer");
  }

  function pointerLeave() {
    if (destroyed) return;
    pointerInside = false;
    suppressOpen = false;
    if (state === "hover-pending") {
      clearOpenTimer();
      emitState("collapsed");
      return;
    }
    if (isFloatingPanelVisible(state)) scheduleClose("leave");
  }

  function nearChanged(nextNear) {
    if (destroyed) return;
    near = Boolean(nextNear);
    if (!near) suppressOpen = false;
    if (near) {
      if (state === "close-pending") {
        clearCloseTimer();
        emitState("open");
      } else {
        scheduleOpen("near");
      }
      return;
    }
    if (!pointerInside && isFloatingPanelVisible(state)) scheduleClose("near-leave");
  }

  function openNow(reason = "explicit") {
    if (destroyed || moving) return Promise.resolve(false);
    suppressOpen = false;
    clearOpenTimer();
    clearCloseTimer();
    if (state === "open") return Promise.resolve(true);
    if (state === "closing") return operationPromise || Promise.resolve(false);
    return beginOpen(reason);
  }

  function toggle() {
    if (state === "collapsed" || state === "hover-pending") return openNow("explicit");
    return beginClose("toggle", true);
  }

  function explicitClose() {
    return beginClose("explicit", true);
  }

  async function beginDrag() {
    if (destroyed || moving) return false;
    moving = true;
    suppressOpen = true;
    clearOpenTimer();
    clearCloseTimer();
    const currentOperationId = invalidate();
    const shouldClose = isFloatingPanelVisible(state);
    if (!shouldClose) {
      emitState("dragging");
      return true;
    }
    emitState("closing");
    const result = await settleOperation(onClose({ operationId: currentOperationId, reason: "drag" }));
    if (!isCurrent(currentOperationId) || !moving) return false;
    if (result?.stale || result === false) {
      moving = false;
      fail("close", currentOperationId);
      return false;
    }
    emitState("dragging");
    return true;
  }

  function endDrag({ reopen = true } = {}) {
    if (destroyed || !moving) return;
    moving = false;
    invalidate();
    suppressOpen = !reopen;
    emitState("collapsed");
    if (reopen && hasPresence()) scheduleOpen("drag-end");
  }

  function dispose() {
    if (destroyed) return;
    destroyed = true;
    clearOpenTimer();
    clearCloseTimer();
    invalidate();
    moving = false;
    operationPromise = null;
  }

  function snapshot() {
    return {
      state,
      pointerInside,
      near,
      moving,
      suppressOpen,
      operationId,
      hasOpenTimer: openTimer !== null,
      hasCloseTimer: closeTimer !== null,
    };
  }

  return {
    beginDrag,
    dispose,
    endDrag,
    explicitClose,
    getState: () => state,
    getSnapshot: snapshot,
    isOperationCurrent: isCurrent,
    nearChanged,
    openNow,
    pointerEnter,
    pointerLeave,
    toggle,
  };
}

async function settleOperation(operation) {
  try {
    return await operation;
  } catch {
    return false;
  }
}
