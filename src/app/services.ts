import { ProjectService } from "../application/project-service";
import { WorkspaceService } from "../application/workspace-service";
import { JobService } from "../application/job-service";
import { AssetService } from "../application/asset-service";
import { LayerService } from "../application/layer-service";
import { RenderService } from "../application/render-service";
import { OrganizationService } from "../application/organization-service";
import { OutputService } from "../application/output-service";
import { PresetService } from "../application/preset-service";
import { BatchExportService } from "../application/batch-export-service";
import { CatalogueService } from "../application/catalogue-service";
import { PackageService } from "../application/package-service";
import { ReviewService } from "../application/review-service";
import { SelectionService, createSelectionStore, type SelectionPixelReader } from "../application/selection-service";
import { ChannelService } from "../application/channel-service";
import { createLayerAdapter } from "../application/attribute-adapters";
import { estroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { sharedMediaWorker } from "../media/worker-client";
import { readPixels } from "../render/composite";

const projectRepository = new ProjectRepository(estroDatabase);

/**
 * One media worker is shared by every service that needs one. Hashing, downscaling,
 * resampling, waveform peaks, histograms, and PCM encoding all queue through it, which keeps
 * the interaction thread free without spawning a worker per feature.
 */
const mediaWorker = sharedMediaWorker();

export const projectService = new ProjectService(projectRepository, { autosaveDelayMs: 1200 });
export const workspaceService = new WorkspaceService(estroDatabase);
export const jobService = new JobService(estroDatabase, { maxConcurrent: 3 });
export const assetService = new AssetService(estroDatabase, projectService, jobService, { worker: mediaWorker });
export const layerService = new LayerService(projectService);
export const organizationService = new OrganizationService(projectService);
export const renderService = new RenderService(projectService, assetService, { worker: mediaWorker });

// Resizing an image is a pixel operation. The layer service owns the command; the asset
// service owns derivatives; this is where the two are introduced without either importing
// the other.
layerService.registerResampler(assetService);

/**
 * What the next edit applies to.
 *
 * Selection tools read pixels, so the service is given a reader rather than the renderer
 * itself: a layer's own transparency comes from rendering that layer alone, which the render
 * service already knows how to do for isolation.
 */
const selectionPixels: SelectionPixelReader = {
  readComposite: async (projectId) => {
    const result = await renderService.render({ projectId });
    return { widthPx: result.widthPx, heightPx: result.heightPx, data: readPixels(result) };
  },
  readLayer: async (projectId, layerId) => {
    const result = await renderService.render({ projectId, soloLayerIds: [layerId] });
    return { widthPx: result.widthPx, heightPx: result.heightPx, data: readPixels(result) };
  },
};

export const selectionService = new SelectionService(selectionPixels, createSelectionStore(estroDatabase));

/**
 * The channels panel reads the same store the selection panel writes to: an alpha channel is
 * a saved selection, so there is one of them rather than two that could disagree.
 */
export const channelService = new ChannelService(selectionService, selectionPixels);

/**
 * A layer mask that points at a saved selection needs those bytes turned into something the
 * canvas can draw. Registered after construction because the selection service reads its
 * pixels through the render service: naming the dependency both ways would be a cycle.
 */
renderService.registerMaskImages(async (projectId, selectionIds) => {
  const images = new Map<string, CanvasImageSource>();
  for (const selectionId of selectionIds) {
    const saved = await selectionService.readMaskImage(projectId, selectionId).catch(() => null);
    if (!saved) continue;
    const data = new ImageData(saved.greyscale, saved.widthPx, saved.heightPx);
    images.set(selectionId, await createImageBitmap(data));
  }
  return images;
});

export const outputService = new OutputService(estroDatabase);

/**
 * One reuse engine for every kind of object.
 *
 * Copying attributes, saving a preset, starting from a template, and applying a change to
 * forty layers are the same operation; an adapter is how it reaches them without the engine
 * knowing anything about layers at all.
 */
export const presetService = new PresetService(estroDatabase, projectService);
presetService.registerAdapter(createLayerAdapter(projectService));
/**
 * Exporting many photographs at once runs as a job, because three sizes of a hundred
 * photographs is three hundred encodes and nothing that long belongs on the interaction thread.
 */
export const batchExportService = new BatchExportService(projectService, renderService, outputService, jobService);

/**
 * Marking media so a person can find one shot among four hundred. Goes through the project's
 * own command path, so a rating is undoable and travels with a duplicated project.
 */
export const catalogueService = new CatalogueService(projectService);

/**
 * Writing a project out whole and reading one back.
 *
 * There is no server, so a package is the sync mechanism: a file carried by whatever the
 * person already uses. The exchange for that weaker promise is complete honesty about what a
 * package holds and what opening one will do.
 */
export const packageService = new PackageService(projectService, assetService);

/**
 * Showing work to someone and hearing back. None of it is enforcement: a role does not stop
 * anyone doing anything and a claim is a note, which is what every method here says.
 */
export const reviewService = new ReviewService(projectService);

/**
 * Reconciles what a previous session left behind.
 *
 * A page that closed mid-import leaves staged bytes nothing references, and jobs whose
 * records still claim to be running. Both are resolved on startup so the first thing a user
 * sees is the truth rather than a frozen progress bar.
 */
export async function reconcileAfterReload(): Promise<{
  discardedStagedSources: number;
  recoveredDerivatives: number;
  interruptedJobs: number;
  /** Imports whose project revision was committed but whose runtime record was not. */
  finishedImports: number;
  /** Imports that never reached a commit; their staged bytes were removed. */
  rolledBackImports: number;
  migratedSources: number;
  offlineAfterMigration: number;
}> {
  await presetService.hydrate().catch(() => undefined);
  const [assets, jobs] = await Promise.all([
    assetService.hydrate().catch(() => ({
      recoveredDerivatives: 0, discardedStagedSources: 0, finishedImports: 0,
      rolledBackImports: 0, migratedSources: 0, offlineAfterMigration: 0,
    })),
    jobService.reconcileInterruptedJobs().catch(() => []),
  ]);
  return {
    discardedStagedSources: assets.discardedStagedSources,
    recoveredDerivatives: assets.recoveredDerivatives,
    interruptedJobs: jobs.length,
    finishedImports: assets.finishedImports,
    rolledBackImports: assets.rolledBackImports,
    migratedSources: assets.migratedSources,
    offlineAfterMigration: assets.offlineAfterMigration,
  };
}
