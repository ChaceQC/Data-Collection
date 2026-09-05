import { PDFDataRangeTransport } from "pdfjs-dist";

export const PDF_RANGE_CHUNK_BYTES = 64 * 1024;
export const MAX_PDF_RANGE_BYTES = 1024 * 1024;

// PDF.js 的 end 为开区间；协议每次只读取一个有界区间。
export function createPdfRangeTransport({ url, byteLength, onError, fetchRange = fetch }) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 1 || byteLength > 50 * 1024 * 1024) {
    throw new Error("invalid-pdf-length");
  }
  const requests = new Set();
  let stopped = false;
  const transport = new PDFDataRangeTransport(byteLength, new Uint8Array(), true);
  transport.abort = () => {
    stopped = true;
    for (const controller of requests) controller.abort();
    requests.clear();
  };
  transport.requestDataRange = (begin, end) => {
    if (stopped) return;
    const controller = new AbortController();
    requests.add(controller);
    void (async () => {
      if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end)
        || begin < 0 || end <= begin || end > byteLength) throw new Error("invalid-pdf-range");
      for (let offset = begin; offset < end;) {
        const last = Math.min(end, offset + MAX_PDF_RANGE_BYTES) - 1;
        const response = await fetchRange(url, {
          headers: { Range: `bytes=${offset}-${last}` }, signal: controller.signal,
        });
        const expectedLength = last - offset + 1;
        if (response.status !== 206
          || response.headers.get("Content-Range") !== `bytes ${offset}-${last}/${byteLength}`
          || response.headers.get("Content-Length") !== String(expectedLength)) {
          await response.body?.cancel();
          throw new Error("invalid-pdf-range-response");
        }
        const data = new Uint8Array(await response.arrayBuffer());
        if (data.length !== expectedLength) throw new Error("truncated-pdf-range");
        if (stopped) return;
        transport.onDataRange(offset, data);
        offset = last + 1;
      }
    })().catch((error) => {
      if (stopped) return;
      transport.abort();
      onError(error);
    }).finally(() => requests.delete(controller));
  };
  return transport;
}
