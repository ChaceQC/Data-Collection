const TEXT_DEFINITIONS = [
  ["txt", "text", "文本文件", null],
  ["text", "text", "文本文件", null],
  ["js", "text", "JavaScript", "javascript"],
  ["jsx", "text", "JSX", "javascript"],
  ["ts", "text", "TypeScript", "typescript"],
  ["tsx", "text", "TSX", "typescript"],
  ["py", "text", "Python", "python"],
  ["c", "text", "C", "c"],
  ["h", "text", "C 头文件", "c"],
  ["cc", "text", "C++", "cpp"],
  ["cpp", "text", "C++", "cpp"],
  ["cxx", "text", "C++", "cpp"],
  ["hpp", "text", "C++ 头文件", "cpp"],
  ["rs", "text", "Rust", "rust"],
  ["go", "text", "Go", "go"],
  ["java", "text", "Java", "java"],
  ["css", "text", "CSS", "css"],
  ["html", "text", "HTML 原文", "html"],
  ["xml", "text", "XML", "xml"],
  ["yaml", "text", "YAML", "yaml"],
  ["yml", "text", "YAML", "yaml"],
  ["toml", "text", "TOML", "toml"],
  ["ini", "text", "INI", "ini"],
  ["conf", "text", "配置文件", "ini"],
  ["sql", "text", "SQL", "sql"],
  ["json", "text", "JSON", "json"],
  ["jsonl", "text", "JSONL", "json"],
];

const REGISTRY = [
  ["md", "markdown", "Markdown", "markdown"],
  ["markdown", "markdown", "Markdown", "markdown"],
  ["docx", "docx", "Word 文档", "docx"],
  ["doc", "doc", "Word 文档", "doc"],
  ["xls", "xlsx", "Excel 工作簿", "xlsx"],
  ["xlsx", "xlsx", "Excel 工作簿", "xlsx"],
  ["pdf", "pdf", "PDF 文档", "pdf"],
  ["png", "image", "PNG 图片", "image"],
  ["jpg", "image", "JPEG 图片", "image"],
  ["jpeg", "image", "JPEG 图片", "image"],
  ["webp", "image", "WEBP 图片", "image"],
  ["gif", "image", "GIF 图片", "image"],
  ["bmp", "image", "BMP 图片", "image"],
  ["mp4", "video", "MP4 视频", "video"],
  ["webm", "video", "WEBM 视频", "video"],
  ...TEXT_DEFINITIONS,
].map(([extension, kind, displayType, previewer]) => ({
  extension,
  kind,
  displayType,
  previewer,
}));

const REGISTRY_BY_EXTENSION = new Map(REGISTRY.map((item) => [item.extension, item]));

export const PREVIEW_REGISTRY = Object.freeze(REGISTRY);

export function getExtension(fileName = "") {
  const dotIndex = fileName.lastIndexOf(".");
  return dotIndex >= 0 ? fileName.slice(dotIndex + 1).toLowerCase() : "";
}

export function getPreviewDefinition(entry) {
  if (!entry || entry.kind === "folder") return null;
  return REGISTRY_BY_EXTENSION.get(getExtension(entry.name)) || null;
}
