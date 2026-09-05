async (page) => {
  // CLI 沙箱未提供 Buffer 全局，使用 Playwright 响应的公开二进制类型。
  const Buffer = (await (await page.request.get("http://127.0.0.1:49341/")).body()).constructor;
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const pdf = await page.evaluate(async () => {
    const { makeRangePdf } = await import("/tests/fixtures/preview/rangePdf.js");
    return Array.from(await makeRangePdf(true));
  });
  const video = await page.evaluate(async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 512; canvas.height = 512;
    const context = canvas.getContext("2d");
    const pixels = context.createImageData(512, 512);
    const words = new Uint32Array(pixels.data.buffer);
    let seed = 1;
    const draw = () => {
      for (let i = 0; i < words.length; i += 1) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        words[i] = seed | 0xff000000;
      }
      context.putImageData(pixels, 0, 0);
    };
    draw();
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8", videoBitsPerSecond: 12_000_000 });
    const chunks = [];
    recorder.ondataavailable = (event) => chunks.push(event.data);
    const stopped = new Promise((resolve) => { recorder.onstop = resolve; });
    const timer = setInterval(draw, 33);
    recorder.start();
    await new Promise((resolve) => setTimeout(resolve, 2300));
    recorder.stop(); await stopped; clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    return Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer()));
  });
  if (video.length <= 1024 * 1024) throw new Error("Video fixture must exceed the protocol chunk limit");
  let bytes = pdf, mediaType = "application/pdf";
  const requests = [];
  await page.route("http://preview.localhost/**", async (route) => {
    const request = route.request();
    const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Range", "Access-Control-Expose-Headers": "Content-Length, Content-Range", "Accept-Ranges": "bytes", "Content-Type": mediaType };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers });
    const range = request.headers().range;
    requests.push({ range, mediaType });
    if (!range) return route.fulfill({ status: 400, headers, body: "" });
    const match = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (!match) throw new Error("Unexpected browser range");
    const start = Number(match[1]), end = Math.min(bytes.length - 1, start + 1024 * 1024 - 1, match[2] ? Number(match[2]) : Infinity);
    return route.fulfill({ status: 206, headers: { ...headers, "Content-Length": String(end - start + 1), "Content-Range": `bytes ${start}-${end}/${bytes.length}` }, body: Buffer.from(bytes.slice(start, end + 1)) });
  });
  await page.evaluate(async () => {
    const ReactModule = await import("/node_modules/.vite/deps/react.js");
    const React = ReactModule.default || ReactModule;
    const dom = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { createRoot } = dom.default || dom;
    const host = document.createElement("div");
    document.body.replaceChildren(host);
    window.consumer = { React, root: createRoot(host), ready: 0, failure: null };
  });
  const render = async (type, length) => page.evaluate(async ({ type, length }) => {
    const { React, root } = window.consumer;
    window.consumer.ready = 0; window.consumer.failure = null;
    const Component = type === "video"
      ? (await import("/src/features/preview/VideoPreviewer.jsx")).VideoPreviewer
      : (await import("/src/features/preview/PdfPreviewer.jsx")).PdfPreviewer;
    root.render(React.createElement(Component, { key: type,
      content: { type: type === "convertedPdf" ? type : "resource", resourceUrl: `http://preview.localhost/preview-${"a".repeat(32)}`, byteLength: length, supportsRange: true },
      onReady: () => { window.consumer.ready += 1; },
      onFailure: (status) => { window.consumer.failure = status; },
    }));
  }, { type, length });
  for (const type of ["pdf", "convertedPdf"]) {
    await render(type, pdf.length);
    await page.waitForFunction(() => window.consumer.ready > 0 || window.consumer.failure);
    if (await page.evaluate(() => window.consumer.failure)) throw new Error("PDF component failed");
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await page.waitForFunction(() => window.consumer.ready > 1);
    const ink = await page.locator("canvas").evaluate((canvas) => {
      const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (pixels[i] < 100 && pixels[i + 3] > 0) count += 1;
      return count;
    });
    if (ink < 100) throw new Error("Blank PDF canvas");
    await page.screenshot({ path: `output/playwright/phase-a-${type}.png` });
  }
  bytes = video; mediaType = "video/webm";
  await render("video", video.length);
  await page.waitForFunction(() => window.consumer.ready > 0 || window.consumer.failure);
  if (await page.evaluate(() => window.consumer.failure)) throw new Error("Video metadata failed");
  await page.locator("video").evaluate(async (element) => {
    element.muted = true;
    await element.play();
    element.currentTime = 1.5;
  });
  await page.waitForFunction(() => document.querySelector("video").currentTime >= 1.5 && document.querySelector("video").readyState >= 2);
  await page.locator("video").evaluate((element) => element.pause());
  const mediaRequests = requests.filter((item) => item.mediaType === "video/webm");
  if (!mediaRequests.length || mediaRequests.some((item) => !item.range)) throw new Error("Video did not use explicit ranges");
  await page.route("http://preview.localhost/**", (route) => route.fulfill({ status: 404, headers: { "Access-Control-Allow-Origin": "*" } }));
  await page.locator("video").evaluate((element) => { element.src += "?expired"; element.load(); });
  await page.waitForFunction(() => window.consumer.failure === "parse-error");
  await page.evaluate(() => window.consumer.root.unmount());
  if (errors.length) throw new Error(errors.join("\n"));
  return { pdfBytes: pdf.length, videoBytes: video.length, pdfRequests: requests.length - mediaRequests.length, videoRequests: mediaRequests.length, rendered: ["pdf-page-2", "converted-pdf-page-2"], video: "metadata-seek-error-passed" };
}
