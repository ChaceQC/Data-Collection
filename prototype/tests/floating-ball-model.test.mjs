import assert from "node:assert/strict";
import test from "node:test";
import {
  FLOATING_BALL_CONSTANTS,
  dipToPhysicalPosition,
  dipToPhysicalSize,
  getExpandedWindowGeometry,
  getFloatingLibraryCountPresentation,
  getNearState,
  getPanelDirection,
  getPlacementPosition,
  getRecentEntries,
  getRecordMessage,
  getRecordStatus,
  getSnapPlacement,
  mergePendingPaths,
  monitorToWorkArea,
  physicalToDipPosition,
} from "../src/features/floating-ball/floatingBallModel.js";

const workArea = { x: 0, y: 0, width: 1200, height: 800 };

test("limits recent entries to five, removes duplicate IDs, and sorts by millisecond time", () => {
  const entries = [
    { id: "a", name: "旧", recordedAt: 100 },
    { id: "a", name: "新", recordedAt: 300 },
    { id: "b", name: "二", recordedAt: 200 },
    { id: "c", name: "三", recordedAt: 500 },
    { id: "d", name: "四", recordedAt: 400 },
    { id: "e", name: "五", recordedAt: 600 },
    { id: "f", name: "六", recordedAt: 700 },
    { id: "never", name: "主窗口导入", recordedAt: 0 },
  ];
  const recent = getRecentEntries(entries);
  assert.deepEqual(recent.map((entry) => entry.id), ["f", "e", "c", "d", "a"]);
  assert.equal(recent.find((entry) => entry.id === "a").name, "新");
});

test("keeps library count badge states stable while loading, failing, and exceeding the display limit", () => {
  assert.deepEqual(getFloatingLibraryCountPresentation(null, "loading"), {
    state: "loading",
    display: "...",
    label: "正在读取文件库数量",
    value: null,
  });
  assert.deepEqual(getFloatingLibraryCountPresentation(null, "error"), {
    state: "error",
    display: "!",
    label: "文件库数量读取失败",
    value: null,
  });
  assert.deepEqual(getFloatingLibraryCountPresentation(12), {
    state: "ready",
    display: "12",
    label: "文件库共 12 项资料",
    value: 12,
  });
  assert.equal(getFloatingLibraryCountPresentation(1000).state, "overflow");
  assert.equal(getFloatingLibraryCountPresentation(1000).display, "999+");
});

test("uses hysteresis thresholds for near and leave transitions", () => {
  const bounds = { left: 100, top: 100, right: 164, bottom: 164 };
  assert.equal(getNearState({ x: 190, y: 132 }, bounds, false), true);
  assert.equal(getNearState({ x: 190, y: 132 }, bounds, true), true);
  assert.equal(getNearState({ x: 179, y: 132 }, bounds, true), true);
  assert.equal(getNearState({ x: 200, y: 132 }, bounds, true), false);
  assert.equal(FLOATING_BALL_CONSTANTS.enterNearDip, 28);
  assert.equal(FLOATING_BALL_CONSTANTS.leaveNearDip, 16);
});

test("selects panel directions from edge placements and free-space availability", () => {
  assert.equal(getPanelDirection({ mode: "edge", edge: "right" }, workArea, { x: 1100, y: 200 }), "left");
  assert.equal(getPanelDirection({ mode: "edge", edge: "top" }, workArea, { x: 200, y: 0 }), "right");
  assert.equal(getPanelDirection({ mode: "free" }, workArea, { x: 20, y: 20 }, {
    width: FLOATING_BALL_CONSTANTS.panelWidthDip,
    height: FLOATING_BALL_CONSTANTS.panelHeightDip,
  }), "right");
  assert.equal(getPanelDirection({ mode: "free" }, workArea, { x: 1100, y: 20 }), "left");
});

test("keeps the ball anchor and exposes host, ball, and panel rectangles", () => {
  const left = getExpandedWindowGeometry({ x: 900, y: 100 }, "left");
  assert.deepEqual(left.hostRect, { x: 540, y: 100, width: 424, height: 420 });
  assert.deepEqual(left.ballRect, { x: 900, y: 100, width: 64, height: 64 });
  assert.deepEqual(left.panelRect, { x: 540, y: 100, width: 360, height: 420 });
  assert.equal(left.ballOffsetX, 360);
  assert.equal(left.ballOffsetY, 0);

  const right = getExpandedWindowGeometry({ x: 100, y: 700 }, "right");
  assert.deepEqual(right.hostRect, { x: 100, y: 700, width: 424, height: 420 });
  assert.deepEqual(right.panelRect, { x: 164, y: 700, width: 360, height: 420 });
  assert.equal(right.ballOffsetX, 0);
  assert.equal(right.ballOffsetY, 0);

  const leftAtBottom = getExpandedWindowGeometry({ x: 900, y: 700 }, "left");
  assert.deepEqual(leftAtBottom.hostRect, { x: 540, y: 700, width: 424, height: 420 });
  assert.equal(leftAtBottom.ballOffsetX, 360);
  assert.equal(leftAtBottom.ballOffsetY, 0);
});

test("clamps an expanded host to the work area while preserving the ball anchor", () => {
  const geometry = getExpandedWindowGeometry(
    { x: 1136, y: 736 },
    "left",
    {},
    workArea,
  );
  assert.equal(geometry.y, 380);
  assert.equal(geometry.ballOffsetY, 356);
  assert.equal(geometry.x, 776);
  assert.deepEqual(geometry.panelRect, { x: 776, y: 380, width: 360, height: 420 });
});

