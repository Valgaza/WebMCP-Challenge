import {
  AlertTriangle,
  Check,
  Clock3,
  Database,
  Folder,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { ProjectLifecycleService, ProjectPersistenceService } from "../application/project-service";
import { DeleteProjectDialog } from "../components/DeleteProjectDialog";
import { ProjectActionsMenu } from "../components/ProjectActionsMenu";
import { ProjectNameDialog } from "../components/ProjectNameDialog";
import type { ProjectRecord } from "../domain/project";
import type { RecoverableProjectSummary } from "../domain/project-persistence";
import { ProjectError } from "../domain/project-error";
import { projectService as defaultProjectService } from "../app/services";
import { getWebMcpAvailability } from "../webmcp/model-context";
import { ESTRO_TOOL_COUNT } from "../webmcp/site-tools";

type ProjectFilter = "all" | "recent" | "recoverable";

export interface ProjectHubProps {
  service?: ProjectLifecycleService & Partial<ProjectPersistenceService>;
}

function formatUpdatedAt(timestamp: string): string {
  const elapsedMilliseconds = Date.now() - new Date(timestamp).getTime();
  const elapsedMinutes = Math.max(0, Math.round(elapsedMilliseconds / 60_000));

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return `${elapsedMinutes} minute${elapsedMinutes === 1 ? "" : "s"} ago`;

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return `${elapsedHours} hour${elapsedHours === 1 ? "" : "s"} ago`;

  const elapsedDays = Math.round(elapsedHours / 24);
  return `${elapsedDays} day${elapsedDays === 1 ? "" : "s"} ago`;
}

function projectKindLabel(project: ProjectRecord): string {
  if (project.kind === "photo") return "Photo project";
  if (project.kind === "video") return "Video project";
  return "Project foundation";
}

export function ProjectHub({ service = defaultProjectService }: ProjectHubProps) {
  const navigate = useNavigate();
  const shellRef = useRef<HTMLDivElement>(null);
  const deletedProjectIndexRef = useRef<number | null>(null);
  const [projects, setProjects] = useState<ProjectRecord[]>([]);
  const [recoverableProjects, setRecoverableProjects] = useState<RecoverableProjectSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<ProjectFilter>("all");
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const [nameDialog, setNameDialog] = useState<
    { mode: "create" } |
    { mode: "rename" | "save-as" | "snapshot"; project: ProjectRecord } |
    null
  >(null);
  const [deleteProject, setDeleteProject] = useState<ProjectRecord | null>(null);
  const webMcpAvailability = getWebMcpAvailability();

  const loadProjects = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [nextProjects, nextRecoverable] = await Promise.all([
        service.listProjects(),
        service.listRecoverableProjects?.() ?? Promise.resolve([]),
      ]);
      setProjects(nextProjects);
      setRecoverableProjects(nextRecoverable);
      setSelectedId((current) =>
        current && nextProjects.some((project) => project.id === current) ? current : (nextProjects[0]?.id ?? null),
      );
    } catch (error) {
      setLoadError(
        error instanceof ProjectError
          ? error.message
          : "Unable to load local projects. Check browser storage and try again.",
      );
    } finally {
      setLoading(false);
    }
  }, [service]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    document.title = "Projects · Estro";
  }, []);

  useEffect(() => {
    const deletedIndex = deletedProjectIndexRef.current;
    if (deletedIndex === null || loading || deleteProject !== null) return;

    const remainingLinks = shellRef.current?.querySelectorAll<HTMLAnchorElement>(".project-row__link");
    const nextLink = remainingLinks?.length
      ? remainingLinks[Math.min(deletedIndex, remainingLinks.length - 1)]
      : undefined;
    (nextLink ?? shellRef.current?.querySelector<HTMLElement>("#projects-main"))?.focus();
    deletedProjectIndexRef.current = null;
  }, [deleteProject, loading, projects]);

  const visibleProjects = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const filtered = normalizedQuery
      ? projects.filter((project) => project.name.toLocaleLowerCase().includes(normalizedQuery))
      : projects;

    if (filter === "recent") return filtered.slice(0, 5);
    if (filter === "recoverable") {
      const recoverableIds = new Set(recoverableProjects.map((project) => project.projectId));
      return filtered.filter((project) => recoverableIds.has(project.id));
    }
    return filtered;
  }, [filter, projects, query, recoverableProjects]);

  const selectedProject = projects.find((project) => project.id === selectedId) ?? null;
  const selectedRecovery = recoverableProjects.find((project) => project.projectId === selectedId) ?? null;

  async function createProject(name: string) {
    const project = await service.createProject({ name, kind: "unassigned" });
    setStatus(`${project.name} was created and saved in this browser.`);
    await loadProjects();
    navigate(`/editor/${project.id}`);
  }

  async function renameSelectedProject(name: string) {
    if (nameDialog?.mode !== "rename") return;
    const result = await service.renameProject({ projectId: nameDialog.project.id, name });
    await service.waitForAutosave?.(result.project.id);
    setStatus(result.transaction.summary);
    await loadProjects();
    setSelectedId(result.project.id);
  }

  async function saveAsSelectedProject(name: string) {
    if (nameDialog?.mode !== "save-as" || !service.saveProjectAs) return;
    const copy = await service.saveProjectAs(nameDialog.project.id, name);
    setStatus(`${copy.name} was saved as a separate project.`);
    await loadProjects();
    setSelectedId(copy.id);
  }

  async function snapshotSelectedProject(name: string) {
    if (nameDialog?.mode !== "snapshot" || !service.createSnapshot) return;
    const result = await service.createSnapshot(nameDialog.project.id, name);
    setStatus(result.transaction.summary);
    await loadProjects();
    setSelectedId(result.project.id);
  }

  async function duplicateSelectedProject(project: ProjectRecord) {
    try {
      const duplicate = await service.duplicateProject(project.id);
      setStatus(`${duplicate.name} was created as a separate local project.`);
      await loadProjects();
      setSelectedId(duplicate.id);
    } catch (error) {
      setStatus(error instanceof ProjectError ? error.message : "Unable to duplicate the project. Try again.");
    }
  }

  async function deleteSelectedProject(projectId: string) {
    deletedProjectIndexRef.current = projects.findIndex((project) => project.id === projectId);
    try {
      await service.deleteProject(projectId);
      setStatus("Project deleted from this browser.");
      await loadProjects();
    } catch (error) {
      deletedProjectIndexRef.current = null;
      throw error;
    }
  }

  return (
    <div ref={shellRef} className="project-hub-shell">
      <a className="skip-link" href="#projects-main">
        Skip to projects
      </a>

      <header className="top-bar">
        <Link className="wordmark" to="/projects" aria-label="Estro projects">
          Estro
        </Link>
        <label className="search-field">
          <span className="sr-only">Search projects</span>
          <Search aria-hidden="true" size={16} />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
          />
        </label>
        <div className="webmcp-status" role="status" aria-label="WebMCP availability">
          <Sparkles aria-hidden="true" size={15} />
          <span>{webMcpAvailability === "available" ? "WebMCP detected" : "Manual controls"}</span>
          <small>{webMcpAvailability === "available" ? `${ESTRO_TOOL_COUNT} tools ready` : "WebMCP unavailable"}</small>
        </div>
        <button className="button button--primary top-bar__primary" type="button" onClick={() => setNameDialog({ mode: "create" })}>
          <Plus aria-hidden="true" size={16} />
          New project
        </button>
      </header>

      <aside className="library-rail" aria-label="Project library">
        <div>
          <p className="eyebrow">Library</p>
          <nav aria-label="Project filters">
            <button
              className={filter === "all" ? "rail-item rail-item--active" : "rail-item"}
              type="button"
              aria-pressed={filter === "all"}
              onClick={() => setFilter("all")}
            >
              <Folder aria-hidden="true" size={17} />
              <span>All projects</span>
              <small>{projects.length}</small>
            </button>
            <button
              className={filter === "recoverable" ? "rail-item rail-item--active" : "rail-item"}
              type="button"
              aria-pressed={filter === "recoverable"}
              onClick={() => setFilter("recoverable")}
            >
              <RotateCcw aria-hidden="true" size={17} />
              <span>Recoverable</span>
              <small>{recoverableProjects.length}</small>
            </button>
            <button
              className={filter === "recent" ? "rail-item rail-item--active" : "rail-item"}
              type="button"
              aria-pressed={filter === "recent"}
              onClick={() => setFilter("recent")}
            >
              <Clock3 aria-hidden="true" size={17} />
              <span>Recent</span>
            </button>
          </nav>
        </div>

        <div className="storage-block">
          <p className="eyebrow">Storage</p>
          <div className="storage-line">
            <Database aria-hidden="true" size={17} />
            <span>Local browser</span>
          </div>
          <p>Projects stay on this device.</p>
          <p>Cloud sync is not enabled.</p>
        </div>
      </aside>

      <main id="projects-main" className="projects-main" tabIndex={-1}>
        <div className="page-heading">
          <div>
            <h1>Projects</h1>
            <p>Continue from a durable local project.</p>
          </div>
          <button className="button button--primary compact-create" type="button" onClick={() => setNameDialog({ mode: "create" })}>
            <Plus aria-hidden="true" size={16} /> Create project
          </button>
        </div>

        {loadError ? (
          <div className="inline-notice inline-notice--error" role="alert">
            <AlertTriangle aria-hidden="true" size={18} />
            <div>
              <strong>Unable to load projects</strong>
              <p>{loadError}</p>
            </div>
            <button className="button button--secondary" type="button" onClick={() => void loadProjects()}>
              Try again
            </button>
          </div>
        ) : null}

        {recoverableProjects.length > 0 && filter !== "recoverable" ? (
          <div className="recovery-summary" role="status">
            <RotateCcw aria-hidden="true" size={18} />
            <div><strong>{recoverableProjects.length} recoverable {recoverableProjects.length === 1 ? "draft" : "drafts"}</strong><p>Estro preserved edits that did not finish autosaving.</p></div>
            <button className="button button--secondary" type="button" onClick={() => setFilter("recoverable")}>Review drafts</button>
          </div>
        ) : null}

        {loading ? (
          <div className="project-list" aria-label="Loading projects" aria-busy="true">
            {[0, 1, 2].map((item) => (
              <div className="project-row project-row--skeleton" key={item}>
                <span className="skeleton skeleton--thumbnail" />
                <span className="skeleton-stack">
                  <span className="skeleton skeleton--title" />
                  <span className="skeleton skeleton--body" />
                </span>
              </div>
            ))}
          </div>
        ) : visibleProjects.length > 0 ? (
          <section aria-labelledby="project-list-heading">
            <h2 id="project-list-heading" className="eyebrow project-list-heading">
              {filter === "recent" ? "Recent" : filter === "recoverable" ? "Recoverable drafts" : "Local projects"}
            </h2>
            <ul className="project-list">
              {visibleProjects.map((project, index) => (
                <li
                  key={project.id}
                  className={project.id === selectedId ? "project-row project-row--selected" : "project-row"}
                  onMouseEnter={() => setSelectedId(project.id)}
                  onFocusCapture={() => setSelectedId(project.id)}
                >
                  <Link
                    className="project-row__link"
                    to={`/editor/${project.id}`}
                    aria-label={`Open project ${project.name}`}
                  >
                    <div className={`project-thumbnail project-thumbnail--${index % 3}`} aria-hidden="true" />
                    <div className="project-row__content">
                      <span className="project-row__title">{project.name}</span>
                      <p>
                        {projectKindLabel(project)} · edited {formatUpdatedAt(project.updatedAt)}
                      </p>
                      {recoverableProjects.some((candidate) => candidate.projectId === project.id) ? (
                        <span className="save-state save-state--recovery"><RotateCcw aria-hidden="true" size={14} /> Recovery available</span>
                      ) : <span className="save-state"><Check aria-hidden="true" size={14} /> Saved locally</span>}
                    </div>
                    <span className="project-row__storage">Local</span>
                  </Link>
                  <ProjectActionsMenu
                    project={project}
                    onRename={(target) => setNameDialog({ mode: "rename", project: target })}
                    onDuplicate={(target) => void duplicateSelectedProject(target)}
                    onSaveAs={service.saveProjectAs ? (target) => setNameDialog({ mode: "save-as", project: target }) : undefined}
                    onSnapshot={service.createSnapshot ? (target) => setNameDialog({ mode: "snapshot", project: target }) : undefined}
                    onDelete={setDeleteProject}
                  />
                </li>
              ))}
            </ul>
          </section>
        ) : (
          <section className="empty-state" aria-labelledby="empty-title">
            <Folder aria-hidden="true" size={24} />
            <h2 id="empty-title">{query ? `No projects match “${query}”` : "No projects yet"}</h2>
            <p>{query ? "Clear the search to see every local project." : "Create a project to begin. Your work stays in this browser."}</p>
            {query ? (
              <button className="button button--secondary" type="button" onClick={() => setQuery("")}>
                Clear search
              </button>
            ) : (
              <button className="button button--primary" type="button" onClick={() => setNameDialog({ mode: "create" })}>
                <Plus aria-hidden="true" size={16} /> Create project
              </button>
            )}
          </section>
        )}
      </main>

      <aside className="project-detail" aria-label="Selected project details">
        {selectedProject ? (
          <>
            <p className="eyebrow">Selected project</p>
            <h2>{selectedProject.name}</h2>
            <code>{selectedProject.id}</code>

            <section className="detail-section" aria-labelledby="durability-heading">
              <h3 id="durability-heading" className="eyebrow">
                Durability
              </h3>
              <div className={selectedRecovery ? "detail-success detail-success--recovery" : "detail-success"}>
                {selectedRecovery ? <RotateCcw aria-hidden="true" size={17} /> : <Check aria-hidden="true" size={17} />}
                <div>
                  <strong>{selectedRecovery ? "Recoverable draft available" : "All changes saved"}</strong>
                  <p>{selectedRecovery ? `${selectedRecovery.operationCount} preserved change${selectedRecovery.operationCount === 1 ? "" : "s"}` : `Updated ${formatUpdatedAt(selectedProject.updatedAt)}`}</p>
                </div>
              </div>
              <dl>
                <div>
                  <dt>Storage</dt>
                  <dd>This browser</dd>
                </div>
                <div>
                  <dt>Project type</dt>
                  <dd>{projectKindLabel(selectedProject)}</dd>
                </div>
                <div>
                  <dt>Schema</dt>
                  <dd>{selectedProject.schemaVersion}</dd>
                </div>
              </dl>
            </section>

            <div className="detail-actions">
              <Link className="button button--secondary" to={`/editor/${selectedProject.id}`}>
                Open project
              </Link>
              <button
                className="button button--ghost"
                type="button"
                onClick={() => setNameDialog({ mode: "rename", project: selectedProject })}
              >
                Rename project
              </button>
            </div>
            <p className="detail-footnote">
              Open this project to inspect revision history, save checkpoints, review proposals, and use Undo.
            </p>
          </>
        ) : (
          <div className="detail-empty">
            <p>Select a project to inspect its local status.</p>
          </div>
        )}
      </aside>

      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {status}
        {query ? ` ${visibleProjects.length} projects match the current search.` : ""}
      </div>

      <ProjectNameDialog
        open={nameDialog !== null}
        mode={nameDialog?.mode ?? "create"}
        initialName={nameDialog?.mode === "rename" ? nameDialog.project.name : nameDialog?.mode === "save-as" ? `${nameDialog.project.name} copy` : nameDialog?.mode === "snapshot" ? "Milestone" : ""}
        onClose={() => setNameDialog(null)}
        onSubmit={nameDialog?.mode === "rename" ? renameSelectedProject : nameDialog?.mode === "save-as" ? saveAsSelectedProject : nameDialog?.mode === "snapshot" ? snapshotSelectedProject : createProject}
      />
      <DeleteProjectDialog
        project={deleteProject}
        onClose={() => setDeleteProject(null)}
        onDelete={deleteSelectedProject}
      />
    </div>
  );
}

export function ProjectHubPage() {
  return <ProjectHub />;
}
