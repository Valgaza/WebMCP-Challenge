import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { App } from "./app/App";
import {
  assetService, batchExportService, catalogueService, channelService, jobService,
  layerService, organizationService, outputService, packageService, presetService,
  projectService, reconcileAfterReload, renderService, reviewService, selectionService,
  workspaceService,
} from "./app/services";
import { applyAccessibilityRoot } from "./app/accessibility-root";
import { registerEstroSiteTools } from "./webmcp/site-tools";
import "./styles/index.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Estro could not find its application root.");
}

// Before anything renders, so the first paint is already in the mode the person needs.
applyAccessibilityRoot();

registerEstroSiteTools({
  service: projectService, workspaceService, assetService, jobService, layerService, renderService,
  organizationService, outputService, presetService, batchExportService, catalogueService,
  packageService, reviewService, selectionService, channelService,
});

// A previous session may have left staged bytes nothing references and jobs whose records
// still claim to be running. Reconciling before the first paint means the interface opens on
// the truth rather than on a frozen progress bar.
void reconcileAfterReload().catch(() => undefined);

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