test("expands inward from all four corners and keeps every rectangle in the work area", () => {
  const area = { x: -1280, y: -90, width: 1200, height: 800 };
  const cases = [
    [{ x: -1280, y: -90 }, "left", "right"],
    [{ x: -144, y: -90 }, "top", "left"],
    [{ x: -1280, y: 646 }, "bottom", "right"],
    [{ x: -144, y: 646 }, "right", "left"],
  ];
  for (const [position, edge, expectedDirection] of cases) {
    const direction = getPanelDirection({ mode: "edge", edge }, area, position);
    assert.equal(direction, expectedDirection);
    const geometry = getExpandedWindowGeometry(position, direction, {}, area);
    assertRectWithin(geometry.ballRect, area);
    assertRectWithin(geometry.panelRect, area);
    assertRectWithin(geometry.hostRect, area);
    assert.deepEqual(
      { x: geometry.ballRect.x, y: geometry.ballRect.y },
      {
        x: geometry.hostRect.x + geometry.ballOffsetX,
        y: geometry.hostRect.y + geometry.ballOffsetY,
      },
    );
  }
});

test("falls back and compresses the panel when the work area is smaller than the default host", () => {
  const area = { x: -900, y: -200, width: 300, height: 180 };
  const position = { x: -900, y: -200 };
  const direction = getPanelDirection({ mode: "edge", edge: "left" }, area, position);
  assert.equal(direction, "right");
  const geometry = getExpandedWindowGeometry(position, direction, {}, area);
  assert.ok(geometry.panelRect.width < FLOATING_BALL_CONSTANTS.panelWidthDip);
  assert.ok(geometry.panelRect.height < FLOATING_BALL_CONSTANTS.panelHeightDip);
  assertRectWithin(geometry.ballRect, area);
  assertRectWithin(geometry.panelRect, area);
  assertRectWithin(geometry.hostRect, area);
});

test("snaps close-to-edge positions and clamps free positions to the work area", () => {
  assert.deepEqual(
    getSnapPlacement({ x: 5, y: 300 }, workArea, "DISPLAY1"),
    { mode: "edge", monitorKey: "DISPLAY1", edge: "left", offsetDip: 300, xDip: null, yDip: null },
  );
  assert.deepEqual(
    getSnapPlacement({ x: 600, y: 400 }, workArea, "DISPLAY1"),
    { mode: "free", monitorKey: "DISPLAY1", edge: null, offsetDip: null, xDip: 600, yDip: 400 },
  );
  assert.deepEqual(
    getPlacementPosition({ mode: "free", xDip: 9999, yDip: 9999 }, workArea),
    { x: 1136, y: 736 },
  );
});

test("keeps monitor geometry stable when converting between DIP and physical pixels", () => {
  const monitor = {
    scaleFactor: 1.5,
    workArea: {
      position: { x: 1920, y: -90 },
      size: { width: 2560, height: 1350 },
    },
  };
  const workAreaAtDpi = monitorToWorkArea(monitor);
  assert.deepEqual(workAreaAtDpi, {
    x: 1280,
    y: -60,
    width: 1706.6666666666667,
    height: 900,
    scaleFactor: 1.5,
  });
  const physicalPosition = dipToPhysicalPosition({ x: 1280 + 300, y: -60 + 120 }, 1.5);
  assert.deepEqual(physicalPosition, { x: 2370, y: 90 });
  assert.deepEqual(physicalToDipPosition(physicalPosition, 1.5), { x: 1580, y: 60 });
  assert.deepEqual(dipToPhysicalSize({ width: 424, height: 420 }, 1.5), { width: 636, height: 630 });
});

test("uses the window DPI override for monitor work-area conversion", () => {
  const monitor = {
    scaleFactor: 1,
    workArea: {
      position: { x: 1920, y: -90 },
      size: { width: 2560, height: 1350 },
    },
  };
  assert.deepEqual(monitorToWorkArea(monitor, 1.5), {
    x: 1280,
    y: -60,
    width: 1706.6666666666667,
    height: 900,
    scaleFactor: 1.5,
  });
});

test("maps successful, partial, and failed records to explicit feedback states", () => {
  assert.equal(getRecordStatus({ recordedCount: 2, skippedCount: 0 }), "recorded");
  assert.equal(getRecordStatus({ recordedCount: 1, skippedCount: 1 }), "partial-error");
  assert.equal(getRecordStatus({ recordedCount: 0, skippedCount: 2 }), "error");
  assert.equal(getRecordMessage({ indexedCount: 1, refreshedCount: 1, skippedCount: 1 }), "新增 1 项，刷新 1 项，跳过 1 项");
});

test("queues rapid drop paths without duplicating already queued values", () => {
  assert.deepEqual(mergePendingPaths(["a", "b"], ["b", "c", "a", "d"]), ["a", "b", "c", "d"]);
});

function assertRectWithin(rect, area) {
  assert.ok(rect.x >= area.x - 0.0001);
  assert.ok(rect.y >= area.y - 0.0001);
  assert.ok(rect.x + rect.width <= area.x + area.width + 0.0001);
  assert.ok(rect.y + rect.height <= area.y + area.height + 0.0001);
}
