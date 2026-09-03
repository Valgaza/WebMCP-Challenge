import { Navigate, Route, Routes } from "react-router-dom";
import { LandingPage } from "../pages/LandingPage";
import { ProjectHubPage } from "../pages/ProjectHubPage";
import { ProjectWorkspacePage } from "../pages/ProjectWorkspacePage";
import { WebMcpActivityCenter } from "../components/WebMcpActivityCenter";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/projects" element={<ProjectHubPage />} />
        <Route path="/editor/:projectId" element={<ProjectWorkspacePage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <WebMcpActivityCenter />
    </>
  );
}
