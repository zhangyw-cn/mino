import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "../styles/index.css";
import "./viewer.css";
import "highlight.js/styles/github-dark.min.css";
import "katex/dist/katex.min.css";
import { MarkdownViewer } from "./MarkdownViewer";

const rootEl = document.getElementById("root")!;
const initialPath = rootEl.getAttribute("data-path") || "";

createRoot(rootEl).render(
  <StrictMode>
    <MarkdownViewer initialPath={initialPath} />
  </StrictMode>,
);
