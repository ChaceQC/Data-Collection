import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import { FloatingBallWindow } from "./features/floating-ball/FloatingBallWindow.jsx";
import "./styles.css";

const isFloatingBallWindow = new URLSearchParams(window.location.search).get("window") === "floating-ball"
  || window.__TAURI_INTERNALS__?.metadata?.currentWindow?.label === "floating-ball";

if (isFloatingBallWindow) {
  document.documentElement.dataset.window = "floating-ball";
}

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    {isFloatingBallWindow ? <FloatingBallWindow /> : <App />}
  </React.StrictMode>,
);
