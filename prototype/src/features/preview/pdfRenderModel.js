export const PDF_PAGE_DIMENSION_LIMIT = 8192;
export const PDF_CANVAS_PIXEL_LIMIT = 16_777_216;

export function getPdfCanvasMetrics(viewport, devicePixelRatio = 1) {
  const cssWidth = Math.ceil(Number(viewport?.width));
  const cssHeight = Math.ceil(Number(viewport?.height));
  if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)
    || cssWidth < 1 || cssHeight < 1
    || cssWidth > PDF_PAGE_DIMENSION_LIMIT || cssHeight > PDF_PAGE_DIMENSION_LIMIT
    || cssWidth * cssHeight > PDF_CANVAS_PIXEL_LIMIT) {
    return null;
  }

  const safeDevicePixelRatio = Number.isFinite(Number(devicePixelRatio)) && Number(devicePixelRatio) > 0
    ? Number(devicePixelRatio)
    : 1;
  const maximumOutputScale = Math.min(
    PDF_PAGE_DIMENSION_LIMIT / cssWidth,
    PDF_PAGE_DIMENSION_LIMIT / cssHeight,
    Math.sqrt(PDF_CANVAS_PIXEL_LIMIT / (cssWidth * cssHeight)),
  );
  if (!Number.isFinite(maximumOutputScale) || maximumOutputScale < 1) return null;

  const outputScale = Math.min(safeDevicePixelRatio, maximumOutputScale);
  return {
    cssWidth,
    cssHeight,
    outputScale,
    pixelWidth: Math.max(1, Math.floor(cssWidth * outputScale)),
    pixelHeight: Math.max(1, Math.floor(cssHeight * outputScale)),
  };
}
