import DOMPurify from "dompurify";
import { marked } from "marked";
import {
  DOCX_SANITIZE_BATCH_SIZE,
  getDocxOutputLimitReason,
} from "./docxRenderModel.js";

const FORBID_TAGS = [
  "script",
  "iframe",
  "object",
  "embed",
  "style",
  "link",
  "base",
  "meta",
  "form",
  "input",
  "button",
];
const ALLOWED_TAGS = [
  "a",
  "abbr",
  "b",
  "blockquote",
  "br",
  "code",
  "del",
  "details",
  "em",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "hr",
  "img",
  "li",
  "mark",
  "ol",
  "p",
  "pre",
  "s",
  "small",
  "strong",
  "sub",
  "summary",
  "sup",
  "table",
  "tbody",
  "td",
  "tfoot",
  "th",
  "thead",
  "tr",
  "ul",
];
const ALLOWED_ATTRIBUTES = ["alt", "class", "colspan", "height", "href", "id", "rel", "rowspan", "src", "start", "title", "width"];

export function isSafeLocalReference(value) {
  const normalized = String(value || "").trim();
  if (!normalized || normalized.includes("\\") || normalized.startsWith("/")) return false;
  if (normalized.startsWith("#")) return true;
  if (/^[a-z][a-z\d+.-]*:/i.test(normalized) || normalized.startsWith("//")) return false;
  return true;
}

function isEmbeddedImage(value) {
  return /^data:image\/(?:png|jpe?g|gif|webp|bmp);base64,/i.test(value);
}

function sanitizeHtml(html, { allowEmbeddedImages = false } = {}) {
  DOMPurify.addHook("uponSanitizeAttribute", (node, data) => {
    const attributeName = data.attrName.toLowerCase();
    const attributeValue = data.attrValue.trim();
    if (attributeName.startsWith("on") || attributeName === "srcset" || attributeName === "style") {
      data.keepAttr = false;
      return;
    }
    if (attributeName === "href" && !isSafeLocalReference(attributeValue)) {
      data.keepAttr = false;
      return;
    }
    if (attributeName === "src") {
      data.keepAttr = node.nodeName === "IMG" && allowEmbeddedImages && isEmbeddedImage(attributeValue);
    }
  });
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR: ALLOWED_ATTRIBUTES,
      ALLOW_DATA_ATTR: false,
      FORBID_TAGS,
      FORBID_ATTR: ["style", "srcset"],
      ALLOW_UNKNOWN_PROTOCOLS: false,
    });
  } finally {
    DOMPurify.removeAllHooks();
  }
}

export function renderMarkdown(value) {
  const html = marked.parse(value, { gfm: true, breaks: false });
  return sanitizeHtml(html);
}

export function sanitizeDocxHtml(html) {
  return sanitizeHtml(html, { allowEmbeddedImages: true });
}

function throwIfPreviewAborted(signal) {
  if (signal?.aborted) {
    const error = new Error("preview cancelled");
    error.name = "AbortError";
    throw error;
  }
}

function yieldToBrowser() {
  return new Promise((resolve) => window.setTimeout(resolve, 0));
}

function escapeText(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sanitizeDocxHtmlWithCancellation(html, { signal, batchSize = DOCX_SANITIZE_BATCH_SIZE } = {}) {
  const source = typeof html === "string" ? html : "";
  throwIfPreviewAborted(signal);
  const sourceLimitReason = getDocxOutputLimitReason(source);
  if (sourceLimitReason) {
    const error = new Error(sourceLimitReason);
    error.code = "output-too-large";
    throw error;
  }

  const template = document.createElement("template");
  template.innerHTML = source;
  const nodes = Array.from(template.content.childNodes);
  const chunks = [];
  const safeBatchSize = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : DOCX_SANITIZE_BATCH_SIZE;
  for (let index = 0; index < nodes.length; index += 1) {
    throwIfPreviewAborted(signal);
    const node = nodes[index];
    if (node.nodeType === 8 || node.nodeType === 10) continue;
    const serialized = node.nodeType === 3 ? escapeText(node.nodeValue) : node.outerHTML;
    chunks.push(sanitizeDocxHtml(serialized || ""));
    if ((index + 1) % safeBatchSize === 0) await yieldToBrowser();
  }
  throwIfPreviewAborted(signal);
  const sanitized = chunks.join("");
  const outputLimitReason = getDocxOutputLimitReason(sanitized);
  if (outputLimitReason) {
    const error = new Error(outputLimitReason);
    error.code = "output-too-large";
    throw error;
  }
  return sanitized;
}
