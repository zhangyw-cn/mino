import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/index.css";
import { WorkbenchApp } from "./app/WorkbenchApp";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <WorkbenchApp />
  </StrictMode>,
);
