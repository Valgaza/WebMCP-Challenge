import { ProjectService } from "../application/project-service";
import { estroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { WorkspaceService } from "../application/workspace-service";

const projectRepository = new ProjectRepository(estroDatabase);

export const projectService = new ProjectService(projectRepository, { autosaveDelayMs: 1200 });
export const workspaceService = new WorkspaceService(estroDatabase);
