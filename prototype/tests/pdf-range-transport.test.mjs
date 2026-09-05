import assert from "node:assert/strict";
import test from "node:test";
import { makeRangePdf as makePdf } from "./fixtures/preview/rangePdf.js";
import { getDocument } from "pdfjs-dist";
import { createPdfRangeTransport, MAX_PDF_RANGE_BYTES, PDF_RANGE_CHUNK_BYTES } from "../src/features/preview/pdfRangeTransport.js";

function fetchBytes(bytes, requests) {
  return async (_url, { headers, signal }) => {
    assert.equal(signal.aborted, false);
    const [_, beginText, endText] = /^bytes=(\d+)-(\d+)$/.exec(headers.Range);
    const begin = Number(beginText), end = Number(endText);
    assert.ok(end - begin + 1 <= MAX_PDF_RANGE_BYTES);
    requests.push([begin, end]);
    return new Response(bytes.slice(begin, end + 1), { status: 206, headers: {
      "Content-Range": `bytes ${begin}-${end}/${bytes.length}`,
      "Content-Length": String(end - begin + 1),
    } });
  };
}

for (const large of [false, true]) {
  test(`real PDF.js reads ${large ? "large tail-xref" : "small"} PDF through bounded ranges`, async () => {
    const bytes = await makePdf(large), requests = [];
    if (large) {
      assert.ok(bytes.length > 1024 * 1024);
      const xref = /startxref\s+(\d+)/.exec(new TextDecoder().decode(bytes.slice(-100)));
      assert.ok(Number(xref[1]) > 1024 * 1024);
      const truncated = getDocument({ data: bytes.slice(0, 1024 * 1024), isEvalSupported: false });
      try {
        await assert.rejects(async () => {
          const document = await truncated.promise;
          const page = await document.getPage(2);
          await page.getTextContent();
        });
      } finally { await truncated.destroy(); }
    }
    const range = createPdfRangeTransport({ url: "http://preview.localhost/fixture", byteLength: bytes.length,
      fetchRange: fetchBytes(bytes, requests), onError: (error) => { throw error; } });
    const task = getDocument({ range, rangeChunkSize: PDF_RANGE_CHUNK_BYTES, disableStream: true,
      disableAutoFetch: true, isEvalSupported: false, useSystemFonts: true });
    try {
      const document = await task.promise;
      assert.equal(document.numPages, 2);
      const page = await document.getPage(2);
      assert.match((await page.getTextContent()).items.map((item) => item.str).join(""), /LAST PAGE CONTENT/);
      if (large) assert.ok(requests.some(([begin]) => begin >= 1024 * 1024));
    } finally { range.abort(); await task.destroy(); }
    const count = requests.length;
    range.requestDataRange(0, 10);
    assert.equal(requests.length, count);
  });
}

test("real PDF.js rejects corrupt input; transport rejects truncated and inconsistent responses", async () => {
  const bytes = new TextEncoder().encode("not a PDF");
  const range = createPdfRangeTransport({ url: "fixture", byteLength: bytes.length,
    fetchRange: fetchBytes(bytes, []), onError: (error) => { throw error; } });
  const task = getDocument({ range, disableStream: true, disableAutoFetch: true });
  try { await assert.rejects(task.promise, /Invalid PDF/); } finally { range.abort(); await task.destroy(); }
  for (const response of [
    new Response("short", { status: 200, headers: { "Content-Length": "100" } }),
    new Response("short", { status: 206, headers: { "Content-Length": "100", "Content-Range": "bytes 0-99/100" } }),
  ]) {
    let failed;
    const failure = new Promise((resolve) => { failed = resolve; });
    const transport = createPdfRangeTransport({ url: "fixture", byteLength: 100, fetchRange: async () => response, onError: failed });
    transport.requestDataRange(0, 100);
    assert.ok(await failure);
  }
});

test("destroy aborts pending fetches and splits a large PDF.js request into bounded bodies", async () => {
  let signal;
  const transport = createPdfRangeTransport({ url: "fixture", byteLength: 100, onError: assert.fail,
    fetchRange: (_url, options) => { signal = options.signal; return new Promise(() => {}); } });
  transport.requestDataRange(0, 100);
  transport.abort();
  assert.equal(signal.aborted, true);
  const bytes = new Uint8Array(MAX_PDF_RANGE_BYTES * 2 + 3), requests = [];
  let finished;
  const complete = new Promise((resolve) => { finished = resolve; });
  const chunked = createPdfRangeTransport({ url: "fixture", byteLength: bytes.length,
    fetchRange: fetchBytes(bytes, requests), onError: assert.fail });
  let received = 0;
  chunked.addRangeListener((_begin, data) => { received += data.length; if (received === bytes.length) finished(); });
  chunked.transportReady();
  chunked.requestDataRange(0, bytes.length);
  await complete;
  assert.equal(requests.length, 3);
  chunked.abort();
});
