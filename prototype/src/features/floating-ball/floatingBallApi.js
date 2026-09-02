import {
  invokeCommand,
  isDesktopRuntime,
  parseFloatingFilesResult,
  parseFloatingRecentResult,
  parseFloatingRecordResult,
  parseWindowStatus,
} from "../../lib/ipcContracts.js";
import { normalizeFloatingFilesQuery } from "./floatingLibraryModel.js";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";

export function canUseFloatingBallRuntime() {
  return isDesktopRuntime();
}

export function loadFloatingPlacement() {
  return invokeCommand("load_floating_placement");
}

export function saveFloatingPlacement(placement) {
  return invokeCommand("save_floating_placement", { placement });
}

export function getFloatingRecent() {
  return invokeCommand("get_floating_recent", undefined, parseFloatingRecentResult);
}

export function getFloatingFiles(query = {}) {
  return invokeCommand("get_floating_files", normalizeFloatingFilesQuery(query), parseFloatingFilesResult);
}

export function recordFloatingPaths(paths) {
  return invokeCommand("record_floating_paths", { paths }, parseFloatingRecordResult);
}

export function openMainFromFloating(fileId) {
  return invokeCommand("open_main_from_floating", { fileId });
}

export function showMainWindow() {
  return invokeCommand("show_main_window");
}

export function listenFloatingEvent(eventName, handler) {
  return getCurrentWindow().listen(eventName, handler);
}

export function listenFloatingDrop(handler) {
  return getCurrentWebview().onDragDropEvent(handler);
}

export function listenFloatingMoved(handler) {
  return getCurrentWindow().onMoved(handler);
}

export function startFloatingDrag() {
  return getCurrentWindow().startDragging();
}

export function getFloatingWindowPosition() {
  return getCurrentWindow().outerPosition();
}

export function getFloatingCurrentMonitor() {
  return currentMonitor();
}

export function getFloatingScaleFactor() {
  return getCurrentWindow().scaleFactor();
}

export function resizeFloatingWindow(width, height) {
  return getCurrentWindow().setSize(new PhysicalSize(Math.round(width), Math.round(height)));
}

export function moveFloatingWindow(x, y) {
  return getCurrentWindow().setPosition(new PhysicalPosition(Math.round(x), Math.round(y)));
}
