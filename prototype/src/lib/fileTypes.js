import manifest from "../../shared/file-types.json" with { type: "json" };

export const FILE_TYPE_MANIFEST = manifest;

export const FILE_TYPE_DEFINITIONS = Object.freeze(
  Object.entries(manifest.extensions).map(([extension, definition]) => Object.freeze({
    extension,
    ...definition,
    limitDefinition: manifest.limits[definition.limit] || null,
  })),
);

const DEFINITIONS_BY_EXTENSION = new Map(FILE_TYPE_DEFINITIONS.map((definition) => [definition.extension, definition]));

export const PREVIEW_LIMITS = Object.freeze(
  Object.entries(manifest.limits).map(([key, value]) => Object.freeze({ key, ...value })),
);

export function getExtension(fileName = "") {
  const source = String(fileName);
  const dotIndex = source.lastIndexOf(".");
  return dotIndex >= 0 ? source.slice(dotIndex + 1).toLowerCase() : "";
}

export function getFileTypeDefinition(fileName = "") {
  return DEFINITIONS_BY_EXTENSION.get(getExtension(fileName)) || null;
}

export function getFileKind(fileName = "") {
  return getFileTypeDefinition(fileName)?.kind || "other";
}

export function getFileType(fileName = "", kind = getFileKind(fileName)) {
  if (kind === "folder") return manifest.kinds.folder.fileType;
  return getFileTypeDefinition(fileName)?.fileType || manifest.kinds[kind]?.fileType || manifest.kinds.other.fileType;
}
