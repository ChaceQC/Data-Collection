import mammoth from "mammoth/mammoth.browser.js";
import {
  DOCX_SOURCE_BYTE_LIMIT,
  getDocxOutputLimitReason,
  getDocxOutputMetrics,
} from "./docxRenderModel.js";

function postError(requestId, code, reason) {
  self.postMessage({ type: "error", requestId, code, reason });
}

self.onmessage = async (event) => {
  const data = event.data;
  if (data?.type !== "convert") return;
  const requestId = Number.isInteger(data.requestId) ? data.requestId : 0;
  if (!(data.buffer instanceof ArrayBuffer)) {
    postError(requestId, "invalid-source", "Word 文档资源无效，请重试。");
    return;
  }
  if (data.buffer.byteLength > DOCX_SOURCE_BYTE_LIMIT) {
    postError(requestId, "source-too-large", "Word 文档超过 20 MiB 预览限制，请使用系统程序打开。");
    return;
  }
  try {
    const result = await mammoth.convertToHtml({ arrayBuffer: data.buffer });
    const html = typeof result?.value === "string" ? result.value : "";
    const metrics = getDocxOutputMetrics(html);
    const limitReason = getDocxOutputLimitReason(html);
    if (limitReason) {
      postError(requestId, "output-too-large", limitReason);
      return;
    }
    self.postMessage({
      type: "result",
      requestId,
      html,
      warningCount: Array.isArray(result?.messages) ? result.messages.length : 0,
      outputBytes: metrics.byteLength,
      outputNodes: metrics.nodeCount,
    });
  } catch {
    postError(requestId, "parse-error", "Word 文档无法解析，请检查文件是否损坏或加密。");
  }
};
