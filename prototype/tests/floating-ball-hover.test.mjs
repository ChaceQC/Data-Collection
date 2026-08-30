import assert from "node:assert/strict";
import test from "node:test";
import {
  createFloatingBallHoverController,
  isFloatingPanelVisible,
} from "../src/features/floating-ball/floatingBallHoverController.js";

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

test("opens once after the delay and cancels the timer on leave", async () => {
  const opened = [];
  const controller = createFloatingBallHoverController({
    openDelayMs: 5,
    closeDelayMs: 5,
    onOpen: async (context) => {
      opened.push(context);
      return true;
    },
  });

  controller.pointerEnter();
  controller.pointerEnter();
  assert.equal(controller.getSnapshot().hasOpenTimer, true);
  await wait(15);
  assert.equal(opened.length, 1);
  assert.equal(controller.getState(), "open");
  controller.pointerLeave();
  await wait(15);
  assert.equal(controller.getState(), "collapsed");
  controller.dispose();
});

test("keeps the panel open while moving from the ball into the panel", async () => {
  const controller = createFloatingBallHoverController({ openDelayMs: 1, closeDelayMs: 8 });
  controller.pointerEnter();
  await wait(8);
  assert.equal(controller.getState(), "open");
  controller.pointerLeave();
  assert.equal(controller.getState(), "close-pending");
  controller.pointerEnter();
  await wait(15);
  assert.equal(controller.getState(), "open");
  assert.equal(isFloatingPanelVisible(controller.getState()), true);
  controller.dispose();
});

test("explicit close suppresses stale near events until a new enter", async () => {
  const controller = createFloatingBallHoverController({ openDelayMs: 2, closeDelayMs: 2 });
  controller.nearChanged(true);
  await wait(8);
  assert.equal(controller.getState(), "open");
  await controller.explicitClose();
  assert.equal(controller.getState(), "collapsed");
  controller.nearChanged(true);
  await wait(8);
  assert.equal(controller.getState(), "collapsed");
  controller.pointerEnter();
  await wait(8);
  assert.equal(controller.getState(), "open");
  controller.dispose();
});

test("dragging invalidates an opening operation and resumes hover after release", async () => {
  let resolveOpen;
  const opened = new Promise((resolve) => {
    resolveOpen = resolve;
  });
  const events = [];
  const controller = createFloatingBallHoverController({
    openDelayMs: 1,
    onOpen: () => opened,
    onStateChange: (state) => events.push(state),
  });
  controller.pointerEnter();
  await wait(5);
  assert.equal(controller.getState(), "opening");
  const dragging = controller.beginDrag();
  resolveOpen(true);
  assert.equal(await dragging, true);
  assert.equal(controller.getState(), "dragging");
  controller.endDrag();
  await wait(8);
  assert.equal(controller.getState(), "open");
  assert.ok(events.includes("dragging"));
  controller.dispose();
});

test("a failed close keeps the panel usable and reports the failure", async () => {
  const errors = [];
  const controller = createFloatingBallHoverController({
    openDelayMs: 1,
    onClose: async () => false,
    onError: (error) => errors.push(error),
  });
  controller.pointerEnter();
  await wait(5);
  assert.equal(controller.getState(), "open");
  assert.equal(await controller.explicitClose(), false);
  assert.equal(controller.getState(), "open");
  assert.deepEqual(errors.map((error) => error.phase), ["close"]);
  controller.dispose();
});
