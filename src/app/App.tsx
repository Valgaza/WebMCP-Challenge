import { Navigate, Route, Routes } from "react-router-dom";
import { ProjectHubPage } from "../pages/ProjectHubPage";
import { ProjectWorkspacePage } from "../pages/ProjectWorkspacePage";
import { WebMcpActivityCenter } from "../components/WebMcpActivityCenter";

export function App() {
  return (
    <>
      <Routes>
        <Route path="/projects" element={<ProjectHubPage />} />
        <Route path="/editor/:projectId" element={<ProjectWorkspacePage />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
      <WebMcpActivityCenter />
    </>
  );
}
