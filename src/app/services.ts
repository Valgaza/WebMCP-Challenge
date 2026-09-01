import { ProjectService } from "../application/project-service";
import { estroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";

const projectRepository = new ProjectRepository(estroDatabase);

export const projectService = new ProjectService(projectRepository, { autosaveDelayMs: 1200 });
