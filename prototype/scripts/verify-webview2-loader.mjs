import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const releaseDir = resolve(projectRoot, "src-tauri", "target", "release");
const loaderPath = resolve(releaseDir, "WebView2Loader.dll");
const options = parseOptions(process.argv.slice(2));

const loader = inspectPeFile(loaderPath, "WebView2Loader.dll");
if (loader.machine !== 0x8664) {
  throw new Error("WebView2Loader.dll 不是 Windows x64 架构");
}

const executableDir = options.installedDir
  ? resolve(options.installedDir)
  : releaseDir;
const executable = findApplicationExecutable(executableDir);
if (!executable) {
  throw new Error("找不到用于布局检查的应用主程序");
}
const executableMeta = inspectPeFile(executable, "应用主程序");
if (executableMeta.machine !== 0x8664) {
  throw new Error("应用主程序不是 Windows x64 架构");
}
const colocatedLoader = resolve(dirname(executable), "WebView2Loader.dll");
const colocated = inspectPeFile(colocatedLoader, "应用目录中的 WebView2Loader.dll");
if (colocated.machine !== 0x8664) {
  throw new Error("应用目录中的 WebView2Loader.dll 不是 Windows x64 架构");
}
if (colocated.hash !== loader.hash) {
  throw new Error("应用目录中的 WebView2Loader.dll 与构建输出不一致");
}

console.log(`WebView2Loader.dll: ${relative(projectRoot, loaderPath)}`);
console.log(`大小: ${loader.size} bytes`);
console.log(`SHA-256: ${loader.hash}`);
console.log(`应用目录布局: ${relative(projectRoot, dirname(executable))}`);
console.log("检查通过：loader 与应用主程序位于同一目录，目标架构为 Windows x64。");

function parseOptions(args) {
  const result = {};
  for (const arg of args) {
    if (arg.startsWith("--installed-dir=")) result.installedDir = arg.slice("--installed-dir=".length);
  }
  return result;
}

function inspectPeFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label}不存在`);
  const stat = statSync(path);
  if (!stat.isFile() || stat.size <= 0) throw new Error(`${label}为空或不是普通文件`);
  const bytes = readFileSync(path);
  if (bytes.length < 0x40 || bytes.toString("ascii", 0, 2) !== "MZ") {
    throw new Error(`${label}不是有效的 PE 文件`);
  }
  const peOffset = bytes.readUInt32LE(0x3c);
  if (peOffset < 0x40 || peOffset + 6 > bytes.length || bytes.toString("ascii", peOffset, peOffset + 4) !== "PE\u0000\u0000") {
    throw new Error(`${label}不是有效的 PE 文件`);
  }
  return {
    hash: createHash("sha256").update(bytes).digest("hex"),
    machine: bytes.readUInt16LE(peOffset + 4),
    size: bytes.length,
  };
}

function findApplicationExecutable(directory) {
  if (!existsSync(directory)) return null;
  const preferred = join(directory, "local-material-workbench.exe");
  if (existsSync(preferred) && statSync(preferred).isFile()) return preferred;
  const candidates = readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith(".exe"))
    .filter((name) => !name.toLowerCase().includes("uninstall"))
    .map((name) => join(directory, name));
  return candidates.find((path) => statSync(path).isFile()) || null;
}
