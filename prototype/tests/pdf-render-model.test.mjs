import assert from "node:assert/strict";
import test from "node:test";
import {
  getPdfCanvasMetrics,
  PDF_CANVAS_PIXEL_LIMIT,
  PDF_PAGE_DIMENSION_LIMIT,
} from "../src/features/preview/pdfRenderModel.js";

test("keeps the CSS page size while rendering an A4 page at device pixel ratio 2", () => {
  assert.deepEqual(getPdfCanvasMetrics({ width: 612, height: 792 }, 2), {
    cssWidth: 612,
    cssHeight: 792,
    outputScale: 2,
    pixelWidth: 1224,
    pixelHeight: 1584,
  });
});

test("clamps the backing canvas to the page dimension and pixel limits", () => {
  const metrics = getPdfCanvasMetrics({ width: 4000, height: 4000 }, 2);
  assert.ok(metrics);
  assert.equal(metrics.cssWidth, 4000);
  assert.equal(metrics.cssHeight, 4000);
  assert.ok(metrics.pixelWidth <= PDF_PAGE_DIMENSION_LIMIT);
  assert.ok(metrics.pixelHeight <= PDF_PAGE_DIMENSION_LIMIT);
  assert.ok(metrics.pixelWidth * metrics.pixelHeight <= PDF_CANVAS_PIXEL_LIMIT);
});

test("rejects a page whose CSS dimensions already exceed the safe limit", () => {
  assert.equal(getPdfCanvasMetrics({ width: 8193, height: 100 }, 1), null);
  assert.equal(getPdfCanvasMetrics({ width: 5000, height: 5000 }, 1), null);
});
