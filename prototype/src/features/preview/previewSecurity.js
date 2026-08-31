import DOMPurify from "dompurify";
import { marked } from "marked";

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
