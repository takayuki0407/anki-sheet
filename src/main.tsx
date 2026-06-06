// MUST be first: installs the ReadableStream async-iterator polyfill before any
// pdf.js code runs, so PDF import works on iOS Safari (see src/polyfills.ts).
import "./polyfills";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
