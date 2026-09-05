import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createServer } from "vite";
import { parseContentSearchResponse } from "../src/lib/ipcContracts.js";

test("actual content summary renders the Rust Unicode snippet contract", async () => {
  const server = await createServer({ server: { middlewareMode: true }, appType: "custom", logLevel: "error" });
  try {
    const { SearchHitSummary } = await server.ssrLoadModule("/src/features/library/LibraryPanelParts.jsx");
    const cases = JSON.parse(await readFile(new URL("../shared/content-snippet-cases.json", import.meta.url), "utf8"));
    for (const item of cases) {
      const hit = { fileId: "file-a", matchCount: item.matchCount, matchesTruncated: item.matchesTruncated, snippets: item.snippets };
      const response = parseContentSearchResponse({ requestId: "search-a", status: { state: "ready", indexedCount: 1, totalBytes: 10, failedCount: 0, sourceRevision: 1, cacheRevision: 1, lastError: null }, results: [hit] });
      const html = renderToStaticMarkup(createElement(SearchHitSummary, { entry: { id: "file-a" }, searchMode: "content", searchQuery: item.query, searchResult: response.results[0] }));
      assert.deepEqual([...html.matchAll(/<mark>(.*?)<\/mark>/g)].map((match) => match[1]), item.highlights, item.name);
    }
  } finally { await server.close(); }
});
