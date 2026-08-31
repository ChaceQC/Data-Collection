import { FILE_TYPE_DEFINITIONS, getExtension } from "../../lib/fileTypes.js";

const REGISTRY = FILE_TYPE_DEFINITIONS
  .filter((definition) => definition.previewer)
  .map(({ extension, kind, displayType, previewer, language, mediaType, limitDefinition }) => ({
    extension,
    kind,
    displayType,
    previewer,
    language,
    mediaType,
    limit: limitDefinition,
  }));

const REGISTRY_BY_EXTENSION = new Map(REGISTRY.map((item) => [item.extension, item]));

export const PREVIEW_REGISTRY = Object.freeze(REGISTRY);

export { getExtension };

export function getPreviewDefinition(entry) {
  if (!entry || entry.kind === "folder") return null;
  return REGISTRY_BY_EXTENSION.get(getExtension(entry.name)) || null;
}
