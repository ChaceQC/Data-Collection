import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const pdfjsRoot = path.join(projectRoot, "node_modules", "pdfjs-dist");
const pdfjsAssetDirectories = ["cmaps", "standard_fonts"];

export default defineConfig({
  build: {
    outDir: "dist/client",
  },
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    allowedHosts: ["terminal.local"],
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react(), pdfJsAssets()],
});

function pdfJsAssets() {
  const assets = pdfjsAssetDirectories.flatMap((directory) => collectAssets(path.join(pdfjsRoot, directory)));

  return {
    name: "local-material-workbench-pdfjs-assets",
    configureServer(server) {
      server.middlewares.use("/pdfjs", (request, response, next) => {
        let requestPath;
        try {
          requestPath = decodeURIComponent((request.url || "").split("?", 1)[0]).replace(/^\/+/, "");
        } catch {
          next();
          return;
        }
        const asset = assets.find(({ relativePath }) => relativePath === requestPath);
        if (!asset) {
          next();
          return;
        }
        response.statusCode = 200;
        response.setHeader("Cache-Control", "no-store");
        response.setHeader("Content-Type", "application/octet-stream");
        response.setHeader("Content-Length", asset.source.length);
        response.end(readFileSync(asset.source));
      });
    },
    generateBundle() {
      for (const asset of assets) {
        this.emitFile({
          type: "asset",
          fileName: `pdfjs/${asset.relativePath}`,
          source: readFileSync(asset.source),
        });
      }
    },
  };
}

function collectAssets(currentPath) {
  if (!existsSync(currentPath)) {
    throw new Error(`Missing pdfjs-dist asset directory: ${currentPath}`);
  }
  return readdirSync(currentPath, { withFileTypes: true }).flatMap((entry) => {
    const source = path.join(currentPath, entry.name);
    const relativePath = path.relative(pdfjsRoot, source).split(path.sep).join("/");
    return entry.isDirectory() ? collectAssets(source) : [{ relativePath, source }];
  });
}
