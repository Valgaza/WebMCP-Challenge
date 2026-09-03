import { z } from "zod";
import type { ProjectMutationResult, ProjectService } from "../application/project-service";
import type { ProjectRecord } from "../domain/project";
import type { WorkspaceService } from "../application/workspace-service";
import type { AssetService } from "../application/asset-service";
import type { JobService } from "../application/job-service";
import type { LayerService } from "../application/layer-service";
import type { RenderService } from "../application/render-service";
import type { OrganizationService } from "../application/organization-service";
import { organizationCommandSchema } from "../application/organization-service";
import type { OutputService } from "../application/output-service";
import { describePresence } from "../media/container-probe";
import type { PresetService } from "../application/preset-service";
import type { SelectionService } from "../application/selection-service";
import type { ChannelService } from "../application/channel-service";
import type { BatchExportService } from "../application/batch-export-service";
import { exportVariantSchema } from "../application/batch-export-service";
import { knownPhrases, resolvePhrase } from "../application/phrase-service";
import type { CatalogueService } from "../application/catalogue-service";
import type { PackageService } from "../application/package-service";
import type { ReviewService } from "../application/review-service";
import { roleSchema } from "../domain/review";
import { DEFAULT_ACCESSIBILITY, allIndicators, describeStatus } from "../domain/accessibility";
import { collectionRuleSchema, labelSchema, type CatalogueSubject } from "../domain/catalogue";

/** One row of the catalogue, as an agent reads it. */
function catalogueRow(subject: CatalogueSubject) {
  return {
    itemId: subject.itemId, itemType: subject.itemType, name: subject.name,
    kind: subject.kind, durationSeconds: subject.durationSeconds, used: subject.used,
    rating: subject.entry.rating, label: subject.entry.label,
    favourite: subject.entry.favourite, tags: subject.entry.tags,
    note: subject.entry.note || null,
  };
}
import { refineEdgeInputSchema, refineInputSchema, selectInputSchema } from "../application/selection-service";
import { selectionModeSchema } from "../domain/selection";
import { colourChannelSchema } from "../domain/channel";
import { describeEffect, describeMask } from "../domain/effect";
import { describeStyle } from "../domain/layer-style";
import { describeTrack } from "../domain/keyframe";
import { paintSchema, parseSvg, toSvgDocument } from "../domain/vector";
import {
  ATTRIBUTES_BY_DOMAIN,
  type AttributeName, attributesIn, batchFailurePolicySchema, describeBundle, presetDomainSchema,
} from "../domain/preset";
import { BLEND_MODES, BLEND_MODE_LABELS } from "../domain/effect";
import { ANIMATABLE_PROPERTIES } from "../domain/keyframe";
import { describeTypography } from "../domain/text";
import { detectTimedMediaCapabilities } from "../media/media-probe";
import { formatTimecode, isValidTimecode, parseTimecode, toSeconds } from "../domain/time";
import { colorAdjustmentSchema, describeLayer, layerOperationSchema, summarizeLayerTree } from "../application/layer-service";
import { ADJUSTMENT_RANGES, activeAdjustments, describeAdjustment } from "../domain/adjustment";
import { findLayer, flattenLayers } from "../domain/layer";
import { assetSearchSchema, describeActiveFilters, describeDurability, hasProxy } from "../domain/asset";
import { summarizeJob } from "../domain/job";
import { summarizeOutput } from "../domain/output";
import { detectMediaCapabilities, decodableTypes, encodableTypes } from "../media/image-capabilities";
import { estimateStorage } from "../data/storage-quota";
import { ProjectError, toProjectError } from "../domain/project-error";
import { proposedOperationSchema } from "../domain/project-persistence";
import { createPhotoDocumentInputSchema } from "../domain/photo-document";
import { workspaceChangeSchema } from "../domain/workspace";
import { editorCommands, searchEditorCommands } from "../editor/editor-commands";
import { getSemanticTarget, semanticTargets, type SemanticTargetId } from "../editor/semantic-targets";
import { webMcpActivityStore } from "./activity-store";
import { buildSampleProject } from "../application/sample-project";
import { explainAdjustment, explainOperation, meaningOf } from "../domain/plain-english";
import { planRelink } from "../domain/relink";
import {
  burnInSchema, describeBurnIn, describeWatermark, watermarkSchema, DEFAULT_WATERMARK,
} from "../domain/watermark";
import { focusStore } from "./focus-store";
import type { ModelContextApi, ModelContextToolDefinition } from "./model-context";

export const WEBMCP_SCHEMA_VERSION = "5.1.0";
/**
 * The number of tools this module is expected to register. Declared rather than derived so a
 * test can catch a tool added or lost by accident — but nothing user-facing reads it, because
 * a hand-kept number is exactly what fell out of step with the code before. What the
 * interface shows comes from `getRegisteredToolCount`, which counts what actually registered.
 */
export const ESTRO_TOOL_COUNT = 56;

let registeredToolCount = 0;

/** How many tools registered with the browser in this page. Zero until registration runs. */
export function getRegisteredToolCount(): number { return registeredToolCount; }

const listProjectsSchema = z.object({
  limit: z.number().int().min(1).max(50).default(20),
  query: z.string().max(120).optional(),
  kind: z.enum(["photo", "video", "unassigned"]).optional(),
});
const inspectProjectSchema = z.object({ projectId: z.string().min(1), historyLimit: z.number().int().min(1).max(20).default(8) });
/**
 * Optional on every operation that commits a revision, so the promise "every mutation accepts
 * an expected revision" holds for this tool too. Create has nothing to be stale against.
 */
const expectedRevision = { expectedRevisionId: z.string().min(1).optional() };
const manageProjectSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer.") }),
  z.object({ operation: z.literal("create_sample") }),
  z.object({ operation: z.literal("rename"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer."), ...expectedRevision }),
  z.object({ operation: z.literal("duplicate"), projectId: z.string().min(1), ...expectedRevision }),
  z.object({ operation: z.literal("save"), projectId: z.string().min(1), ...expectedRevision }),
  z.object({ operation: z.literal("save_as"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a project name.").max(120, "Use a project name with 120 characters or fewer."), ...expectedRevision }),
  z.object({ operation: z.literal("snapshot"), projectId: z.string().min(1), name: z.string().trim().min(1, "Enter a snapshot name.").max(120, "Use a snapshot name with 120 characters or fewer."), ...expectedRevision }),
  z.object({ operation: z.literal("request_delete"), projectId: z.string().min(1), ...expectedRevision }),
]);
const proposalInputSchema = z.object({ projectId: z.string().min(1), operations: z.array(proposedOperationSchema).min(1).max(10) });
const proposalIdSchema = z.object({ proposalId: z.string().min(1) });
const transactionIdSchema = z.object({ transactionId: z.string().min(1) });
const undoSchema = z.object({ projectId: z.string().min(1), transactionId: z.string().min(1), expectedRevisionId: z.string().min(1).optional() });
const projectIdSchema = z.object({ projectId: z.string().min(1) });
const rationalSchemaForTools = z.object({ numerator: z.number().int(), denominator: z.number().int().min(1) });
const timeRangeSchemaForTools = z.object({ start: rationalSchemaForTools, duration: rationalSchemaForTools });
const workspaceInputSchema = z.object({ projectId: z.string().min(1), change: workspaceChangeSchema });
const selectionInputSchema = z.object({
  projectId: z.string().min(1),
  selectionType: z.enum(["none", "canvas", "document", "layer", "clip", "track", "asset", "sequence", "output"]),
  targetId: z.string().min(1).nullable(),
  targetIds: z.array(z.string().min(1)).max(500).optional(),
});
const focusInputSchema = z.object({ projectId: z.string().min(1), targetId: z.string().min(1) });
const searchCommandsSchema = z.object({ query: z.string().max(120).default("") });

const actor = { type: "agent" as const, id: "webmcp-agent", displayName: "WebMCP agent" };

/**
 * Teaching content, not automation.
 *
 * Each step names a control that really exists and how the person confirms the result, so
 * the agent guides without taking the edit away. A step pointing at a control the interface
 * does not have is worse than no guidance at all.
 */
const GUIDED_WALKTHROUGHS: Record<string, { instruction: string; verify: string; targetId: SemanticTargetId }[]> = {
  add_image: [
    { instruction: "Open the Media tab in the left panel.", verify: "The Media panel lists this project's media.", targetId: "panel-media" },
    { instruction: "Choose Import media and pick an image file.", verify: "A thumbnail appears in the library.", targetId: "media-import" },
    { instruction: "Select the image, then choose Add to canvas.", verify: "The Layers tab shows a new layer and the canvas shows the image.", targetId: "media-add-to-canvas" },
  ],
  adjust_brightness: [
    { instruction: "Select the layer you want to change in the Layers tab.", verify: "The Inspector shows that layer's properties.", targetId: "panel-layers" },
    { instruction: "Find Brightness in the Inspector's Colour section and move it.", verify: "The canvas updates and History records one entry.", targetId: "inspector-adjustments" },
    { instruction: "Check the histogram for clipping warnings.", verify: "No channel reports blown highlights you did not intend.", targetId: "inspector-histogram" },
  ],
  crop: [
    { instruction: "Select the image layer to crop in the Layers tab.", verify: "The layer is highlighted and the Inspector shows its transform.", targetId: "panel-layers" },
    { instruction: "Choose the Crop tool in the tool rail.", verify: "A crop rectangle appears over the image.", targetId: "tool-crop" },
    { instruction: "Drag a handle, or pick an aspect ratio in the Inspector's Crop section.", verify: "The readout shows the kept pixel size.", targetId: "inspector-crop" },
    { instruction: "Choose Apply crop.", verify: "The canvas shows only the kept area and History records one entry.", targetId: "crop-overlay" },
  ],
  export_image: [
    { instruction: "Open the Export panel in the Inspector and choose the Image tab.", verify: "Format and quality controls appear.", targetId: "inspector-export" },
    { instruction: "Choose a format, then select Preview size.", verify: "The real encoded size is shown, measured rather than estimated.", targetId: "export-preset" },
    { instruction: "Choose Export image.", verify: "The file downloads and appears in the Outputs list.", targetId: "export-start" },
  ],
};

function jsonSchema(properties: Record<string, unknown> = {}, required: string[] = []): Record<string, unknown> {
  return { type: "object", additionalProperties: false, properties, required };
}

function toolResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: "text", text: JSON.stringify(payload) }],
    structuredContent: payload,
  };
}

function errorEnvelope(error: unknown) {
  const parsed = toProjectError(error);
  return toolResult({
    ok: false,
    schemaVersion: WEBMCP_SCHEMA_VERSION,
    error: {
      code: parsed.code,
      message: parsed.message,
      fieldPath: parsed.fieldPath ?? null,
      expected: parsed.code === "INVALID_INPUT" ? "A value matching the declared tool input schema." : null,
      conflictingIds: [],
      capabilityRequirement: parsed.code === "CAPABILITY_UNAVAILABLE" ? parsed.message : null,
      permissionRequirements: parsed.code === "CONFIRMATION_REQUIRED" ? ["explicit_user_confirmation"] : [],
      projectPreserved: true,
      recoverySuggestion: recoverySuggestion(parsed),
    },
  });
}

function recoverySuggestion(error: ProjectError): string {
  if (error.code === "PROPOSAL_STALE" || error.code === "HISTORY_CONFLICT") return "Inspect the latest project revision, then prepare a new proposal.";
  if (error.code === "PROJECT_NAME_CONFLICT") return "Choose a different local project name.";
  if (error.code === "CONFIRMATION_REQUIRED") return "Re-send the same request with its confirmation field set, after telling the user what will change.";
  if (error.code === "CAPABILITY_UNAVAILABLE") return "Call get_capabilities and choose an operation this runtime can perform.";
  if (error.code === "ASSET_SOURCE_UNAVAILABLE") return "Relink the asset through the Media panel, then retry.";
  if (error.code.startsWith("STORAGE_")) return "Keep this page open, check browser storage, and retry the same action.";
  if (error.code === "MEDIA_DECODE_FAILED") return "Bring this tab to the front — Chrome suspends video decoding in a background tab — then retry. If it still fails, the source may not be decodable by this browser.";
  if (error.code === "UNEXPECTED_FAILURE") return "This is a fault in Estro, not in the request. The project was not changed; retrying the same call is safe, and inspecting the project will confirm its state.";
  return "Correct the indicated input and retry. No project revision was changed.";
}

/**
 * How many failure cards `visibleToolError` has raised.
 *
 * The wrapper below reports a refusal too, and a tool that reports its own produced two cards
 * for one failure. Comparing this before and after a call is how the wrapper tells "this tool
 * already said something" from "nobody said anything" — without a second list to keep in step
 * with the code.
 */
let reportedFailureCount = 0;

function visibleToolError(error: unknown, title = "Estro could not complete that request") {
  const parsed = toProjectError(error);
  reportedFailureCount += 1;
  webMcpActivityStore.show({
    id: crypto.randomUUID(),
    stage: "failed",
    title,
    detail: `${parsed.message} The current project state was preserved.`,
  });
  return errorEnvelope(parsed);
}

function resultForMutation(result: Awaited<ReturnType<ProjectService["renameProject"]>>) {
  return {
    ok: true,
    schemaVersion: WEBMCP_SCHEMA_VERSION,
    projectId: result.project.id,
    transactionId: result.transaction.id,
    undoToken: result.transaction.id,
    previousRevisionId: result.transaction.sourceRevisionId,
    resultingRevisionId: result.headRevision.id,
    affectedIds: result.transaction.affectedIds,
    normalizedParameters: result.normalizedParameters ?? {},
    warnings: result.transaction.warnings,
    summary: result.transaction.summary,
    undoAvailable: result.canUndo,
  };
}

/**
 * A new project identity is committed with its own initiating transaction, but the lifecycle
 * service returns only the project record. Recover that transaction so create, duplicate, and
 * Save As report the same transaction identity, affected IDs, and warnings as every other
 * mutation instead of a reduced payload.
 */
async function resultForProjectCreation(service: ProjectService, project: ProjectRecord, summary: string) {
  const history = await service.getProjectHistory(project.id);
  const transaction = history.transactions.find((entry) => entry.resultingRevisionId === project.headRevisionId) ?? null;
  return {
    ok: true,
    schemaVersion: WEBMCP_SCHEMA_VERSION,
    projectId: project.id,
    transactionId: transaction?.id ?? null,
    undoToken: transaction?.undoable ? transaction.id : null,
    previousRevisionId: transaction?.sourceRevisionId ?? null,
    resultingRevisionId: project.headRevisionId,
    affectedIds: transaction?.affectedIds ?? [project.id],
    normalizedParameters: {},
    warnings: transaction?.warnings ?? [],
    summary,
    undoAvailable: transaction?.undoable ?? false,
  };
}

const assetSearchInputSchema = z.object({ projectId: z.string().min(1) }).and(assetSearchSchema.partial());
const assetIdSchema = z.object({ assetId: z.string().min(1) });
const manageJobSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("cancel"), jobId: z.string().min(1) }),
  z.object({ operation: z.literal("retry"), jobId: z.string().min(1) }),
]);
const previewRevisionSchema = z.object({
  assetId: z.string().min(1),
  quality: z.enum(["draft", "balanced", "full"]).default("draft"),
});
const manageAssetSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("update_tags"), assetId: z.string().min(1), tags: z.array(z.string().min(1).max(48)).max(32) }),
  z.object({ operation: z.literal("remove"), assetId: z.string().min(1), expectedRevisionId: z.string().min(1).optional() }),
  z.object({ operation: z.literal("refresh_availability"), projectId: z.string().min(1) }),
  z.object({ operation: z.literal("request_import"), projectId: z.string().min(1) }),
  z.object({ operation: z.literal("request_relink"), assetId: z.string().min(1) }),
  z.object({
    operation: z.literal("plan_relink"),
    projectId: z.string().min(1),
    candidates: z.array(z.object({
      key: z.string().min(1),
      name: z.string().min(1).max(260),
      byteSize: z.number().int().min(0).optional(),
      contentHash: z.string().min(1).nullable().optional(),
    })).min(1).max(2000),
  }),
  z.object({ operation: z.literal("generate_proxy"), assetId: z.string().min(1), quality: z.enum(["draft", "balanced"]).default("balanced") }),
  z.object({ operation: z.literal("generate_thumbnail"), assetId: z.string().min(1) }),
  z.object({ operation: z.literal("generate_waveform"), assetId: z.string().min(1) }),
]);

const compareRevisionsSchema = z.object({
  projectId: z.string().min(1),
  fromTransactionId: z.string().min(1).optional(),
});
const explainEditSchema = z.object({
  projectId: z.string().min(1),
  transactionId: z.string().min(1).optional(),
  layerId: z.string().min(1).optional(),
  clipId: z.string().min(1).optional(),
  sequenceId: z.string().min(1).optional(),
  adjustment: z.string().min(1).optional(),
});
const guidedStepSchema = z.object({
  projectId: z.string().min(1),
  goal: z.enum(["add_image", "adjust_brightness", "crop", "export_image"]),
  step: z.number().int().min(1).max(8).default(1),
});

/**
 * Everything the tools call into.
 *
 * A named object rather than a positional list: with this many services, a caller that
 * transposed two of the same type would compile and then misbehave at run time, and every
 * new service added a line to every call site.
 */
export interface EstroToolServices {
  service: ProjectService;
  workspaceService: WorkspaceService;
  assetService: AssetService;
  jobService: JobService;
  layerService: LayerService;
  renderService: RenderService;
  organizationService: OrganizationService;
  outputService: OutputService;
  presetService: PresetService;
  batchExportService: BatchExportService;
  catalogueService: CatalogueService;
  packageService: PackageService;
  reviewService: ReviewService;
  selectionService: SelectionService;
  channelService: ChannelService;
}

export function createEstroSiteTools(services: EstroToolServices): ModelContextToolDefinition[] {
  const {
    service, workspaceService, assetService, jobService, layerService, renderService,
    organizationService, outputService, presetService, batchExportService, catalogueService,
    packageService, reviewService, selectionService, channelService,
  } = services;
  const execute = (stage: Parameters<typeof webMcpActivityStore.show>[0]["stage"], title: string, detail: string, task: () => Promise<Record<string, unknown>>) =>
    async () => {
      const id = crypto.randomUUID();
      webMcpActivityStore.show({ id, stage, title, detail });
      try {
        const payload = await task();
        webMcpActivityStore.show({
          id, stage: "complete", title: sentenceOf(payload.summary) ?? `${title} complete`, detail: `Result ready from schema ${WEBMCP_SCHEMA_VERSION}.`,
          projectId: payload.projectId as string | undefined,
          transactionId: payload.transactionId as string | undefined,
          undoProjectId: payload.undoAvailable ? payload.projectId as string : undefined,
        });
        return toolResult(payload);
      } catch (error) {
        const parsed = toProjectError(error);
        webMcpActivityStore.show({ id, stage: "failed", title: "Estro could not complete that request", detail: parsed.message });
        return errorEnvelope(parsed);
      }
    };

  /**
   * Follows a queued job to its end so the activity card resolves.
   *
   * A render used to announce itself as queued and then never say anything again: the card
   * sat at "queued" until it was dismissed by hand, whether the file was written or the job
   * failed. This subscribes to the same job stream the Job Center reads, updates progress as
   * it runs, and reports the outcome — including a failure, which is precisely the case a
   * caller most needs to hear about and least likely to poll for.
   */
  const followJob = (activityId: string, jobId: string, projectId: string, title: string) => {
    const stop = jobService.subscribe((job) => {
      if (job.id !== jobId) return;
      if (job.status === "running" || job.status === "queued") {
        const total = job.progress.totalUnits;
        const done = job.progress.completedUnits;
        const share = total && done !== null && done !== undefined ? ` — ${Math.round((done / total) * 100)}%` : "";
        webMcpActivityStore.show({
          id: activityId, stage: job.status === "queued" ? "queued" : "running",
          title, detail: `${job.progress.stage}${share}`, projectId,
        });
        return;
      }
      stop();
      if (job.status === "complete") {
        webMcpActivityStore.show({
          id: activityId, stage: "complete", title,
          detail: job.warnings.length
            ? `Finished with ${job.warnings.length} warning(s). The file is in Outputs.`
            : "Finished. The file is in Outputs.",
          projectId,
        });
      } else if (job.status === "cancelled") {
        webMcpActivityStore.show({ id: activityId, stage: "cancelled", title, detail: "Cancelled. No file was written.", projectId });
      } else {
        webMcpActivityStore.show({
          id: activityId, stage: "failed", title,
          detail: job.failureMessage ?? "The job stopped before finishing. No file was written.",
          projectId,
        });
      }
    });
    return stop;
  };

  /** Everything a caller needs to describe one asset without receiving its bytes. */
  const describeAsset = (record: Awaited<ReturnType<AssetService["getAsset"]>>) => ({
    assetId: record.id,
    // The reference's own schema version is renamed so it cannot shadow the tool envelope's.
    assetSchemaVersion: record.reference.schemaVersion,
    name: record.reference.name,
    mediaType: record.reference.mediaType,
    kind: record.reference.kind,
    byteSize: record.reference.byteSize,
    widthPx: record.reference.widthPx,
    heightPx: record.reference.heightPx,
    durationSeconds: record.reference.durationSeconds,
    frameRate: record.reference.frameRate,
    hasVideo: record.reference.hasVideo,
    hasAudio: record.reference.hasAudio,
    streams: record.reference.streams,
    // Stated separately from `hasAudio`/`hasVideo` because "no audio" and "audio this
    // browser cannot decode" need different answers from a caller.
    streamPresence: {
      video: record.reference.streams.videoPresence,
      audio: record.reference.streams.audioPresence,
      determinedBy: record.reference.streams.presenceSource,
      video_summary: describePresence("video", record.reference.streams.videoPresence),
      audio_summary: describePresence("audio", record.reference.streams.audioPresence),
    },
    contentHash: record.reference.contentHash,
    sourceRevision: record.reference.sourceRevision,
    addedAt: record.reference.addedAt,
    availability: record.availability,
    availabilityReason: record.availabilityReason,
    editability: record.editability,
    editabilityReason: record.editabilityReason,
    locatorType: record.locator.locatorType,
    durability: describeDurability(record.locator),
    tags: record.tags,
    binId: record.binId,
    importPath: record.importPath,
    hasThumbnail: record.derivatives.some((entry) => entry.kind === "thumbnail" && entry.sourceRevision === record.reference.sourceRevision),
    hasProxy: hasProxy(record),
    hasWaveform: record.derivatives.some((entry) => entry.kind === "waveform" && entry.sourceRevision === record.reference.sourceRevision),
    derivatives: record.derivatives.map((entry) => ({ key: entry.key, kind: entry.kind, sourceRevision: entry.sourceRevision, settings: entry.settings })),
  });

  /**
   * Named rather than returned inline so `get_capabilities` can report the registry from the
   * registry. The list used to be typed out by hand and had fallen twenty tools behind, which
   * is worse than no list: an agent that trusts it concludes a tool does not exist.
   */
  const tools: ModelContextToolDefinition[] = [
    {
      name: "get_capabilities",
      description: "Report what Estro can actually do in this browser right now, with import, decode, proxy, preview, video encode, audio encode, mux, worker, durable storage, and fallback support reported separately. Never changes a project.",
      inputSchema: jsonSchema(),
      annotations: { readOnlyHint: true },
      execute: execute("inspecting", "Inspecting Estro capabilities", "Probing what this browser can really decode, encode, and store.", async () => {
        // Capability discovery must reflect the actual runtime, so formats are probed rather
        // than assumed. Collapsing these stages into one boolean is how a product ends up
        // advertising an export it cannot perform.
        const media = await detectMediaCapabilities();
        const storage = await estimateStorage();

        return {
          ok: true,
          schemaVersion: WEBMCP_SCHEMA_VERSION,
          toolCount: tools.length,
          storage: "browser-indexeddb",
          remoteCompute: false,
          capabilityStages: {
            import: {
              images: decodableTypes(media),
              folderPicker: typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function",
            },
            posterGeneration: { available: media.offscreenCanvas && media.imageBitmap, worker: assetService.workerAvailable },
            resample: {
              available: assetService.workerAvailable,
              algorithms: assetService.workerAvailable ? ["nearest", "bilinear", "lanczos3"] : [],
              reason: assetService.workerAvailable ? null : "Without a worker, image resize rescales for display but does not resample the pixels.",
            },
            streamDetection: {
              containerParsing: ["video/mp4", "video/quicktime", "video/webm", "audio/aac", "audio/mp4"],
              states: ["present", "absent", "unknown", "undecodable"],
              note: "Stream presence is read from the container. A decode failure is reported as undecodable, never as absent.",
            },
            previewRender: { offscreenCanvas: media.offscreenCanvas, imageBitmap: media.imageBitmap, worker: assetService.workerAvailable },
            imageEncode: {
              // Which picture formats this browser will actually encode, probed rather than
              // assumed — an AVIF that silently becomes a PNG is worse than a refusal.
              formats: encodableTypes(media),
            },
            workers: { available: assetService.workerAvailable },
            durableStorage: {
              originalMedia: assetService.durableSourceStorageAvailable,
              derivedCache: assetService.derivedCacheAvailable,
              usageBytes: storage.usage,
              quotaBytes: storage.quota,
            },
            filePermissions: { fileSystemAccess: media.fileSystemAccess, originPrivateFileSystem: media.originPrivateFileSystem },
            fallbacks: {
              sessionOnlyImport: !assetService.durableSourceStorageAvailable,
              mainThreadRendering: !assetService.workerAvailable,
              reason: assetService.durableSourceStorageAvailable ? null : "Without durable private storage, imported files are held for this session only and need relinking after a reload.",
            },
          },
          media: {
            decodableImageTypes: decodableTypes(media),
            encodableImageTypes: encodableTypes(media),
            imageBitmap: media.imageBitmap,
            offscreenCanvas: media.offscreenCanvas,
            fileSystemAccess: media.fileSystemAccess,
            originPrivateFileSystem: media.originPrivateFileSystem,
            webWorkers: media.webWorkers,
            durableFileReferences: media.fileSystemAccess,
          },
          // Read off the registry, so this can never again name a tool that is not there or
          // omit one that is. Each entry carries the hints a host uses to decide what needs
          // confirming, which saves a caller a round trip through getTools().
          tools: tools.map((tool) => ({
            name: tool.name,
            readOnly: tool.annotations?.readOnlyHint === true,
            destructive: tool.annotations?.destructiveHint === true,
          })),
          operations: tools.map((tool) => tool.name),
          compositing: {
            blendModes: BLEND_MODES.map((mode) => ({ mode, label: BLEND_MODE_LABELS[mode] })),
            masks: { sources: ["shape", "layer_alpha", "raster"], feather: true, density: true, invert: true },
            clipping: true,
            effectContainers: { maxPerLayer: 16, reorderable: true, individuallySwitchable: true },
            animation: {
              properties: ANIMATABLE_PROPERTIES,
              interpolations: ["linear", "hold", "ease_in", "ease_out", "ease_in_out", "bezier"],
              maxKeyframesPerProperty: 500,
              motionPaths: true,
              note: "A value holds before the first keyframe and after the last rather than extrapolating. Layers and clips animate through one evaluator.",
            },
            graphics: {
              text: { pointAndParagraph: true, runs: true, paragraphStyles: true, fontSubstitution: "explicit, keeping the original descriptor" },
              vector: { shapes: ["rectangle", "ellipse", "polygon", "path"], strokes: true, fillRules: ["nonzero", "evenodd"] },
              paint: { kinds: ["none", "solid", "linear", "radial", "swatch"] },
              svg: { import: true, export: true, note: "Shapes and paths round-trip; anything else is named rather than dropped silently." },
            },
            note: "Blend modes map onto Canvas composite operations, so preview and export cannot disagree about them. Photo layers and video clips render through the same compositor.",
          },
          renderPlan: {
            immutable: true,
            note: "Every render is compiled against one project revision and rendered from a frozen snapshot, so editing while a job runs cannot change its output.",
            compositesEveryVisibleTrack: true,
            scopes: ["whole_sequence", "work_area", "selected_range", "clip"],
          },
          limits: {
            inspectionHistory: 20, proposalOperations: 10, proposalLifetimeSeconds: 600,
            documentPixelsPerAxis: 32768, assetBytes: 536870912, assetSearchResults: 500,
            jobHistory: 50, clipsPerSequence: 5000, tracksPerKind: 32, sequenceNestingDepth: 6,
            zoom: { minimum: 0.05, maximum: 32 },
            panelWidths: { left: [224, 360], inspector: [272, 400] },
          },
          permissionPolicy: {
            destructiveDeletion: "explicit-visible-confirmation",
            trackDeletionWithClips: "explicit-confirmation-field",
            binDeletionWithItems: "explicit-confirmation-field",
            fileImport: "user-gesture-required",
          },
          capabilities: {
            fullscreen: typeof document.fullscreenEnabled === "boolean" ? document.fullscreenEnabled : false,
            pointerEvents: "PointerEvent" in globalThis,
            workspaceFallback: "in-page-distraction-free",
          },
          // Probed rather than assumed. Estro edits photographs; anything it cannot decode
          // or encode here is said plainly rather than discovered at the end of an export.
          limitations: [
            ...(decodableTypes(media).length ? [] : ["This browser decoded none of the image formats Estro tried, so importing a photograph will not work."]),
            ...(assetService.workerAvailable ? [] : ["This browser has no workers, so resampling and histograms run on the interaction thread and a large photograph will feel slow."]),
            ...(assetService.durableSourceStorageAvailable ? [] : ["This browser provides no durable private storage, so an imported photograph is held for this session only and will need relinking after a reload."]),
          ],
          semanticTargets,
          commandIds: editorCommands.map((command) => command.id),
        };
      }),
    },
    {
      name: "list_projects",
      description: "List the Estro projects in this browser, newest first, with the id every other tool needs. Start here: nearly every tool takes a projectId, and there is no other way to discover one. Reports whether each project holds an image document, sequences, or media, and whether it has an unsaved draft to recover, so a caller can pick the right one without opening each in turn. Never changes anything.",
      inputSchema: jsonSchema({
        limit: { type: "integer", minimum: 1, maximum: 50, default: 20, description: "How many projects to return." },
        query: { type: "string", maxLength: 120, description: "Case-insensitive match against the project name." },
        kind: { enum: ["photo", "video", "unassigned"], description: "Only projects of this kind." },
      }),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        let parsed: z.infer<typeof listProjectsSchema>;
        try { parsed = listProjectsSchema.parse(input); } catch (error) { return visibleToolError(error, "Project listing needs valid input"); }
        return execute("inspecting", "Listing projects", "Reading the local project index.", async () => {
          const [records, recoverable] = await Promise.all([
            service.listProjects(),
            service.listRecoverableProjects().catch(() => []),
          ]);
          const recoverableIds = new Set(recoverable.map((entry) => entry.projectId));
          const needle = parsed.query?.trim().toLowerCase();
          const matched = records
            .filter((record) => (parsed.kind ? record.kind === parsed.kind : true))
            .filter((record) => (needle ? record.name.toLowerCase().includes(needle) : true))
            .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

          // A caller choosing between projects needs to know what is in them, and the head
          // revision is the only place that says. Bounded by the returned page rather than
          // read for every project in the browser.
          const page = matched.slice(0, parsed.limit);
          const described = await Promise.all(page.map(async (record) => {
            const content = await service.getProjectHistory(record.id)
              .then((history) => {
                const state = history.headRevision.state;
                return {
                  hasDocument: Boolean(state.photoDocument),
                  layerCount: state.photoDocument ? summarizeLayerTree(state.photoDocument.layers).total : 0,
                  assetCount: (state.assets ?? []).length,
                };
              })
              .catch(() => null);
            return {
              projectId: record.id,
              name: record.name,
              kind: record.kind,
              updatedAt: record.updatedAt,
              lastOpenedAt: record.lastOpenedAt,
              headRevisionId: record.headRevisionId,
              hasRecoverableDraft: recoverableIds.has(record.id),
              canUndo: record.undoTransactionIds.length > 0,
              content,
              // The route, so an agent can tell the person where to look rather than
              // describing a project they cannot find.
              editorPath: `/editor/${record.id}`,
              summary: describeProjectForList(record.name, record.kind, content),
            };
          }));

          return {
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projects: described,
            totalCount: matched.length,
            returnedCount: described.length,
            truncated: matched.length > described.length,
            summary: described.length === 0
              ? (records.length === 0
                ? "This browser holds no Estro projects yet. Call manage_project with operation create to start one."
                : "No project matched those filters.")
              : `${described.length} project(s), newest first. Pass a projectId from this list to any other tool.`,
          };
        })();
      },
    },
    {
      name: "inspect_project",
      description: "Inspect one local Estro project, its durable revision, recovery state, snapshots, media, sequences, and a bounded transaction history. This never mutates the project.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 }, historyLimit: { type: "integer", minimum: 1, maximum: 20, default: 8 },
      }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        let parsed: z.infer<typeof inspectProjectSchema>;
        try { parsed = inspectProjectSchema.parse(input); } catch (error) { return visibleToolError(error, "Project inspection needs valid input"); }
        return execute("inspecting", "Inspecting project", `Reading project ${parsed.projectId}.`, async () => {
          const [history, persistence, assets, jobs, outputs] = await Promise.all([
            service.getProjectHistory(parsed.projectId),
            service.getProjectPersistence(parsed.projectId),
            assetService.listAssets(parsed.projectId, { limit: 500 }),
            jobService.listJobs(parsed.projectId, 10),
            outputService.listOutputs(parsed.projectId, 10),
          ]);
          const state = history.headRevision.state;
          return {
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projectId: history.project.id, revisionId: history.headRevision.id,
            project: { name: history.project.name, kind: history.project.kind, updatedAt: history.project.updatedAt },
            durability: persistence.durability, hasRecoverableDraft: persistence.hasRecoverableDraft,
            hasPendingAutosave: persistence.hasPendingAutosave,
            snapshots: persistence.snapshots.slice(0, 20),
            // A useful summary depth: enough to choose a target, never a dump of every field.
            content: {
              hasDocument: Boolean(state.photoDocument),
              documentId: state.photoDocument?.id ?? null,
              layerCount: state.photoDocument ? summarizeLayerTree(state.photoDocument.layers).total : 0,
              assetCount: assets.length,
              offlineAssetCount: assets.filter((record) => record.availability !== "available").length,
              unsupportedAssetCount: assets.filter((record) => record.editability === "unsupported").length,
              binCount: (state.bins ?? []).length,
              subclipCount: (state.subclips ?? []).length,
            },
            jobs: jobs.map((job) => ({ jobId: job.id, kind: job.kind, status: job.status, summary: summarizeJob(job) })),
            outputs: outputs.map((output) => ({ outputId: output.id, kind: output.kind, available: output.available, summary: summarizeOutput(output) })),
            transactions: history.transactions.slice(-parsed.historyLimit).map((transaction) => ({
              id: transaction.id, sequence: transaction.sequence, summary: transaction.summary, actor: transaction.actor,
              sourceRevisionId: transaction.sourceRevisionId, resultingRevisionId: transaction.resultingRevisionId,
              undoable: transaction.undoable, createdAt: transaction.createdAt,
            })),
          };
        })();
      },
    },
    {
      name: "manage_project",
      description: "Create, rename, duplicate, save, Save As, snapshot, or request deletion of a local Estro project. Deletion always pauses for visible user confirmation. Use create_sample when the user has no media of their own: a browser cannot open a file without a user gesture, so create_sample draws three pictures and builds two projects from them: a photo project with an image document, and a video project with a four-clip sequence. It returns both ids, so you have something real to edit in one call.",
      inputSchema: jsonSchema({
        operation: { enum: ["create", "create_sample", "rename", "duplicate", "save", "save_as", "snapshot", "request_delete"] },
        projectId: { type: "string" }, name: { type: "string", minLength: 1, maxLength: 120 },
        expectedRevisionId: { type: "string", minLength: 1, description: "Refuse the command if the project has moved past this revision. Accepted by every operation except create." },
      }, ["operation"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        let parsed: z.infer<typeof manageProjectSchema>;
        try { parsed = manageProjectSchema.parse(input); } catch (error) { return visibleToolError(error, "Project command needs valid input"); }
        const activityId = crypto.randomUUID();
        try {
          if (parsed.operation === "request_delete") {
            const project = await service.getProject(parsed.projectId);
            webMcpActivityStore.requestConfirmation({
              id: activityId, title: `Delete “${project.name}”?`,
              consequence: "This permanently removes the local project from this browser. Other projects are not affected.",
              projectId: project.id, projectName: project.name,
            }, () => service.deleteProject(project.id, { actor, intent: "Delete the project after explicit user confirmation.", expectedRevisionId: parsed.expectedRevisionId }));
            return toolResult({
              ok: false, schemaVersion: WEBMCP_SCHEMA_VERSION, status: "confirmation_required",
              confirmationId: activityId, projectId: project.id,
              consequence: "Permanent local deletion", permission: "explicit_user_confirmation", projectPreserved: true,
            });
          }

          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Applying project command", detail: `Running ${parsed.operation}.`, projectId: "projectId" in parsed ? parsed.projectId : undefined });
          let payload: Record<string, unknown>;
          if (parsed.operation === "create") {
            const project = await service.createProject({ name: parsed.name, kind: "unassigned" }, { actor });
            payload = await resultForProjectCreation(service, project, `Created “${project.name}”.`);
          } else if (parsed.operation === "create_sample") {
            const sample = await buildSampleProject({
              projects: service as never, assets: assetService as never,
              layers: layerService as never,
            });
            const project = await service.getProject(sample.projectId);
            payload = {
              ...(await resultForProjectCreation(service, project, sample.summary)),
              documentId: sample.documentId,
              assetIds: sample.assetIds,
              warnings: sample.warnings,
              editorPath: `/editor/${sample.projectId}`,
              summary: `${sample.summary} Everything in it is editable through the ordinary tools.`,
            };
          } else if (parsed.operation === "rename") {
            const result = await service.renameProject({ projectId: parsed.projectId, name: parsed.name }, { actor, expectedRevisionId: parsed.expectedRevisionId });
            await service.waitForAutosave(result.project.id);
            payload = { ...resultForMutation(result), durability: "durable" };
          } else if (parsed.operation === "duplicate") {
            const project = await service.duplicateProject(parsed.projectId, { actor });
            payload = await resultForProjectCreation(service, project, `Created “${project.name}” as a separate project.`);
          } else if (parsed.operation === "save_as") {
            const project = await service.saveProjectAs(parsed.projectId, parsed.name, { actor });
            payload = await resultForProjectCreation(service, project, `Saved a separate project as “${project.name}”.`);
          } else if (parsed.operation === "snapshot") {
            payload = resultForMutation(await service.createSnapshot(parsed.projectId, parsed.name, { actor, expectedRevisionId: parsed.expectedRevisionId }));
          } else {
            // Save promotes durability rather than committing a revision, so it has no transaction.
            // State that explicitly instead of omitting the fields every other mutation returns.
            const durability = await service.saveProject(parsed.projectId);
            payload = {
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              transactionId: null, undoToken: null, previousRevisionId: null,
              resultingRevisionId: durability.durableRevisionId, affectedIds: [parsed.projectId],
              normalizedParameters: {}, warnings: [], summary: "Saved the current project revision.",
              undoAvailable: false, durability: "durable",
            };
          }
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: payload.summary as string, detail: "The result is durable and inspectable.", projectId: payload.projectId as string, transactionId: payload.transactionId as string | undefined, undoProjectId: payload.undoAvailable ? payload.projectId as string : undefined });
          return toolResult(payload);
        } catch (error) {
          const parsedError = toProjectError(error);
          webMcpActivityStore.show({ id: activityId, stage: "failed", title: "Project command failed", detail: parsedError.message });
          return errorEnvelope(parsedError);
        }
      },
    },
    {
      name: "propose_transaction",
      description: "Validate and normalize an ordered Estro project transaction without mutating the project. The proposal expires and is bound to its source revision.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        operations: { type: "array", minItems: 1, maxItems: 10, items: { oneOf: [
          jsonSchema({ type: { const: "rename_project" }, name: { type: "string", minLength: 1, maxLength: 120 } }, ["type", "name"]),
          jsonSchema({ type: { const: "create_snapshot" }, name: { type: "string", minLength: 1, maxLength: 120 } }, ["type", "name"]),
        ] } },
      }, ["projectId", "operations"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = proposalInputSchema.parse(input);
          webMcpActivityStore.show({ id: crypto.randomUUID(), stage: "proposing", title: "Preparing a proposal", detail: `Validating ${parsed.operations.length} ordered changes.`, projectId: parsed.projectId });
          const proposal = await service.proposeTransaction(parsed, { actor });
          webMcpActivityStore.show({ id: proposal.id, stage: "proposing", title: "Proposal ready for review", detail: proposal.summary, projectId: proposal.projectId, proposalId: proposal.id });
          return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, proposalId: proposal.id, projectId: proposal.projectId, sourceRevisionId: proposal.sourceRevisionId, operations: proposal.requestedOperations, normalizedOperations: proposal.normalizedOperations, warnings: proposal.warnings, summary: proposal.summary, expiresAt: proposal.expiresAt, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Proposal could not be prepared"); }
      },
    },
    {
      name: "apply_transaction",
      description: "Atomically apply one reviewed Estro proposal if its source revision is still current. A stale or invalid proposal changes nothing.",
      inputSchema: jsonSchema({ proposalId: { type: "string", minLength: 1 } }, ["proposalId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = proposalIdSchema.parse(input);
          webMcpActivityStore.show({ id: parsed.proposalId, stage: "committing", title: "Applying reviewed transaction", detail: "Checking the source revision and committing every ordered change atomically." });
          const result = await service.applyProposal(parsed.proposalId, { actor });
          await service.waitForAutosave(result.project.id);
          const payload = { ...resultForMutation(result), durability: "durable" };
          webMcpActivityStore.show({ id: parsed.proposalId, stage: "complete", title: result.transaction.summary, detail: "All ordered changes committed as one transaction.", projectId: result.project.id, transactionId: result.transaction.id, undoProjectId: result.project.id });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Transaction was not applied"); }
      },
    },
    {
      name: "inspect_transaction",
      description: "Explain one Estro transaction, including actor, intent, operations, warnings, source revision, resulting revision, and Undo identity.",
      inputSchema: jsonSchema({ transactionId: { type: "string", minLength: 1 } }, ["transactionId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = transactionIdSchema.parse(input);
          const transaction = await service.inspectTransaction(parsed.transactionId);
          const payload = { ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, transactionId: transaction.id, projectId: transaction.projectId, actor: transaction.actor, intent: transaction.intent, summary: transaction.summary, operations: transaction.operations, affectedIds: transaction.affectedIds, warnings: transaction.warnings, sourceRevisionId: transaction.sourceRevisionId, resultingRevisionId: transaction.resultingRevisionId, undoAvailable: transaction.undoable };
          webMcpActivityStore.show({ id: transaction.id, stage: "complete", title: "Transaction inspected", detail: transaction.summary, projectId: transaction.projectId, transactionId: transaction.id, undoProjectId: transaction.undoable ? transaction.projectId : undefined });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Transaction inspection failed"); }
      },
    },
    {
      name: "list_presets",
      description: "List reusable presets and project templates available here, with the attributes each carries, its version, and whether it ships with Estro. Never changes anything.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        domain: { enum: ["layer", "document", "project", "brush", "effect_stack"] },
      }),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1).optional(),
            domain: presetDomainSchema.optional(),
          }).parse(input ?? {});
          const found = await presetService.listPresets(parsed);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false,
            presets: found.map((preset) => ({
              presetId: preset.id, name: preset.name, description: preset.description,
              domain: preset.domain, version: preset.version, builtIn: preset.builtIn,
              projectId: preset.projectId,
              attributes: attributesIn(preset.attributes),
              parameters: preset.attributes,
              summary: describeBundle(preset.attributes),
            })),
            attributesByDomain: ATTRIBUTES_BY_DOMAIN,
            summary: `${found.length} preset(s) available${parsed.domain ? ` for a ${parsed.domain}` : ""}.`,
          });
        } catch (error) { return visibleToolError(error, "Presets could not be listed"); }
      },
    },
    {
      name: "save_preset",
      description: "Save a named, reusable bundle of attributes, either from an existing object or from explicit parameters. Re-saving an existing preset raises its version rather than replacing it silently. Presets that ship with Estro cannot be overwritten.",
      inputSchema: jsonSchema({
        name: { type: "string", minLength: 1, maxLength: 80 },
        domain: { enum: ["layer", "document", "project", "brush", "effect_stack"] },
        description: { type: "string", maxLength: 240 },
        projectId: { type: "string", minLength: 1, description: "Set to keep the preset inside one project; omit to make it available everywhere." },
        presetId: { type: "string", minLength: 1, description: "Update this preset instead of creating a new one." },
        fromTargetId: { type: "string", minLength: 1, description: "Read the attributes from this object." },
        attributes: { type: "array", items: { type: "string" }, description: "Which attribute names to take from the object." },
        parameters: { type: "object", description: "Explicit attribute values, instead of reading an object." },
        expectedRevisionId: { type: "string", minLength: 1, description: "With fromTargetId: refuse if the project has moved past this revision, so the copied attributes are the ones you inspected." },
      }, ["name", "domain"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            name: z.string().trim().min(1).max(80),
            domain: presetDomainSchema,
            description: z.string().trim().max(240).nullish(),
            projectId: z.string().min(1).optional(),
            presetId: z.string().min(1).optional(),
            fromTargetId: z.string().min(1).optional(),
            attributes: z.array(z.string()).optional(),
            parameters: z.record(z.string(), z.unknown()).optional(),
            expectedRevisionId: z.string().min(1).optional(),
          }).parse(input);

          let bundle = parsed.parameters as never;
          if (parsed.fromTargetId) {
            if (!parsed.projectId) {
              throw new ProjectError("INVALID_INPUT", "Reading attributes from an object needs the project it is in.", { fieldPath: "projectId" });
            }
            // A preset is a copy of values as they stood at one revision. Reading them from a
            // revision the caller never saw produces a preset nobody asked for.
            if (parsed.expectedRevisionId) {
              const current = await service.getProjectHistory(parsed.projectId);
              if (current.headRevision.id !== parsed.expectedRevisionId) {
                throw new ProjectError("HISTORY_CONFLICT", `This project is at revision ${current.headRevision.id}, not ${parsed.expectedRevisionId}. Inspect it again before saving a preset from it.`, { fieldPath: "expectedRevisionId" });
              }
            }
            const copied = await presetService.copyAttributes({
              projectId: parsed.projectId, domain: parsed.domain, targetId: parsed.fromTargetId,
              attributes: parsed.attributes as never,
            });
            bundle = copied.attributes as never;
          }
          if (!bundle) {
            throw new ProjectError("INVALID_INPUT", "Give either an object to read from or explicit parameters.", { fieldPath: "parameters" });
          }

          const preset = await presetService.savePreset({
            name: parsed.name, domain: parsed.domain, attributes: bundle,
            description: parsed.description ?? null, projectId: parsed.projectId ?? null,
            presetId: parsed.presetId,
          });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false,
            presetId: preset.id, name: preset.name, version: preset.version, domain: preset.domain,
            attributes: attributesIn(preset.attributes), parameters: preset.attributes,
            summary: `Saved “${preset.name}” at version ${preset.version}: ${describeBundle(preset.attributes)}`,
          });
        } catch (error) { return visibleToolError(error, "The preset was not saved"); }
      },
    },
    {
      name: "apply_batch",
      description: "Apply one bundle of attributes to many objects at once, from a preset or from explicit parameters. Plans by default: every target is costed and the result says which would change, which would not, and why. Set apply to true to commit, as a single transaction and a single Undo step. The failure policy decides whether a batch that cannot reach every target proceeds at all.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        domain: { enum: ["layer", "document", "project", "brush", "effect_stack"] },
        targetIds: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, maxItems: 500 },
        presetId: { type: "string", minLength: 1 },
        parameters: { type: "object", description: "Explicit attribute values, instead of a preset." },
        policy: { enum: ["all_or_nothing", "best_effort"], default: "all_or_nothing" },
        expectedRevisionId: { type: "string" },
        apply: { type: "boolean", default: false },
      }, ["projectId", "domain", "targetIds"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            domain: presetDomainSchema,
            targetIds: z.array(z.string().min(1)).min(1).max(500),
            presetId: z.string().min(1).optional(),
            parameters: z.record(z.string(), z.unknown()).optional(),
            policy: batchFailurePolicySchema.default("all_or_nothing"),
            expectedRevisionId: z.string().min(1).optional(),
            apply: z.boolean().default(false),
          }).parse(input);

          if (!parsed.presetId && !parsed.parameters) {
            throw new ProjectError("INVALID_INPUT", "Give either a preset or explicit parameters to apply.", { fieldPath: "presetId" });
          }

          const context = { actor, intent: "Apply a batch through WebMCP.", expectedRevisionId: parsed.expectedRevisionId };
          if (parsed.apply) {
            webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Applying a batch", detail: `${parsed.targetIds.length} target(s).`, projectId: parsed.projectId });
          }

          const outcome = parsed.presetId
            ? await presetService.applyPreset({
              projectId: parsed.projectId, presetId: parsed.presetId, targetIds: parsed.targetIds,
              policy: parsed.policy, dryRun: !parsed.apply,
            }, context)
            : await presetService.pasteAttributes({
              projectId: parsed.projectId, domain: parsed.domain, targetIds: parsed.targetIds,
              attributes: parsed.parameters as never, policy: parsed.policy, dryRun: !parsed.apply,
            }, context);

          const plan = outcome.plan;
          const planPayload = {
            policy: plan.policy, applicableCount: plan.applicableCount, blockedCount: plan.blockedCount,
            canRun: plan.canRun, blockedReason: plan.blockedReason,
            items: plan.items.map((item) => ({
              targetId: item.targetId, wouldChange: item.applied,
              changed: item.changed, ignored: item.ignored, reason: item.reason,
            })),
          };

          if (!parsed.apply) {
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false, applied: false,
              projectId: parsed.projectId, ...planPayload, summary: plan.summary,
            });
          }

          await service.waitForAutosave(parsed.projectId);
          const mutation = outcome as never as ProjectMutationResult;
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: mutation.transaction.summary, detail: "Applied as one change, so one Undo returns every object.", projectId: parsed.projectId, transactionId: mutation.transaction.id, undoProjectId: parsed.projectId });
          return toolResult({ ...resultForMutation(mutation), durability: "durable", applied: true, ...planPayload });
        } catch (error) { return visibleToolError(error, "The batch was not applied"); }
      },
    },
    {
      name: "inspect_history",
      description: "Read a project's history: every transaction with its actor, intent, summary, affected objects, warnings, and revision pair, plus its named snapshots and which entries can be reverted on their own. Never changes anything.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
      }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
        const parsed = z.object({
          projectId: z.string().min(1),
          limit: z.number().int().min(1).max(200).default(50),
        }).parse(input);

        const history = await service.getProjectHistory(parsed.projectId);
        const persistence = await service.getProjectPersistence(parsed.projectId);
        const ordered = [...history.transactions].sort((a, b) => b.sequence - a.sequence).slice(0, parsed.limit);

        // Revertability is computed rather than guessed, so a caller can see which entries it
        // could act on before trying any of them.
        const entries = await Promise.all(ordered.map(async (transaction) => {
          const plan = await service.planRevert(parsed.projectId, transaction.id).catch(() => null);
          return {
            transactionId: transaction.id,
            sequence: transaction.sequence,
            kind: transaction.kind,
            summary: transaction.summary,
            intent: transaction.intent,
            actor: transaction.actor,
            affectedIds: transaction.affectedIds,
            warnings: transaction.warnings,
            sourceRevisionId: transaction.sourceRevisionId,
            resultingRevisionId: transaction.resultingRevisionId,
            createdAt: transaction.createdAt,
            isHeadRevision: transaction.resultingRevisionId === history.headRevision.id,
            revertable: plan?.safe ?? false,
            revertBlockedReason: plan && !plan.safe ? plan.reason : null,
            revertConflicts: plan?.conflicts ?? [],
          };
        }));

        return toolResult({
          ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false,
          projectId: parsed.projectId,
          headRevisionId: history.headRevision.id,
          transactionCount: history.transactions.length,
          returned: entries.length,
          canUndo: history.project.undoTransactionIds.length > 0,
          canRedo: history.project.redoTransactionIds.length > 0,
          transactions: entries,
          snapshots: persistence.snapshots.map((snapshot) => ({
            snapshotId: snapshot.id, name: snapshot.name, revisionId: snapshot.revisionId,
            transactionId: snapshot.transactionId, status: snapshot.status, createdAt: snapshot.createdAt,
          })),
          summary: `${history.transactions.length} change(s), ${persistence.snapshots.filter((entry) => entry.status === "active").length} snapshot(s), ${entries.filter((entry) => entry.revertable).length} revertable on their own.`,
        });
        } catch (error) { return visibleToolError(error, "History could not be read"); }
      },
    },
    {
      name: "revert_transaction",
      description: "Revert one past change that need not be the most recent. Plans by default and reports whether the revert is safe, which later changes block it, and over which objects; set apply to true to commit it. The reversal is recorded as a new transaction, so history is never rewritten.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        transactionId: { type: "string", minLength: 1 },
        expectedRevisionId: { type: "string" },
        apply: { type: "boolean", default: false },
      }, ["projectId", "transactionId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            transactionId: z.string().min(1),
            expectedRevisionId: z.string().min(1).optional(),
            apply: z.boolean().default(false),
          }).parse(input);

          const plan = await service.planRevert(parsed.projectId, parsed.transactionId);
          const planPayload = {
            transactionId: plan.transactionId, revertingSummary: plan.summary,
            safe: plan.safe, blockedReason: plan.reason,
            conflicts: plan.conflicts, affectedIds: plan.affectedIds,
            operationCount: plan.operations.length,
          };

          if (!parsed.apply) {
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false, applied: false,
              projectId: parsed.projectId, ...planPayload,
              summary: plan.safe
                ? `“${plan.summary}” can be reverted on its own. Call again with apply to commit it.`
                : `“${plan.summary}” cannot be reverted on its own. ${plan.reason}`,
            });
          }

          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Reverting a change", detail: `Reversing “${plan.summary}”.`, projectId: parsed.projectId });
          const result = await service.revertTransaction(parsed.projectId, parsed.transactionId, {
            actor, intent: "Revert a past change through WebMCP.", expectedRevisionId: parsed.expectedRevisionId,
          });
          await service.waitForAutosave(parsed.projectId);
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: result.transaction.summary, detail: "Recorded as a new change; the original entry remains in history.", projectId: parsed.projectId, transactionId: result.transaction.id, undoProjectId: parsed.projectId });
          return toolResult({
            ...resultForMutation(result), durability: "durable", applied: true, ...planPayload,
          });
        } catch (error) { return visibleToolError(error, "The revert was not applied"); }
      },
    },
    {
      name: "undo_transaction",
      description: "Undo the latest safe Estro transaction by immutable transaction ID, or return a structured dependency conflict without changing the project.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 }, transactionId: { type: "string", minLength: 1 },
        expectedRevisionId: { type: "string", minLength: 1, description: "Refuse the undo if the project has moved past this revision." },
      }, ["projectId", "transactionId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = undoSchema.parse(input);
          webMcpActivityStore.show({ id: parsed.transactionId, stage: "committing", title: "Undoing transaction", detail: `Checking that transaction ${parsed.transactionId} is still safe to undo.`, projectId: parsed.projectId });
          const result = await service.undoTransaction(parsed.projectId, parsed.transactionId, { actor, expectedRevisionId: parsed.expectedRevisionId });
          await service.waitForAutosave(parsed.projectId);
          const payload = { ...resultForMutation(result), durability: "durable" };
          webMcpActivityStore.show({ id: parsed.transactionId, stage: "complete", title: result.transaction.summary, detail: "The project returned to its previous revision.", projectId: parsed.projectId, transactionId: result.transaction.id, undoProjectId: parsed.projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Undo was not applied"); }
      },
    },
    {
      name: "inspect_document",
      description: "Inspect the current image document, exact dimensions, resolution, background, stable ID, and project revision without changing project or workspace state.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, revisionId: history.headRevision.id,
            document: history.headRevision.state.photoDocument ?? null,
            hasDocument: Boolean(history.headRevision.state.photoDocument), projectChanged: false,
          });
        } catch (error) { return visibleToolError(error, "Document inspection failed"); }
      },
    },
    {
      name: "apply_document_operation",
      description: "Create one empty non-destructive image document in a photo or unassigned project through Estro's shared revision and Undo engine.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        expectedRevisionId: { type: "string", minLength: 1, description: "Optional. Refuse if the project has moved past this revision." },
        widthPx: { type: "integer", minimum: 1, maximum: 32768 },
        heightPx: { type: "integer", minimum: 1, maximum: 32768 },
        resolutionPpi: { type: "number", minimum: 1, maximum: 2400 },
        orientation: { enum: ["landscape", "portrait", "square"] },
        background: { oneOf: [
          jsonSchema({ type: { const: "transparent" } }, ["type"]),
          jsonSchema({ type: { const: "solid" }, color: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" } }, ["type", "color"]),
        ] },
      // expectedRevisionId is optional here as it is everywhere else: a document is created
      // into an empty project, so there is usually no revision the caller has read. The JSON
      // schema listed it as required while the Zod schema did not, and the JSON schema is
      // what a model reads, so callers were being told to supply a value they did not have.
      }, ["projectId", "widthPx", "heightPx", "resolutionPpi", "orientation", "background"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = createPhotoDocumentInputSchema.parse(input);
          webMcpActivityStore.show({ id: crypto.randomUUID(), stage: "committing", title: "Creating image document", detail: `Preparing ${parsed.widthPx} × ${parsed.heightPx} pixels.`, projectId: parsed.projectId });
          const result = await service.createPhotoDocument(parsed, { actor, intent: "Create an empty image document through WebMCP." });
          await service.waitForAutosave(result.project.id);
          const payload = { ...resultForMutation(result), document: result.headRevision.state.photoDocument, durability: "durable", projectChanged: true };
          webMcpActivityStore.show({ id: result.transaction.id, stage: "complete", title: result.transaction.summary, detail: `Document ${result.headRevision.state.photoDocument?.id} is ready.`, projectId: result.project.id, transactionId: result.transaction.id, undoProjectId: result.project.id });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Image document was not created"); }
      },
    },
    {
      name: "resize_document",
      description: "Resize the canvas frame or resample the whole image, with an explicit anchor, resampling algorithm, and aspect lock. Returns the normalized size, the algorithm actually used, the resampling job IDs it started, and any content that now falls outside the frame. A canvas resize reports no algorithm because it resamples nothing.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        mode: { enum: ["canvas", "image"] },
        widthPx: { type: "integer", minimum: 1, maximum: 32768 },
        heightPx: { type: "integer", minimum: 1, maximum: 32768 },
        anchor: { enum: ["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"] },
        resampleAlgorithm: { enum: ["nearest", "bilinear", "lanczos3", "browser-smooth"] },
        lockAspect: { type: "boolean" },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "mode", "widthPx", "heightPx"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            mode: z.enum(["canvas", "image"]),
            widthPx: z.number().int().min(1).max(32768),
            heightPx: z.number().int().min(1).max(32768),
            anchor: z.enum(["top-left", "top-center", "top-right", "middle-left", "center", "middle-right", "bottom-left", "bottom-center", "bottom-right"]).default("center"),
            resampleAlgorithm: z.enum(["nearest", "bilinear", "lanczos3", "browser-smooth"]).default("lanczos3"),
            lockAspect: z.boolean().default(false),
            expectedRevisionId: z.string().min(1).optional(),
          }).parse(input);

          const before = await service.getProjectHistory(parsed.projectId);
          if (parsed.expectedRevisionId && parsed.expectedRevisionId !== before.headRevision.id) {
            throw new ProjectError("HISTORY_CONFLICT", "The project changed before this resize could be applied. Inspect the latest revision and try again.");
          }
          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Resizing the document", detail: `${parsed.mode === "canvas" ? "Re-framing" : "Resampling"} to ${parsed.widthPx} × ${parsed.heightPx}.`, projectId: parsed.projectId });
          const result = await layerService.resizeDocument(parsed.projectId, parsed, { actor, intent: "Resize the document through WebMCP.", expectedRevisionId: parsed.expectedRevisionId });
          await service.waitForAutosave(parsed.projectId);
          const payload = {
            ...resultForMutation(result), durability: "durable", projectChanged: true,
            requested: { widthPx: parsed.widthPx, heightPx: parsed.heightPx },
            normalized: { widthPx: result.normalizedWidthPx, heightPx: result.normalizedHeightPx },
            anchor: parsed.anchor,
            // Reported from the result rather than echoed from the request: a canvas resize
            // resamples nothing, and claiming an algorithm it did not use would be the same
            // untruth the interface used to tell.
            resampleAlgorithm: result.resampleAlgorithm,
            resampleJobIds: result.resampleJobIds,
            resampled: result.resampleJobIds.length > 0,
            warnings: [...result.transaction.warnings, ...result.warnings],
          };
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: result.transaction.summary, detail: "Undo remains available through the returned token.", projectId: parsed.projectId, transactionId: result.transaction.id, undoProjectId: parsed.projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Resize failed"); }
      },
    },
    {
      name: "inspect_workspace",
      description: "Inspect viewport, panels, overlays, tool, selection, preview quality, active sequence, monitor context, media view, comparison, and timeline view state. Never changes the project.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const [workspace, history] = await Promise.all([workspaceService.getWorkspace(parsed.projectId), service.getProjectHistory(parsed.projectId)]);
          return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, revisionId: history.headRevision.id, workspace, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Workspace inspection failed"); }
      },
    },
    {
      name: "set_workspace",
      description: "Set viewport, panels, dock, tool, overlays, guides, distraction-free mode, solo, isolate, preview quality, active sequence, monitor, source marks, media view, comparison, or timeline view. These are view changes and never create a project revision.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        change: { oneOf: [
          jsonSchema({ type: { const: "viewport" }, viewport: { type: "object" } }, ["type", "viewport"]),
          jsonSchema({ type: { const: "panel" }, panel: { enum: ["left", "inspector"] }, open: { type: "boolean" }, widthPx: { type: "integer" } }, ["type", "panel"]),
          jsonSchema({ type: { const: "dock" }, leadingPanel: { enum: ["left", "inspector"] } }, ["type", "leadingPanel"]),
          jsonSchema({ type: { const: "tool" }, tool: { enum: ["select", "hand", "zoom"] } }, ["type", "tool"]),
          jsonSchema({ type: { const: "overlay" }, overlay: { enum: ["rulers", "guides", "grid", "snapping", "safeAreas", "pixelGrid"] }, enabled: { type: "boolean" } }, ["type", "overlay", "enabled"]),
          jsonSchema({ type: { const: "guide" }, action: { enum: ["add", "update", "remove", "clear"] }, guideId: { type: "string" }, axis: { enum: ["x", "y"] }, positionPx: { type: "number", minimum: -32768, maximum: 65536 } }, ["type", "action"]),
          jsonSchema({ type: { const: "distraction_free" }, enabled: { type: "boolean" } }, ["type", "enabled"]),
          jsonSchema({ type: { const: "solo" }, layerIds: { type: "array", items: { type: "string" }, maxItems: 500 } }, ["type", "layerIds"]),
          jsonSchema({ type: { const: "isolate" }, groupId: { type: ["string", "null"] } }, ["type", "groupId"]),
          jsonSchema({ type: { const: "preview_quality" }, quality: { enum: ["draft", "balanced", "full"] } }, ["type", "quality"]),
          jsonSchema({ type: { const: "active_sequence" }, sequenceId: { type: ["string", "null"] } }, ["type", "sequenceId"]),
          jsonSchema({ type: { const: "monitor" }, monitor: { enum: ["program", "source"] } }, ["type", "monitor"]),
          jsonSchema({ type: { const: "source_monitor" }, itemType: { enum: ["asset", "subclip", null] }, itemId: { type: ["string", "null"] }, inPointSeconds: { type: ["number", "null"] }, outPointSeconds: { type: ["number", "null"] } }, ["type", "itemType", "itemId"]),
          jsonSchema({ type: { const: "media_view" }, view: { enum: ["grid", "list", "bins", "storyboard"] }, binId: { type: ["string", "null"] } }, ["type", "view"]),
          jsonSchema({ type: { const: "comparison" }, mode: { enum: ["off", "hold", "toggle", "split", "side_by_side"] }, baseline: { enum: ["original_import", "previous_revision", "chosen_revision"] }, revisionId: { type: ["string", "null"] }, splitPosition: { type: "number", minimum: 0, maximum: 1 } }, ["type", "mode"]),
          jsonSchema({ type: { const: "timeline_view" }, pixelsPerSecond: { type: "number" }, scrollSeconds: { type: "number" }, snapping: { type: "boolean" }, linkedSelection: { type: "boolean" }, rippleMode: { type: "boolean" }, audibleScrub: { type: "boolean" }, trackHeightPx: { type: "integer" } }, ["type"]),
        ] },
      }, ["projectId", "change"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = workspaceInputSchema.parse(input);
          const before = await service.getProjectHistory(parsed.projectId);
          const workspace = await workspaceService.applyWorkspaceChange(parsed.projectId, parsed.change);
          const after = await service.getProjectHistory(parsed.projectId);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            revisionId: after.headRevision.id, workspace, projectChanged: false,
            revisionUnchanged: before.headRevision.id === after.headRevision.id,
            summary: "Updated the local editor workspace. This is view state and creates no revision.",
          });
        } catch (error) { return visibleToolError(error, "Workspace preference was not changed"); }
      },
    },
    {
      name: "inspect_selection",
      description: "Inspect the current selection, including multiple selected layers or clips, without changing it.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const [workspace, history] = await Promise.all([workspaceService.getWorkspace(parsed.projectId), service.getProjectHistory(parsed.projectId)]);
          return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, revisionId: history.headRevision.id, selection: workspace.selection, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Selection inspection failed"); }
      },
    },
    {
      name: "set_selection",
      description: "Select the canvas, the document, one or more layers, clips, tracks, assets, sequences, or an output. Validated against what actually exists, and never changes project content.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        selectionType: { enum: ["none", "canvas", "document", "layer", "clip", "track", "asset", "sequence", "output"] },
        targetId: { type: ["string", "null"] },
        targetIds: { type: "array", items: { type: "string" }, maxItems: 500 },
      }, ["projectId", "selectionType", "targetId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = selectionInputSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          const state = history.headRevision.state;

          // Selecting something that is not there would leave the interface pointing at
          // nothing, so each kind is checked against real project state.
          if (parsed.selectionType === "canvas" && parsed.targetId !== "canvas-stage") {
            throw new ProjectError("INVALID_INPUT", "Canvas selection requires targetId canvas-stage.", { fieldPath: "targetId" });
          }
          if (parsed.selectionType === "document" && parsed.targetId !== state.photoDocument?.id) {
            throw new ProjectError("INVALID_INPUT", "Document selection requires the current stable document ID.", { fieldPath: "targetId" });
          }
          if (parsed.selectionType === "layer" && parsed.targetId && !findLayer(state.photoDocument?.layers ?? [], parsed.targetId)) {
            throw new ProjectError("INVALID_INPUT", "That layer is not in this document.", { fieldPath: "targetId" });
          }
          if (parsed.selectionType === "asset" && parsed.targetId && !(state.assets ?? []).some((asset) => asset.id === parsed.targetId)) {
            throw new ProjectError("INVALID_INPUT", "That asset is not registered in this project.", { fieldPath: "targetId" });
          }

          const workspace = await workspaceService.applyWorkspaceChange(parsed.projectId, {
            type: "selection", selectionType: parsed.selectionType, targetId: parsed.targetId, targetIds: parsed.targetIds,
          });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            revisionId: history.headRevision.id, selection: workspace.selection, projectChanged: false,
            summary: parsed.selectionType === "none" ? "Cleared the workspace selection." : `Selected ${parsed.selectionType} ${parsed.targetId}.`,
          });
        } catch (error) { return visibleToolError(error, "Selection was not changed"); }
      },
    },
    {
      name: "focus_ui",
      description: "Reveal and focus one stable semantic editor control so the user can see what an operation affected. Navigation only; it never changes project or workspace data.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 }, targetId: { type: "string", enum: semanticTargets.map((target) => target.id) } }, ["projectId", "targetId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = focusInputSchema.parse(input);
          const [history, workspace] = await Promise.all([service.getProjectHistory(parsed.projectId), workspaceService.getWorkspace(parsed.projectId)]);
          const target = getSemanticTarget(parsed.targetId);
          if (!target) throw new ProjectError("INVALID_INPUT", "Use a semantic target ID returned by get_capabilities or search_commands.", { fieldPath: "targetId" });
          if (parsed.targetId === "document-canvas" && !history.headRevision.state.photoDocument) throw new ProjectError("INVALID_INPUT", "Create an image document before focusing the document canvas.", { fieldPath: "targetId" });
          const request = focusStore.request(parsed.projectId, target.id, "webmcp");
          webMcpActivityStore.show({
            id: request.id,
            stage: request.delivered ? "targeting" : "failed",
            title: request.delivered ? `Focusing ${target.label}` : `Nothing was open to focus`,
            detail: request.delivered
              ? `Revealing semantic target ${target.id}.`
              : `No editor is open, so ${target.label} could not be revealed.`,
            projectId: parsed.projectId,
          });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            revisionId: history.headRevision.id, target, focusRequestId: request.id,
            selection: workspace.selection, projectChanged: false,
            // Reported rather than assumed: an editor may not be open, and an agent that
            // tells the user "look at the highlighted control" when nothing is highlighted
            // is worse than one that says the editor has to be opened first.
            focusDelivered: request.delivered,
            editorPath: `/editor/${parsed.projectId}`,
            summary: request.delivered
              ? `Focused ${target.label}.`
              : `No Estro editor is open, so nothing was focused. Ask the user to open /editor/${parsed.projectId}, then call focus_ui again.`,
          });
        } catch (error) { return visibleToolError(error, "Editor target could not be focused"); }
      },
    },
    {
      name: "search_commands",
      description: "Search every manual editor command by name, category, shortcut, or keyword, with the semantic target each one acts on. Never changes state.",
      inputSchema: jsonSchema({ query: { type: "string", maxLength: 120, default: "" } }),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = searchCommandsSchema.parse(input);
          const results = searchEditorCommands(parsed.query);
          return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, query: parsed.query, totalCommands: editorCommands.length, resultCount: results.length, results, projectChanged: false });
        } catch (error) { return visibleToolError(error, "Command search needs valid input"); }
      },
    },
    {
      name: "inspect_assets",
      description: "Search the project's media with structured filters over kind, format, availability, editability, proxy state, duration, pixels, and bin. Returns stable IDs, technical metadata, and which fields matched. Never decodes media and never changes state.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        query: { type: "string", maxLength: 120 },
        kinds: { type: "array", items: { enum: ["image", "video", "audio"] }, maxItems: 3 },
        mediaTypes: { type: "array", items: { type: "string" }, maxItems: 16 },
        availability: { type: "array", items: { enum: ["available", "missing", "permission_required", "unsupported"] }, maxItems: 4 },
        editability: { type: "array", items: { enum: ["editable", "proxy_required", "import_only", "unsupported"] }, maxItems: 4 },
        proxyState: { enum: ["any", "present", "absent"] },
        binId: { type: ["string", "null"] },
        minDurationSeconds: { type: ["number", "null"] },
        maxDurationSeconds: { type: ["number", "null"] },
        minPixels: { type: ["integer", "null"] },
        maxPixels: { type: ["integer", "null"] },
        sortBy: { enum: ["name", "addedAt", "byteSize", "pixels", "duration"] },
        direction: { enum: ["asc", "desc"] },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const { projectId, ...search } = assetSearchInputSchema.parse(input);
          const [result, history] = await Promise.all([
            assetService.searchAssets(projectId, search),
            service.getProjectHistory(projectId),
          ]);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId,
            revisionId: history.headRevision.id, projectChanged: false,
            resultCount: result.matchedCount, totalCount: result.totalCount,
            activeFilters: result.activeFilters,
            filterSummary: describeActiveFilters(search).join("; ") || "no filters",
            assets: result.records.map((record) => ({
              ...describeAsset(record),
              matchedFields: result.matches[record.id] ?? [],
            })),
          });
        } catch (error) { return visibleToolError(error, "Asset inspection failed"); }
      },
    },
    {
      name: "inspect_asset",
      description: "Inspect one asset by stable ID: detected container and streams, dimensions, duration, content hash, source revision, durability, editability, derivatives, and every layer, clip, and subclip that uses it.",
      inputSchema: jsonSchema({ assetId: { type: "string", minLength: 1 } }, ["assetId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = assetIdSchema.parse(input);
          const record = await assetService.getAsset(parsed.assetId);
          const [history, usage] = await Promise.all([
            service.getProjectHistory(record.projectId),
            assetService.findUsages(record.projectId, record.id),
          ]);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projectId: record.projectId, revisionId: history.headRevision.id, projectChanged: false,
            ...describeAsset(record),
            usage: {
              layerIds: usage.layerIds,
              inUse: usage.layerIds.length > 0,
            },
            capabilityImplications: {
              canAddAsLayer: record.reference.kind === "image" && record.availability === "available",
              needsProxy: record.editability === "proxy_required",
            },
          });
        } catch (error) { return visibleToolError(error, "Asset inspection failed"); }
      },
    },
    {
      name: "manage_asset",
      description: "Update tags, remove an asset through the shared Undo engine, re-check availability, or start a thumbnail, proxy, or waveform job. Importing and relinking files need the visible interface, because a browser only grants file access from a user gesture; those operations focus the right control and explain what to do.",
      inputSchema: jsonSchema({
        operation: { enum: ["update_tags", "remove", "refresh_availability", "request_import", "request_relink", "plan_relink", "generate_proxy", "generate_thumbnail", "generate_waveform"] },
        candidates: { type: "array", maxItems: 2000, description: "For plan_relink: the files available to relink from, each {key, name, byteSize, contentHash}. A key is anything that identifies the file to you; Estro only matches on it.", items: { type: "object" } },
        assetId: { type: "string" }, projectId: { type: "string" },
        tags: { type: "array", items: { type: "string", minLength: 1, maxLength: 48 }, maxItems: 32 },
        quality: { enum: ["draft", "balanced"] },
        expectedRevisionId: { type: "string", minLength: 1, description: "For remove: refuse if the project has moved past this revision." },
      }, ["operation"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = manageAssetSchema.parse(input);

          if (parsed.operation === "refresh_availability") {
            webMcpActivityStore.show({ id: activityId, stage: "inspecting", title: "Checking media sources", detail: "Re-reading each original file reference.", projectId: parsed.projectId });
            const updated = await assetService.refreshAvailability(parsed.projectId);
            const payload = {
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
              changedCount: updated.length,
              changed: updated.map((record) => ({ assetId: record.id, availability: record.availability, reason: record.availabilityReason })),
              summary: updated.length ? `${updated.length} media source(s) changed availability.` : "Every media source is still readable.",
            };
            webMcpActivityStore.show({ id: activityId, stage: "complete", title: payload.summary, detail: "Availability is runtime state and does not change a revision.", projectId: parsed.projectId });
            return toolResult(payload);
          }

          if (parsed.operation === "request_import") {
            const request = focusStore.request(parsed.projectId, "media-import", "webmcp");
            webMcpActivityStore.show({
              id: request.id, stage: "awaiting_confirmation",
              title: "Import needs a user action",
              detail: request.delivered
                ? "The Import media control is focused. Choosing files there is the only way a browser grants access to them."
                : "No editor is open. Import is only reachable inside a project.",
              projectId: parsed.projectId,
            });
            return toolResult({
              ok: false, schemaVersion: WEBMCP_SCHEMA_VERSION, status: "user_action_required",
              projectId: parsed.projectId, projectChanged: false,
              focusTargetId: "media-import", focusRequestId: request.id,
              focusDelivered: request.delivered,
              editorPath: `/editor/${parsed.projectId}`,
              permission: "user_gesture_required",
              summary: request.delivered
                ? "Estro cannot open a file on its own. The Import media control is now focused so the user can choose files."
                : `Estro cannot open a file on its own, and no editor is open to focus. Ask the user to open /editor/${parsed.projectId} and use Import media there.`,
            });
          }

          if (parsed.operation === "plan_relink") {
            /*
             * Matching many offline assets against many files at once, which is what happens
             * when a project moves machines and a whole folder has to be found again.
             *
             * Nothing is relinked here. The plan says how certain each match is and why, and
             * only an exact byte match is marked automatic — repointing an edit at a different
             * take is far worse than leaving it offline, and "same name, same size" is not
             * proof. Applying it still needs the user's own file picker.
             */
            const records = await assetService.listAssets(parsed.projectId, { limit: 500 });
            const offline = records
              .filter((record) => record.availability !== "available")
              .map((record) => ({
                assetId: record.id,
                name: record.reference.name,
                byteSize: record.reference.byteSize,
                contentHash: record.reference.contentHash,
              }));

            if (offline.length === 0) {
              return toolResult({
                ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
                projectChanged: false, matches: [], unmatched: [], unused: parsed.candidates.map((c) => c.key),
                summary: "Nothing in this project is offline, so there is nothing to relink.",
              });
            }

            const plan = planRelink(offline, parsed.candidates.map((candidate) => ({
              key: candidate.key,
              name: candidate.name,
              byteSize: candidate.byteSize ?? 0,
              contentHash: candidate.contentHash ?? null,
            })));
            const focus = focusStore.request(parsed.projectId, "media-relink", "webmcp");
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false,
              matches: plan.matches, unmatched: plan.unmatched, unused: plan.unused,
              automaticCount: plan.matches.filter((match) => match.automatic).length,
              focusTargetId: "media-relink", focusRequestId: focus.id, focusDelivered: focus.delivered,
              permission: "user_gesture_required",
              summary: `${plan.summary} Nothing was relinked: choosing each file is a user action.`,
            });
          }

          if (parsed.operation === "request_relink") {
            const record = await assetService.getAsset(parsed.assetId);
            const usage = await assetService.findUsages(record.projectId, record.id);
            const request = focusStore.request(record.projectId, "media-relink", "webmcp");
            webMcpActivityStore.show({
              id: request.id, stage: "awaiting_confirmation", title: `Relink “${record.reference.name}”`,
              detail: request.delivered
                ? "The Relink control is focused. Choosing the replacement file needs a user action."
                : "No editor is open. Relink is only reachable inside the project.",
              projectId: record.projectId,
            });
            return toolResult({
              ok: false, schemaVersion: WEBMCP_SCHEMA_VERSION, status: "user_action_required",
              projectId: record.projectId, assetId: record.id, projectChanged: false,
              availability: record.availability, availabilityReason: record.availabilityReason,
              affectedLayerIds: usage.layerIds,
              focusTargetId: "media-relink", focusRequestId: request.id,
              focusDelivered: request.delivered,
              editorPath: `/editor/${record.projectId}`,
              permission: "user_gesture_required",
              summary: `“${record.reference.name}” is ${record.availability}. The Relink control is focused; every edit that uses it will be preserved.`,
            });
          }

          if (parsed.operation === "update_tags") {
            const record = await assetService.updateTags(parsed.assetId, parsed.tags);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, assetId: record.id, projectId: record.projectId,
              tags: record.tags, projectChanged: false, revisionUnchanged: true,
              summary: `Updated tags for “${record.reference.name}”.`,
            });
          }

          if (parsed.operation === "generate_proxy" || parsed.operation === "generate_thumbnail" || parsed.operation === "generate_waveform") {
            const record = await assetService.getAsset(parsed.assetId);
            const started = parsed.operation === "generate_proxy"
              ? await assetService.startProxyJob(parsed.assetId, parsed.quality)
              : parsed.operation === "generate_thumbnail"
                ? await assetService.startThumbnailJob(parsed.assetId)
                : await assetService.startWaveformJob(parsed.assetId);
            webMcpActivityStore.show({ id: started.jobId, stage: "queued", title: `Generating a derivative for ${record.reference.name}`, detail: "Watch the job for progress; it can be cancelled.", projectId: record.projectId });
            followJob(started.jobId, started.jobId, record.projectId, `Generating a derivative for ${record.reference.name}`);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, assetId: record.id, projectId: record.projectId,
              jobId: started.jobId, projectChanged: false, sourceRevision: record.reference.sourceRevision,
              summary: `Started ${parsed.operation.replace("generate_", "")} generation as job ${started.jobId}. Derivatives are reproducible and never change project history.`,
            });
          }

          const record = await assetService.getAsset(parsed.assetId);
          const usage = await assetService.findUsages(record.projectId, record.id);
          webMcpActivityStore.show({ id: activityId, stage: "committing", title: `Removing ${record.reference.name}`, detail: "Applying a reversible project mutation.", projectId: record.projectId });
          const result = await assetService.removeAsset(parsed.assetId, { actor, intent: "Remove media through WebMCP.", expectedRevisionId: parsed.expectedRevisionId });
          await service.waitForAutosave(record.projectId);
          const payload = {
            ...resultForMutation(result), assetId: parsed.assetId, durability: "durable", projectChanged: true,
            affectedLayerIds: usage.layerIds,
          };
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: result.transaction.summary, detail: "Undo remains available through the returned token.", projectId: record.projectId, transactionId: result.transaction.id, undoProjectId: record.projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Media command failed"); }
      },
    },
    {
      name: "preview_revision",
      description: "Render a bounded preview of one asset at a named quality and return it with the exact project revision, source revision, and the derivative's real dimensions. This is a read: it never changes project state.",
      inputSchema: jsonSchema({
        assetId: { type: "string", minLength: 1 },
        quality: { enum: ["draft", "balanced", "full"], default: "draft" },
        focus: { type: "boolean", default: false },
      }, ["assetId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = previewRevisionSchema.and(z.object({ focus: z.boolean().default(false) })).parse(input);
          webMcpActivityStore.show({ id: activityId, stage: "running", title: "Rendering preview", detail: `Preparing a ${parsed.quality} preview.` });
          const preview = await assetService.renderPreview(parsed.assetId, parsed.quality);
          const record = await assetService.getAsset(parsed.assetId);

          let focusRequestId: string | null = null;
          if (parsed.focus) {
            focusRequestId = focusStore.request(record.projectId, "panel-media", "webmcp").id;
          }

          const payload = {
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, assetId: parsed.assetId,
            requestedQuality: preview.requestedQuality, effectiveQuality: preview.effectiveQuality,
            // The revision travels with the render so the caller can verify what it depicts.
            revisionId: preview.revisionId, sourceRevision: preview.sourceRevision, projectChanged: false,
            previewRef: preview.key,
            // The derivative's own size, never the original's: a 640px proxy is not 4000px.
            widthPx: preview.width, heightPx: preview.height,
            mediaType: preview.mediaType, byteSize: preview.byteSize,
            fromCache: preview.fromCache, usedProxy: preview.usedProxy,
            warnings: preview.warnings, focusRequestId,
            summary: `Rendered a ${preview.width} × ${preview.height} ${preview.effectiveQuality} preview${preview.fromCache ? " from cache" : ""}.`,
          };
          webMcpActivityStore.show({ id: activityId, stage: "preview_ready", title: payload.summary, detail: `Taken from revision ${preview.revisionId}.`, projectId: record.projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Preview could not be rendered"); }
      },
    },
    {
      name: "inspect_organization",
      description: "Inspect bins, bin membership, storyboard positions, subclips, and source markers with stable IDs. Organization is project state, so it is versioned and undoable, but this call never changes it.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const [organization, history] = await Promise.all([
            organizationService.getOrganization(parsed.projectId),
            service.getProjectHistory(parsed.projectId),
          ]);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            revisionId: history.headRevision.id, projectChanged: false,
            bins: organization.bins,
            items: organization.items,
            subclips: organization.subclips.map((subclip) => ({
              ...subclip,
              durationSeconds: toSeconds(subclip.sourceRange.duration),
            })),
            sourceMarkers: organization.sourceMarkers,
            summary: `${organization.bins.length} bin(s), ${organization.subclips.length} subclip(s), ${organization.sourceMarkers.length} source marker(s).`,
          });
        } catch (error) { return visibleToolError(error, "Organization inspection failed"); }
      },
    },
    {
      name: "manage_organization",
      description: "Create, rename, move, or delete bins; move items between bins; set storyboard positions; reorder items; create, rename, or delete subclips; and manage source markers. Each is one reversible project mutation that never changes where media lives.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        operation: { enum: ["create_bin", "rename_bin", "move_bin", "delete_bin", "move_items", "set_storyboard_position", "reorder_item", "create_subclip", "rename_subclip", "delete_subclip", "add_source_marker", "remove_source_marker"] },
        binId: { type: "string" }, parentBinId: { type: ["string", "null"] },
        name: { type: "string", minLength: 1, maxLength: 160 },
        confirm: { type: "boolean" },
        items: { type: "array", items: { type: "object" }, maxItems: 500 },
        itemType: { enum: ["asset", "subclip", "sequence"] }, itemId: { type: "string" },
        x: { type: ["number", "null"] }, y: { type: ["number", "null"] },
        toIndex: { type: "integer", minimum: 0 },
        assetId: { type: "string" }, subclipId: { type: "string" }, markerId: { type: "string" },
        sourceRange: { type: "object" }, time: { type: "object" },
        comment: { type: "string", maxLength: 500 }, color: { type: "string" }, duration: { type: ["object", "null"] },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "operation"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const { projectId, expectedRevisionId, ...rest } = z.object({
            projectId: z.string().min(1), expectedRevisionId: z.string().min(1).optional(),
          }).passthrough().parse(input);
          const command = organizationCommandSchema.parse(rest);

          const before = await service.getProjectHistory(projectId);
          if (expectedRevisionId && expectedRevisionId !== before.headRevision.id) {
            throw new ProjectError("HISTORY_CONFLICT", "The project changed before this change could be applied. Inspect the latest revision and try again.");
          }

          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Organizing media", detail: `Running ${command.operation}.`, projectId });
          const result = await organizationService.apply(projectId, command, { actor, intent: `Run ${command.operation} through WebMCP.`, expectedRevisionId });
          await service.waitForAutosave(projectId);
          const payload = {
            ...resultForMutation(result), durability: "durable", projectChanged: true,
            operation: command.operation, createdId: result.createdId,
            warnings: [...result.transaction.warnings, ...result.warnings],
          };
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: result.transaction.summary, detail: "Undo remains available through the returned token.", projectId, transactionId: result.transaction.id, undoProjectId: projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Organization command failed"); }
      },
    },
    {
      name: "inspect_job",
      description: "Inspect one job or list a project's recent jobs, with monotonic status, stage, real progress when measurable, priority, warnings, failure codes, retry eligibility, derivative and output IDs, and whether it ran off the interface thread.",
      inputSchema: {
        type: "object", additionalProperties: false,
        properties: {
          jobId: { type: "string", description: "Inspect this one job." },
          projectId: { type: "string", description: "List this project's recent jobs instead." },
          limit: { type: "integer", minimum: 1, maximum: 50, description: "With projectId: how many to list." },
        },
        // One of the two is required, and saying so here is what stops a caller sending an
        // empty object and getting a validation error the schema said was impossible.
        anyOf: [{ required: ["jobId"] }, { required: ["projectId"] }],
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({ jobId: z.string().min(1).optional(), projectId: z.string().min(1).optional(), limit: z.number().int().min(1).max(50).default(10) }).parse(input);
          if (parsed.jobId) {
            const job = await jobService.getJob(parsed.jobId);
            return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false, job, summary: summarizeJob(job) });
          }
          if (!parsed.projectId) {
            throw new ProjectError("INVALID_INPUT", "Provide a jobId or a projectId.", { fieldPath: "projectId" });
          }
          const jobs = await jobService.listJobs(parsed.projectId, parsed.limit);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            resultCount: jobs.length,
            jobs: jobs.map((job) => ({ ...job, summary: summarizeJob(job) })),
          });
        } catch (error) { return visibleToolError(error, "Job inspection failed"); }
      },
    },
    {
      name: "manage_job",
      description: "Cancel a running job or retry one that failed, was cancelled, or was interrupted by a reload. Cancellation reaches the worker rather than only updating a record, and is idempotent.",
      inputSchema: jsonSchema({ operation: { enum: ["cancel", "retry"] }, jobId: { type: "string", minLength: 1 } }, ["operation", "jobId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input) => {
        try {
          const parsed = manageJobSchema.parse(input);
          if (parsed.operation === "cancel") {
            const outcome = await jobService.cancelJob(parsed.jobId);
            webMcpActivityStore.show({
              id: crypto.randomUUID(), stage: outcome.accepted ? "cancelled" : "complete",
              title: outcome.accepted ? `Cancelling ${outcome.job.label}` : `${outcome.job.label} was not cancelled`,
              detail: outcome.reason, projectId: outcome.job.projectId,
            });
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, jobId: parsed.jobId,
              accepted: outcome.accepted, reason: outcome.reason,
              status: outcome.job.status, projectChanged: false, summary: outcome.reason,
            });
          }
          const retried = await jobService.retryJob(parsed.jobId);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, jobId: retried.id,
            retryOfJobId: parsed.jobId, status: retried.status,
            projectChanged: false, summary: `Retrying as job ${retried.id}.`,
          });
        } catch (error) { return visibleToolError(error, "Job command failed"); }
      },
    },
    {
      name: "inspect_layers",
      description: "Inspect the document's layer stack: stable IDs, kind, nesting, visibility, lock, opacity, transform, crop, and active colour adjustments. Never returns pixels.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 } }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = projectIdSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          const document = history.headRevision.state.photoDocument;
          if (!document) {
            return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, revisionId: history.headRevision.id, hasDocument: false, layers: [], projectChanged: false });
          }
          const assets = history.headRevision.state.assets ?? [];
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            revisionId: history.headRevision.id, hasDocument: true, projectChanged: false,
            documentId: document.id, documentWidthPx: document.widthPx, documentHeightPx: document.heightPx,
            // `summary` is a sentence everywhere else in this schema, and both the interface
            // and any caller formatting a result rely on that. The counts keep their own field.
            counts: summarizeLayerTree(document.layers),
            summary: describeLayerCounts(summarizeLayerTree(document.layers)),
            layers: flattenLayers(document.layers).map(({ layer, depth }) => ({
              layerId: layer.id, name: layer.name, kind: layer.kind, depth,
              visible: layer.visible, locked: layer.locked, opacity: layer.opacity,
              transform: layer.transform,
              ...(layer.kind === "image"
                ? {
                  assetId: layer.assetId,
                  assetName: assets.find((asset) => asset.id === layer.assetId)?.name ?? null,
                  assetAvailable: assets.some((asset) => asset.id === layer.assetId),
                  crop: layer.crop,
                  adjustments: activeAdjustments(layer.adjustments),
                }
                : layer.kind === "graphics"
                  ? {
                    graphicsKind: layer.content.kind,
                    summary: layer.content.kind === "text"
                      ? describeTypography(layer.content.text)
                      // "A ellipse" reads as a bug even though it is only grammar.
                      : `${/^[aeiou]/i.test(layer.content.vector.shape.kind) ? "An" : "A"} ${layer.content.vector.shape.kind}.`,
                  }
                  : layer.kind === "group"
                    ? { childCount: layer.children.length, childIds: layer.children.map((child) => child.id) }
                    : layer.kind === "adjustment"
                      ? { summary: "An adjustment layer: it changes everything beneath it rather than drawing." }
                      : layer.kind === "fill"
                        ? { summary: `A fill layer painted with ${layer.paint.kind === "solid" ? layer.paint.colour : `a ${layer.paint.kind}`}.` }
                        : { strokeCount: layer.strokes.strokes.length, summary: `A painted layer of ${layer.strokes.strokes.length} stroke(s).` }),
            })),
          });
        } catch (error) { return visibleToolError(error, "Layer inspection failed"); }
      },
    },
    {
      name: "apply_layer_operation",
      description: "Every edit to a photo layer, chosen with the operation field. Structure: add, remove, duplicate, reorder, group, ungroup, move between groups, rename, show, hide, lock. Placement: transform, crop, crop ratio, reset, quarter-turn, fit, fill, straighten, flip, align, distribute, free transform, perspective, warp, lens correction. Appearance: opacity, blend mode, clip to the layer below, masks, and an effect container holding exposure, levels, curves, vibrance, colour balance, selective colour, black and white, gradient map, photo filter, 3D LUT, shadows and highlights, replace colour, posterize, threshold, invert, equalize. Content: text, shapes, fills, adjustment layers, layer styles, brush and retouch strokes, keyframes. Everything is stored as settings and re-run at export size, so any of it can be changed or removed later. Each operation reads only the fields it needs; the rest are ignored. Alignment and grouping act only on the layers named.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        expectedRevisionId: { type: "string" },
        operation: { enum: ["add_image", "remove", "duplicate", "reorder", "group", "ungroup", "move_into_group", "rename", "set_visibility", "set_lock", "set_opacity", "transform", "crop", "set_crop_ratio", "reset_transform", "rotate_quarter", "fit", "straighten", "flip", "align", "distribute", "set_blend_mode", "set_clipping", "add_mask", "update_mask", "remove_mask", "add_effect", "update_effect", "remove_effect", "reorder_effect", "set_keyframe", "remove_keyframe", "set_track_enabled", "clear_animation", "add_text", "edit_text", "add_shape", "set_paint", "add_adjustment_layer", "add_fill_layer", "add_style", "update_style", "remove_style", "free_transform", "set_perspective", "warp", "correct_lens", "apply_profile", "paint_stroke", "undo_stroke", "restyle_stroke", "fill_region"] },
        content: { type: "string", maxLength: 20000, description: "Text content for add_text or a whole-block replacement." },
        range: { type: "object", description: "Character range: start and end." },
        insert: { type: "string", maxLength: 20000 },
        font: { type: "object", description: "Family, weight, italic." },
        sizePx: { type: "number", minimum: 1, maximum: 2000 },
        colour: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        trackingMille: { type: "number", minimum: -500, maximum: 2000 },
        paragraph: { type: "object", description: "Alignment, leading, indents, spacing, list." },
        paragraphIndex: { type: "integer", minimum: 0 },
        layout: { type: "object", description: "Point text, or a paragraph box with a width and height." },
        shape: { type: "object", description: "Rectangle, ellipse, polygon, or path commands." },
        fill: { type: "object" }, stroke: { type: ["object", "null"] },
        paint: { type: "object", description: "Fill paint for a fill layer: solid, gradient, or a swatch." },
        style: { type: "object", description: "A layer style: kind is one of stroke, drop_shadow, inner_shadow, glow, overlay, plus that kind's own settings." },
        styleId: { type: "string" },
        corners: { type: ["object", "null"], description: "Four corners in reading order — topLeft, topRight, bottomRight, bottomLeft — each {x,y} in document pixels. Null clears the correction." },
        sliders: { type: "object", description: "Perspective as angles instead of corners: verticalDeg, horizontalDeg, rotationDeg, scale." },
        columns: { type: "integer", minimum: 2, maximum: 16, description: "Warp grid width." },
        rows: { type: "integer", minimum: 2, maximum: 16, description: "Warp grid height." },
        point: { type: "object", description: "Moves one warp control point: column, row, and an offset {x,y} in fractions of the layer's size." },
        clear: { type: "boolean", description: "Removes the warp." },
        correction: { type: "object", description: "Lens correction: distortion, distortionFine, chromaticAberration, vignette, each -1 to 1." },
        brush: { type: "object", description: "Brush settings: kind (brush, pencil, eraser, clone, dodge, burn, sponge, blur, sharpen, smudge, red_eye), sizePx, hardness, flow, opacity, spacing, roundness, angleDeg, scatter. Only what is given changes." },
        cloneOffset: { type: ["object", "null"], description: "For a clone stamp: {x,y}, the distance from where it paints to where it reads. Required for clone." },
        strength: { type: "number", minimum: 0, maximum: 1, description: "How strongly a retouching brush works. Not opacity: these change what is already there. Defaults to 0.5." },
        dynamics: { type: "object", description: "What the pen drives: pressureToSize, pressureToOpacity, pressureToFlow, tiltToRoundness, rotationToAngle, velocityToSize, each 0 to 1." },
        points: { type: "array", maxItems: 4000, items: { type: "object" }, description: "Pointer samples: x, y, and optionally pressure, tiltDeg, rotationDeg, velocity. Pressure defaults to full, so a mouse draws at the brush's stated size." },
        strokeId: { type: "string" },
        selectionId: { type: "string", description: "A saved selection the stroke or fill is confined to." },
        simplifyPx: { type: "number", minimum: 0, maximum: 20, description: "Thins the points to the ones that describe the shape. 0 keeps every sample." },
        propertyPath: { type: "string", description: "An animatable property, such as transform.x or opacity." },
        time: { type: "object", description: "A rational time: numerator and denominator." },
        value: { type: "number" },
        interpolation: { enum: ["linear", "hold", "ease_in", "ease_out", "ease_in_out", "bezier"] },
        handles: { type: "object", description: "Bezier control handles, for custom easing." },
        keyframeId: { type: "string" },
        blendMode: { enum: [...BLEND_MODES] },
        clipToBelow: { type: "boolean" },
        mask: { type: "object", description: "Mask source, feather, density, inverted, and enabled." },
        maskId: { type: "string" },
        effectId: { type: "string" },
        enabled: { type: "boolean" },
        parameters: { type: "object", description: "Adjustment values for an effect or an adjustment layer." },
        profile: { type: "object", description: "A camera profile or a creative look: id, name, kind ('camera' or 'creative'), and an ordered list of colour operations. Applied before everything else, so later edits are edits away from it. Its operations are copied onto the layer, so editing the profile later does not change photographs already developed with it." },
        remove: { enum: ["camera", "creative"], description: "For apply_profile: removes the profile of that kind." },
        colourOperation: { type: "object", description: "One tone or colour operator for an effect. `kind` is one of exposure, levels, curves, vibrance, colour_balance, selective_colour, black_and_white, channel_mixer, gradient_map, photo_filter, lut, shadows_highlights, replace_colour, posterize, threshold, invert, equalize, plus that kind's own settings. Replaces the operator whole on an update, because a curve and a lookup table share no fields." },
        assetId: { type: "string" }, layerId: { type: "string" }, groupId: { type: ["string", "null"] },
        layerIds: { type: "array", items: { type: "string" }, maxItems: 500 },
        name: { type: "string", minLength: 1, maxLength: 120 },
        fit: { enum: ["fit", "fill", "actual"] },
        mode: { enum: ["fit", "fill", "actual"] },
        toIndex: { type: "integer", minimum: 0 },
        visible: { type: "boolean" }, locked: { type: "boolean" },
        opacity: { type: "number", minimum: 0, maximum: 1 },
        rotationDeg: { type: "number", minimum: -360, maximum: 360 },
        turns: { type: "integer", minimum: -3, maximum: 3 },
        ratio: { type: ["number", "null"] },
        axis: { enum: ["horizontal", "vertical"] },
        edge: { enum: ["left", "horizontal-center", "right", "top", "vertical-center", "bottom"] },
        reference: { enum: ["canvas", "selection", "key-layer"] },
        keyLayerId: { type: ["string", "null"] },
        transform: { type: "object" }, crop: { type: "object" },
      }, ["projectId", "operation"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const { projectId, expectedRevisionId, ...rest } = z.object({
            projectId: z.string().min(1), expectedRevisionId: z.string().min(1).optional(),
          }).passthrough().parse(input);
          const operation = layerOperationSchema.parse(rest);

          const before = await service.getProjectHistory(projectId);
          if (expectedRevisionId && expectedRevisionId !== before.headRevision.id) {
            throw new ProjectError("HISTORY_CONFLICT", "The project changed before this layer edit could be applied. Inspect the latest revision and try again.");
          }

          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Editing layers", detail: `Applying ${operation.operation}.`, projectId });
          const result = await layerService.applyOperation(projectId, operation, { actor, intent: `Apply ${operation.operation} through WebMCP.`, expectedRevisionId });
          await service.waitForAutosave(projectId);

          const after = await service.getProjectHistory(projectId);
          const document = after.headRevision.state.photoDocument;
          const focusTarget: SemanticTargetId = operation.operation === "align" || operation.operation === "distribute"
            ? "inspector-align"
            : operation.operation === "crop" || operation.operation === "set_crop_ratio"
              ? "inspector-crop"
              : "panel-layers";
          const request = focusStore.request(projectId, focusTarget, "webmcp");

          const payload = {
            ...resultForMutation(result), durability: "durable", projectChanged: true,
            operation: operation.operation,
            layerCount: document ? summarizeLayerTree(document.layers).total : 0,
            focusTargetId: focusTarget, focusRequestId: request.id,
          };
          webMcpActivityStore.show({
            id: activityId, stage: "complete", title: result.transaction.summary,
            detail: "Undo remains available through the returned token.",
            // Watching an agent work is where the vocabulary gets picked up, so the card
            // says what the operation means as well as that it happened.
            explanation: explainOperation(operation.operation) ?? undefined,
            projectId, transactionId: result.transaction.id, undoProjectId: projectId,
          });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Layer operation failed"); }
      },
    },
    {
      name: "inspect_color_state",
      description: "Report every colour adjustment on a layer with its current value, documented range, unit, and a plain-language description. This never changes the project.",
      inputSchema: jsonSchema({ projectId: { type: "string", minLength: 1 }, layerId: { type: "string", minLength: 1 } }, ["projectId", "layerId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({ projectId: z.string().min(1), layerId: z.string().min(1) }).parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          const document = history.headRevision.state.photoDocument;
          const layer = document ? findLayer(document.layers, parsed.layerId) : null;
          if (!layer || layer.kind !== "image") {
            throw new ProjectError("INVALID_INPUT", "Colour state applies to an image layer.", { fieldPath: "layerId" });
          }
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, layerId: layer.id,
            revisionId: history.headRevision.id, projectChanged: false,
            adjustments: Object.entries(ADJUSTMENT_RANGES).map(([name, range]) => ({
              name, value: layer.adjustments[name as keyof typeof ADJUSTMENT_RANGES],
              min: range.min, max: range.max, default: range.default, unit: range.unit,
              description: describeAdjustment(name as keyof typeof ADJUSTMENT_RANGES, layer.adjustments[name as keyof typeof ADJUSTMENT_RANGES]),
            })),
          });
        } catch (error) { return visibleToolError(error, "Colour inspection failed"); }
      },
    },
    {
      name: "apply_color_adjustment",
      description: "Set one colour adjustment on a layer using its documented range. Values outside the range are clamped and the clamp is reported rather than applied silently.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        layerId: { type: "string", minLength: 1 },
        adjustment: { enum: Object.keys(ADJUSTMENT_RANGES) },
        value: { type: "number" },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "layerId", "adjustment", "value"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = z.object({ projectId: z.string().min(1), expectedRevisionId: z.string().min(1).optional() }).and(colorAdjustmentSchema).parse(input);
          const before = await service.getProjectHistory(parsed.projectId);
          if (parsed.expectedRevisionId && parsed.expectedRevisionId !== before.headRevision.id) {
            throw new ProjectError("HISTORY_CONFLICT", "The project changed before this adjustment could be applied.");
          }
          webMcpActivityStore.show({ id: activityId, stage: "committing", title: "Adjusting colour", detail: `Setting ${parsed.adjustment}.`, projectId: parsed.projectId });
          const result = await layerService.applyColorAdjustment(parsed.projectId, parsed, { actor, intent: "Adjust colour through WebMCP.", expectedRevisionId: parsed.expectedRevisionId });
          await service.waitForAutosave(parsed.projectId);
          const request = focusStore.request(parsed.projectId, "inspector-adjustments", "webmcp");
          const payload = {
            ...resultForMutation(result), durability: "durable", projectChanged: true,
            requestedValue: parsed.value, normalizedValue: result.normalizedValue,
            description: result.description, range: ADJUSTMENT_RANGES[parsed.adjustment],
            // Carried in the result as well as shown on the card, so an agent can repeat the
            // explanation back to a person who did not know the word.
            explanation: explainAdjustment(parsed.adjustment, result.normalizedValue),
            focusTargetId: "inspector-adjustments", focusRequestId: request.id,
          };
          webMcpActivityStore.show({
            id: activityId, stage: "complete", title: result.transaction.summary,
            detail: result.description,
            explanation: explainAdjustment(parsed.adjustment, result.normalizedValue),
            projectId: parsed.projectId, transactionId: result.transaction.id, undoProjectId: parsed.projectId,
          });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Colour adjustment failed"); }
      },
    },
    {
      name: "inspect_histogram",
      description: "Measure the current visible composite and return binned tone distribution per channel with clipping diagnostics and a plain-language exposure reading. Returns summaries, never pixels.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        scale: { type: "number", minimum: 0.05, maximum: 1, default: 0.25 },
        revisionId: { type: ["string", "null"] },
      }, ["projectId"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            scale: z.number().min(0.05).max(1).default(0.25),
            revisionId: z.string().min(1).nullable().default(null),
          }).parse(input);
          const histogram = await renderService.histogram(parsed.projectId, parsed.scale, { revisionId: parsed.revisionId });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            revisionId: histogram.revisionId, scale: histogram.scale, ranInWorker: histogram.ranInWorker,
            bins: histogram.bins, sampleCount: histogram.sampleCount,
            channels: { red: histogram.red, green: histogram.green, blue: histogram.blue, luminance: histogram.luminance },
            exposure: histogram.exposure,
            warnings: histogram.warnings,
            summary: histogram.warnings.length ? histogram.warnings[0] : histogram.exposure,
          });
        } catch (error) { return visibleToolError(error, "Histogram could not be measured"); }
      },
    },
    {
      name: "compare_revisions",
      description: "Resolve a before-and-after comparison to a real revision pair, either from a transaction or from a chosen baseline, and optionally set the interface's comparison mode. Returns identifiers, never pixels.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        fromTransactionId: { type: "string" },
        baseline: { enum: ["original_import", "previous_revision", "chosen_revision"] },
        revisionId: { type: ["string", "null"] },
        mode: { enum: ["off", "hold", "toggle", "split", "side_by_side"] },
        apply: { type: "boolean", default: false },
      }, ["projectId"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = compareRevisionsSchema.and(z.object({
            baseline: z.enum(["original_import", "previous_revision", "chosen_revision"]).default("previous_revision"),
            revisionId: z.string().min(1).nullable().default(null),
            mode: z.enum(["off", "hold", "toggle", "split", "side_by_side"]).default("toggle"),
            apply: z.boolean().default(false),
          })).parse(input);

          const history = await service.getProjectHistory(parsed.projectId);
          const state = await renderService.comparisonState(parsed.projectId, parsed.baseline, parsed.revisionId, parsed.mode);

          const transaction = parsed.fromTransactionId
            ? history.transactions.find((entry) => entry.id === parsed.fromTransactionId)
            : [...history.transactions].reverse().find((entry) => entry.undoable);

          if (parsed.apply) {
            // Comparison is view state, so applying it changes what is shown and not the project.
            await workspaceService.applyWorkspaceChange(parsed.projectId, {
              type: "comparison", mode: parsed.mode, baseline: parsed.baseline, revisionId: parsed.revisionId,
            });
            focusStore.request(parsed.projectId, "comparison-toggle", "webmcp");
          }

          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            beforeRevisionId: state.baselineRevisionId,
            afterRevisionId: state.currentRevisionId,
            baseline: state.baseline, mode: state.mode, available: state.available, reason: state.reason,
            transactionId: transaction?.id ?? null,
            changeSummary: transaction?.summary ?? null,
            actor: transaction?.actor.displayName ?? null,
            warnings: transaction?.warnings ?? [],
            undoAvailable: transaction?.undoable ?? false,
            focusTargetId: "comparison-toggle",
            summary: state.available
              ? `Comparing revision ${state.baselineRevisionId.slice(0, 8)} with ${state.currentRevisionId.slice(0, 8)}.`
              : state.reason ?? "There is no earlier revision to compare with.",
          });
        } catch (error) { return visibleToolError(error, "Comparison failed"); }
      },
    },
    {
      name: "explain_edit",
      description: "Explain a transaction, layer, clip, sequence, or colour parameter: what it does, its current value, the visible consequence, whether it can be undone, and where its control lives. This is a read and never changes the project.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        transactionId: { type: "string" }, layerId: { type: "string" },
        clipId: { type: "string" }, sequenceId: { type: "string" }, adjustment: { type: "string" },
      }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = explainEditSchema.parse(input);
          const history = await service.getProjectHistory(parsed.projectId);
          const state = history.headRevision.state;
          const document = state.photoDocument;

          if (parsed.adjustment) {
            const name = parsed.adjustment as keyof typeof ADJUSTMENT_RANGES;
            const range = ADJUSTMENT_RANGES[name];
            if (!range) throw new ProjectError("INVALID_INPUT", "That is not an adjustment Estro exposes.", { fieldPath: "adjustment" });
            const layer = parsed.layerId && document ? findLayer(document.layers, parsed.layerId) : null;
            const value = layer && layer.kind === "image" ? layer.adjustments[name] : range.default;
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false, subject: "adjustment",
              name, currentValue: value, range,
              purpose: `${range.label} is ${meaningOf(name)}, measured in ${range.unit}.`,
              consequence: describeAdjustment(name, value),
              explanation: explainAdjustment(name, value),
              reversible: true,
              focusTargetId: "inspector-adjustments",
            });
          }



          if (parsed.layerId) {
            const layer = document ? findLayer(document.layers, parsed.layerId) : null;
            if (!layer) throw new ProjectError("INVALID_INPUT", "That layer is not in this document.", { fieldPath: "layerId" });
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false, subject: "layer",
              layerId: layer.id, purpose: describeLayer(layer),
              consequence: layer.visible ? "It contributes to the visible result." : "It is hidden, so it does not affect the result.",
              // A text or vector layer depends on nothing outside itself, which is part of
              // why it stays crisp wherever it is exported.
              dependencies: layer.kind === "image" ? [layer.assetId]
                : layer.kind === "group" ? layer.children.map((child) => child.id) : [],
              reversible: true,
              focusTargetId: "panel-layers",
            });
          }

          const transaction = parsed.transactionId
            ? history.transactions.find((entry) => entry.id === parsed.transactionId)
            : history.transactions.at(-1);
          if (!transaction) throw new ProjectError("INVALID_INPUT", "That transaction is not in this project.", { fieldPath: "transactionId" });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false, subject: "transaction",
            transactionId: transaction.id, purpose: transaction.intent, consequence: transaction.summary,
            actor: transaction.actor.displayName, dependencies: transaction.affectedIds,
            operations: transaction.operations.map((operation) => operation.type),
            previousRevisionId: transaction.sourceRevisionId, resultingRevisionId: transaction.resultingRevisionId,
            warnings: transaction.warnings, reversible: transaction.undoable, undoAvailable: transaction.undoable,
            focusTargetId: "panel-history",
          });
        } catch (error) { return visibleToolError(error, "Explanation failed"); }
      },
    },
    {
      name: "guided_step",
      description: "Return one step of a guided walkthrough with the real control to reveal and how to verify it. Teaching never performs the edit; the person stays in control, and every step points at a control the interface actually has.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        goal: { enum: ["add_image", "adjust_brightness", "crop", "export_image"] },
        step: { type: "integer", minimum: 1, maximum: 8, default: 1 },
      }, ["projectId", "goal"]),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = guidedStepSchema.parse(input);
          const steps = GUIDED_WALKTHROUGHS[parsed.goal];
          const step = steps[parsed.step - 1];
          const history = await service.getProjectHistory(parsed.projectId);
          const state = history.headRevision.state;

          if (!step) {
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
              goal: parsed.goal, step: parsed.step, totalSteps: steps.length, complete: true,
              summary: "That walkthrough is finished.",
            });
          }

          // Completion is judged from real project state, so a step never advances because a
          // control was merely looked at.
          const completed = parsed.goal === "add_image" && parsed.step === 3
            && (state.photoDocument?.layers.length ?? 0) > 0;

          const request = focusStore.request(parsed.projectId, step.targetId, "command");
          webMcpActivityStore.show({ id: request.id, stage: "targeting", title: `Step ${parsed.step} of ${steps.length}`, detail: step.instruction, projectId: parsed.projectId });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            goal: parsed.goal, step: parsed.step, totalSteps: steps.length, complete: false,
            instruction: step.instruction, verify: step.verify,
            expectedAction: `The user performs this at ${step.targetId}. Estro does not perform it for them.`,
            stepAlreadySatisfied: completed,
            focusTargetId: step.targetId, focusRequestId: request.id,
            // Teaching depends on the person seeing the control being named. When no editor
            // is open there is nothing to point at, and the step has to say so.
            focusDelivered: request.delivered,
            editorPath: `/editor/${parsed.projectId}`,
            summary: request.delivered
              ? `Step ${parsed.step}: ${step.instruction}`
              : `Step ${parsed.step}: ${step.instruction} (No editor is open, so the control is not highlighted. Ask the user to open /editor/${parsed.projectId} first.)`,
          });
        } catch (error) { return visibleToolError(error, "Guided step failed"); }
      },
    },
    {
      name: "export_image",
      description: "Encode the current photo composite at a chosen format, quality, size, and resampling algorithm, and store it as a durable output. The reported size is measured by encoding, never estimated, and a substituted format is stated.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        mediaType: { enum: ["image/png", "image/jpeg", "image/webp", "image/avif"] },
        quality: { type: "number", minimum: 0.1, maximum: 1, default: 0.85 },
        maxEdgePx: { type: ["integer", "null"], minimum: 16, maximum: 32768, description: "Longest edge in pixels, or null for full size." },
        resampleAlgorithm: { enum: ["nearest", "bilinear", "lanczos3", "browser-smooth"] },
        name: { type: "string", minLength: 1, maxLength: 160 },
        measureOnly: { type: "boolean", default: false },
        expectedRevisionId: { type: "string", minLength: 1, description: "Refuse the export if the project has moved past this revision, so the file is of the picture you inspected." },
      }, ["projectId", "mediaType"]),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      execute: async (input) => {
        const activityId = crypto.randomUUID();
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif"]),
            quality: z.number().min(0.1).max(1).default(0.85),
            maxEdgePx: z.number().int().min(16).max(32768).nullable().default(null),
            resampleAlgorithm: z.enum(["nearest", "bilinear", "lanczos3", "browser-smooth"]).default("lanczos3"),
            name: z.string().trim().min(1).max(160).optional(),
            measureOnly: z.boolean().default(false),
            expectedRevisionId: z.string().min(1).optional(),
          }).parse(input);

          // A render is a picture of one revision. Encoding a revision the caller never saw
          // produces a file they did not ask for and cannot tell apart from one they did.
          if (parsed.expectedRevisionId) {
            const current = await service.getProjectHistory(parsed.projectId);
            if (current.headRevision.id !== parsed.expectedRevisionId) {
              throw new ProjectError("HISTORY_CONFLICT", `This project is at revision ${current.headRevision.id}, not ${parsed.expectedRevisionId}. Inspect the current revision and export again.`, { fieldPath: "expectedRevisionId" });
            }
          }

          const media = await detectMediaCapabilities();
          if (!encodableTypes(media).includes(parsed.mediaType)) {
            throw new ProjectError("CAPABILITY_UNAVAILABLE", `This browser cannot encode ${parsed.mediaType}. Available: ${encodableTypes(media).join(", ")}.`);
          }

          webMcpActivityStore.show({ id: activityId, stage: "running", title: "Encoding the image", detail: `Rendering and encoding as ${parsed.mediaType}.`, projectId: parsed.projectId });
          const result = await renderService.previewExport(parsed.projectId, {
            mediaType: parsed.mediaType, quality: parsed.quality,
            maxEdgePx: parsed.maxEdgePx ?? undefined,
            resampleAlgorithm: parsed.resampleAlgorithm,
            preserveTransparency: true,
          });

          if (parsed.measureOnly) {
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
              measured: true, revisionId: result.revisionId,
              requestedMediaType: result.requestedMediaType, mediaType: result.mediaType,
              byteSize: result.byteSize, widthPx: result.widthPx, heightPx: result.heightPx,
              substituted: result.substituted, resampleAlgorithm: result.resampleAlgorithm,
              hasAlpha: result.hasAlpha, warnings: result.warnings,
              summary: `Measured ${(result.byteSize / 1024).toFixed(0)} KB as ${result.mediaType} at ${result.widthPx} × ${result.heightPx}.`,
            });
          }

          const settings = {
            container: result.mediaType, videoCodec: null, audioCodec: null,
            widthPx: result.widthPx, heightPx: result.heightPx, frameRate: null,
            videoBitsPerSecond: null, audioBitsPerSecond: null, sampleRateHz: null, channels: null,
            quality: parsed.quality,
          };
          const output = await outputService.saveOutput({
            projectId: parsed.projectId, kind: "photo",
            name: parsed.name ?? `Image export ${new Date().toISOString()}`,
            sourceRevisionId: result.revisionId, scope: "document",
            sequenceId: null, clipId: null, documentId: null, range: null, presetId: null,
            requestedSettings: { ...settings, container: parsed.mediaType },
            actualSettings: settings,
            mediaType: result.mediaType, durationSeconds: null, frameCount: null,
            warnings: result.warnings,
            substitutions: result.substituted ? [`Produced ${result.mediaType} instead of ${parsed.mediaType}.`] : [],
            jobId: null, blob: result.blob,
          });

          const focusRequest = focusStore.request(parsed.projectId, "output-list", "webmcp");
          const payload = {
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            outputId: output.id, revisionId: result.revisionId,
            requestedMediaType: result.requestedMediaType, mediaType: result.mediaType,
            byteSize: result.byteSize, widthPx: result.widthPx, heightPx: result.heightPx,
            substituted: result.substituted, resampleAlgorithm: result.resampleAlgorithm,
            hasAlpha: result.hasAlpha, warnings: output.warnings,
            focusTargetId: "output-list", focusRequestId: focusRequest.id,
            summary: summarizeOutput(output),
          };
          webMcpActivityStore.show({ id: activityId, stage: "complete", title: payload.summary, detail: "The file is stored in this project's outputs.", projectId: parsed.projectId });
          return toolResult(payload);
        } catch (error) { return visibleToolError(error, "Image export failed"); }
      },
    },
    {
      name: "inspect_outputs",
      description: "List the project's finished deliveries with their kind, scope, source revision, preset, real format and settings, size, warnings, substitutions, job linkage, and whether their bytes are still stored.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        outputId: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 50, default: 25 },
      }, ["projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1), outputId: z.string().min(1).optional(),
            limit: z.number().int().min(1).max(50).default(25),
          }).parse(input);

          if (parsed.outputId) {
            const output = await outputService.getOutput(parsed.outputId);
            return toolResult({ ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false, output, summary: summarizeOutput(output) });
          }
          await outputService.refreshAvailability(parsed.projectId).catch(() => undefined);
          const outputs = await outputService.listOutputs(parsed.projectId, parsed.limit);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
            resultCount: outputs.length,
            outputs: outputs.map((output) => ({ ...output, summary: summarizeOutput(output) })),
          });
        } catch (error) { return visibleToolError(error, "Output inspection failed"); }
      },
    },
    {
      name: "manage_output",
      description: "Reveal a finished output in the interface so the user can download it, or delete one permanently. Deleting an output removes its stored file and cannot be undone through project history, because outputs are deliveries rather than project state.",
      inputSchema: jsonSchema({
        operation: { enum: ["reveal", "delete"] },
        outputId: { type: "string", minLength: 1 },
        confirm: { type: "boolean", default: false },
      }, ["operation", "outputId"]),
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            operation: z.enum(["reveal", "delete"]),
            outputId: z.string().min(1),
            confirm: z.boolean().default(false),
          }).parse(input);

          const output = await outputService.getOutput(parsed.outputId);

          if (parsed.operation === "reveal") {
            const request = focusStore.request(output.projectId, "output-list", "webmcp");
            webMcpActivityStore.show({ id: request.id, stage: "targeting", title: `Showing “${output.name}”`, detail: summarizeOutput(output), projectId: output.projectId });
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: output.projectId, projectChanged: false,
              outputId: output.id, available: output.available,
              focusTargetId: "output-list", focusRequestId: request.id,
              summary: `The Outputs list is focused on “${output.name}”. Downloading is a user action.`,
            });
          }

          if (!parsed.confirm) {
            return toolResult({
              ok: false, schemaVersion: WEBMCP_SCHEMA_VERSION, status: "confirmation_required",
              projectId: output.projectId, outputId: output.id, projectChanged: false,
              consequence: `Deleting “${output.name}” removes its stored file permanently. Project history is unaffected, but the render would have to be repeated.`,
              permission: "explicit_confirmation_field",
              summary: "Re-send with confirm set to true after telling the user what will be deleted.",
            });
          }

          await outputService.deleteOutput(parsed.outputId);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: output.projectId, projectChanged: false,
            outputId: parsed.outputId,
            summary: `Deleted the output “${output.name}”. Project history is unchanged.`,
          });
        } catch (error) { return visibleToolError(error, "Output command failed"); }
      },
    },
    {
      name: "select_region",
      description: "Choose the part of the image the next edit applies to. Tools: a rectangular or elliptical marquee, a freehand or polygonal lasso, a magic wand that spreads from one point by colour, a colour range or brightness range across the whole image, a layer's own transparency, or everything. Every tool supports replace, add, subtract, and intersect, so selections are built up rather than restarted. A selection is where the next edit lands, not an edit itself, so it does not appear in Undo; save it by name to keep it.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        mode: { enum: ["replace", "add", "subtract", "intersect"], description: "How this combines with what is already selected. Defaults to replace." },
        source: {
          type: "object",
          description: "Which tool, and its parameters. One of: {kind:'marquee',shape:'rectangle'|'ellipse',x,y,width,height,featherPx}, {kind:'lasso',points:[{x,y},…]}, {kind:'wand',x,y,tolerance,contiguous}, {kind:'colour_range',colour:'#rrggbb',tolerance}, {kind:'luminance_range',low,high,softness}, {kind:'layer_alpha',layerId}, {kind:'all'}.",
        },
      }, ["projectId", "source"]),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        try {
          const parsed = selectInputSchema.parse(input ?? {});
          const state = await selectionService.select(parsed);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            // A selection changes nothing in the document, so it produces no transaction and
            // nothing to undo. Saying so keeps an agent from looking for one.
            projectChanged: false, undoAvailable: false,
            selected: state.mask !== null, areaPx: Math.round(state.areaPx), bounds: state.bounds,
            summary: state.summary,
          });
        } catch (error) { return visibleToolError(error, "Selection failed"); }
      },
    },
    {
      name: "refine_selection",
      description: "Adjust the current selection: grow it, shrink it, soften its edge, smooth a ragged boundary, keep only a band along the edge, move it, or invert it. Also runs the whole refinement workspace in one pass when given smoothPx, featherPx, contrast, and shiftEdge together, which is how a difficult edge is cut without degrading the selection through repeated rounding.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        operation: {
          type: "object",
          description: "One of: {kind:'feather',radiusPx}, {kind:'expand',amountPx}, {kind:'contract',amountPx}, {kind:'smooth',radiusPx}, {kind:'border',widthPx}, {kind:'move',dx,dy}, {kind:'invert'}. Leave out to use the workspace sliders instead.",
        },
        smoothPx: { type: "number", minimum: 0, maximum: 100 },
        featherPx: { type: "number", minimum: 0, maximum: 250 },
        contrast: { type: "number", minimum: -1, maximum: 1, description: "Positive hardens the edge, negative softens it, without moving it." },
        shiftEdge: { type: "number", minimum: -1, maximum: 1, description: "Slides a soft boundary in or out without changing how soft it is. A hard edge has no band to slide; use expand for that." },
      }, ["projectId"]),
      annotations: { readOnlyHint: false },
      execute: async (input) => {
        try {
          const raw = (input ?? {}) as Record<string, unknown>;
          const state = raw.operation
            ? selectionService.refine(refineInputSchema.parse(raw))
            : selectionService.refineEdge(refineEdgeInputSchema.parse(raw));
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: String(raw.projectId),
            projectChanged: false, undoAvailable: false,
            selected: state.mask !== null, areaPx: Math.round(state.areaPx), bounds: state.bounds,
            summary: state.summary,
          });
        } catch (error) { return visibleToolError(error, "Refining the selection failed"); }
      },
    },
    {
      name: "manage_selections",
      description: "Keep, reload, list, or discard named selections. A saved selection survives a reload and can be brought back on its own or combined with whatever is selected now; loading one into a differently sized image is refused rather than silently misplaced. Use inspect to see what is selected right now without changing it.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: { enum: ["inspect", "save", "load", "list", "delete", "clear", "select_all"] },
        name: { type: "string", description: "For save. Saving over an existing name replaces it." },
        selectionId: { type: "string", description: "For load and delete." },
        mode: { enum: ["replace", "add", "subtract", "intersect"], description: "For load. Defaults to replace." },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum(["inspect", "save", "load", "list", "delete", "clear", "select_all"]),
            name: z.string().optional(),
            selectionId: z.string().optional(),
            mode: selectionModeSchema.default("replace"),
          }).parse(input ?? {});

          const base = {
            ok: true as const, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            projectChanged: false, undoAvailable: false,
          };

          if (parsed.action === "list") {
            const saved = await selectionService.list(parsed.projectId);
            return toolResult({
              ...base,
              selections: saved.map((entry) => ({
                selectionId: entry.id, name: entry.name, areaPx: Math.round(entry.areaPx),
                widthPx: entry.widthPx, heightPx: entry.heightPx, madeWith: entry.source.kind,
                createdAt: entry.createdAt,
              })),
              summary: `${saved.length} saved selection(s) in this project.`,
            });
          }

          if (parsed.action === "save") {
            if (!parsed.name) throw new ProjectError("INVALID_INPUT", "Saving a selection needs a name.", { fieldPath: "name" });
            const saved = await selectionService.save(parsed.projectId, parsed.name);
            return toolResult({
              ...base, selectionId: saved.id, name: saved.name, areaPx: Math.round(saved.areaPx),
              summary: `Saved the selection as “${saved.name}”, covering ${Math.round(saved.areaPx).toLocaleString()} pixels.`,
            });
          }

          if (parsed.action === "delete") {
            if (!parsed.selectionId) throw new ProjectError("INVALID_INPUT", "Deleting a selection needs its id.", { fieldPath: "selectionId" });
            await selectionService.remove(parsed.projectId, parsed.selectionId);
            return toolResult({ ...base, selectionId: parsed.selectionId, summary: "Deleted that saved selection. The image is unchanged." });
          }

          const state = parsed.action === "load"
            ? await (async () => {
              if (!parsed.selectionId) throw new ProjectError("INVALID_INPUT", "Loading a selection needs its id.", { fieldPath: "selectionId" });
              return selectionService.load(parsed.projectId, parsed.selectionId, parsed.mode);
            })()
            : parsed.action === "select_all" ? await selectionService.selectAll(parsed.projectId)
              : parsed.action === "clear" ? selectionService.clear(parsed.projectId)
                : selectionService.state(parsed.projectId);

          return toolResult({
            ...base,
            selected: state.mask !== null, areaPx: Math.round(state.areaPx), bounds: state.bounds,
            madeWith: state.source?.kind ?? null,
            summary: state.summary,
          });
        } catch (error) { return visibleToolError(error, "Selection command failed"); }
      },
    },
    {
      name: "manage_channels",
      description: "Look at the document one colour channel at a time, hide channels, or list the stored greyscale ones. An alpha channel here is the same thing as a saved selection, so anything kept in one panel appears in the other and can be loaded from either. Which channels are shown is a way of looking at the document, not an edit, so it never appears in Undo.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: { enum: ["inspect", "isolate", "set_visible", "reset"] },
        channel: { enum: ["red", "green", "blue", "alpha"], description: "For isolate. Pass null to stop isolating." },
        visible: { type: "array", items: { enum: ["red", "green", "blue", "alpha"] }, description: "For set_visible. At least one." },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum(["inspect", "isolate", "set_visible", "reset"]),
            channel: colourChannelSchema.nullish(),
            visible: z.array(colourChannelSchema).optional(),
          }).parse(input ?? {});

          if (parsed.action === "isolate") channelService.setView(parsed.projectId, { isolated: parsed.channel ?? null });
          else if (parsed.action === "set_visible") channelService.setView(parsed.projectId, { visible: parsed.visible });
          else if (parsed.action === "reset") channelService.reset(parsed.projectId);

          const [channels, levels] = await Promise.all([
            channelService.list(parsed.projectId),
            channelService.levels(parsed.projectId).catch(() => null),
          ]);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            projectChanged: false, undoAvailable: false,
            channels, levels,
            view: channelService.view(parsed.projectId),
            summary: channelService.summary(parsed.projectId),
          });
        } catch (error) { return visibleToolError(error, "Channel command failed"); }
      },
    },
    {
      name: "exchange_svg",
      description: "Reads an SVG into editable shape layers, or writes the document's shapes back out as SVG. Importing keeps each object as its own layer rather than flattening the file into a picture of itself, and anything Estro cannot draw is named in the warnings rather than dropped in silence. Exporting resolves swatch fills to the colours they currently hold, because an SVG has nowhere to keep a reference.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: { enum: ["import", "export"] },
        svg: { type: "string", description: "The SVG source, when importing." },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum(["import", "export"]),
            svg: z.string().max(4_000_000).optional(),
            expectedRevisionId: z.string().optional(),
          }).parse(input ?? {});

          const history = await service.getProjectHistory(parsed.projectId);
          const document = history.headRevision.state.photoDocument;
          if (!document) {
            throw new ProjectError("INVALID_INPUT", "This project has no document to exchange shapes with.", { fieldPath: "projectId" });
          }

          if (parsed.action === "export") {
            const objects = flattenLayers(document.layers)
              .map((entry) => entry.layer)
              .flatMap((layer) => (layer.kind === "graphics" && layer.content.kind === "vector" ? [layer.content.vector] : []));
            if (!objects.length) {
              throw new ProjectError("INVALID_INPUT", "There are no shapes in this document to write out.", { fieldPath: "projectId" });
            }
            const swatches = new Map(document.swatches.map((swatch) => [swatch.id, swatch]));
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false, undoAvailable: false,
              svg: toSvgDocument(objects, { widthPx: document.widthPx, heightPx: document.heightPx, swatches }),
              shapeCount: objects.length,
              summary: `Wrote ${objects.length} shape(s) out as SVG.`,
            });
          }

          if (!parsed.svg) {
            throw new ProjectError("INVALID_INPUT", "Importing needs the SVG source.", { fieldPath: "svg" });
          }
          const { objects, warnings } = parseSvg(parsed.svg);
          if (!objects.length) {
            throw new ProjectError("INVALID_INPUT", "Nothing in that file could be read as a shape.", { fieldPath: "svg" });
          }

          // One operation per object, in order, so each shape is its own layer and its own
          // undo step — which is what makes an imported drawing editable rather than a blob.
          let result = null as Awaited<ReturnType<typeof layerService.applyOperation>> | null;
          for (const object of objects) {
            result = await layerService.applyOperation(
              parsed.projectId,
              { operation: "add_shape", shape: object.shape, fill: object.fill, stroke: object.stroke },
              {
                actor, intent: "Bring an SVG in through WebMCP.",
                // Only the first is checked: after it the head has moved on by design.
                expectedRevisionId: result ? undefined : parsed.expectedRevisionId,
              },
            );
          }
          await service.waitForAutosave(parsed.projectId);
          return toolResult({
            ...resultForMutation(result!), durability: "durable", projectChanged: true,
            shapeCount: objects.length, warnings,
            summary: `Brought in ${objects.length} shape(s), each as its own layer.`,
          });
        } catch (error) { return visibleToolError(error, "SVG exchange failed"); }
      },
    },
    {
      name: "manage_swatches",
      description: "Add, rename, recolour, remove, and list the document's named colours and gradients. A swatch is shared: changing it changes every shape, stroke, and fill pointing at it in one edit rather than in forty. Removing one leaves anything using it unpainted and says so, rather than quietly baking in the colour it had.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: { enum: ["list", "add", "update", "remove"] },
        swatchId: { type: "string" },
        name: { type: "string", minLength: 1, maxLength: 80 },
        paint: { type: "object", description: "Solid: {kind:'solid',colour:'#rrggbb',opacity}. Gradient: {kind:'linear'|'radial',stops:[{offset,colour,opacity}],…}." },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum(["list", "add", "update", "remove"]),
            swatchId: z.string().optional(),
            name: z.string().trim().min(1).max(80).optional(),
            paint: z.unknown().optional(),
            expectedRevisionId: z.string().optional(),
          }).parse(input ?? {});

          if (parsed.action === "list") {
            const history = await service.getProjectHistory(parsed.projectId);
            const swatches = history.headRevision.state.photoDocument?.swatches ?? [];
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId, projectChanged: false,
              swatches: swatches.map((swatch) => ({
                swatchId: swatch.id, name: swatch.name, paint: swatch.paint,
                summary: swatch.paint.kind === "solid" ? swatch.paint.colour : `a ${swatch.paint.kind} gradient`,
              })),
              summary: `${swatches.length} swatch(es) in this document.`,
            });
          }

          const result = await layerService.applySwatch(
            parsed.projectId,
            {
              swatchId: parsed.swatchId,
              name: parsed.name,
              paint: parsed.paint === undefined ? undefined : paintSchema.parse(parsed.paint),
              remove: parsed.action === "remove",
            },
            { actor, intent: "Change a document swatch through WebMCP.", expectedRevisionId: parsed.expectedRevisionId },
          );
          await service.waitForAutosave(parsed.projectId);
          return toolResult({
            ...resultForMutation(result), durability: "durable", projectChanged: true,
            swatches: result.headRevision.state.photoDocument?.swatches ?? [],
          });
        } catch (error) { return visibleToolError(error, "Swatch command failed"); }
      },
    },
    {
      name: "match_photos",
      description: "Copy one photograph's settings onto photographs in other projects. Plans by default: every target is checked before anything is written, so a strict batch can refuse rather than leave half a set synchronised. Each project gets its own Undo step, because each project keeps its own history and there is nowhere a single one could live.",
      inputSchema: jsonSchema({
        sourceProjectId: { type: "string", minLength: 1 },
        sourceLayerId: { type: "string", minLength: 1 },
        targets: {
          type: "array", maxItems: 200,
          items: { type: "object" },
          description: "Each {projectId, layerId}: the photograph in each project to bring into line.",
        },
        attributes: { type: "array", items: { type: "string" }, description: "Which attributes to copy. All of the source layer's if left out." },
        policy: { enum: ["all_or_nothing", "best_effort"] },
        apply: { type: "boolean", description: "False (the default) plans without writing anything." },
      }, ["sourceProjectId", "sourceLayerId", "targets"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            sourceProjectId: z.string().min(1),
            sourceLayerId: z.string().min(1),
            targets: z.array(z.object({ projectId: z.string().min(1), layerId: z.string().min(1) })).min(1).max(200),
            attributes: z.array(z.string()).optional(),
            policy: batchFailurePolicySchema.default("all_or_nothing"),
            apply: z.boolean().default(false),
          }).parse(input ?? {});

          const result = await presetService.syncAcrossProjects({
            sourceProjectId: parsed.sourceProjectId,
            sourceLayerId: parsed.sourceLayerId,
            targets: parsed.targets,
            attributes: parsed.attributes as AttributeName[] | undefined,
            policy: parsed.policy,
            dryRun: !parsed.apply,
          }, { actor, intent: "Match photographs through WebMCP." });

          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projectId: parsed.sourceProjectId,
            planned: !parsed.apply,
            projectChanged: parsed.apply && result.applied.length > 0,
            // Many transactions, one per project. There is no single undo for this, and
            // saying so is more useful than offering one that would only undo the last.
            undoAvailable: false,
            plan: result.plan,
            applied: result.applied,
            failed: result.failed,
            summary: result.summary,
          });
        } catch (error) { return visibleToolError(error, "Matching photographs failed"); }
      },
    },
    {
      name: "batch_export",
      description: "Export many photographs at once, in one or more sizes and formats. Plans by default and says how many files that is, which projects cannot take part, and why — three sizes of a hundred photographs is three hundred encodes, so it runs as a job with progress and a cancel rather than blocking. Set apply to true to queue it; poll inspect_job for progress.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1, description: "The project the job belongs to, for progress and cancellation." },
        projectIds: { type: "array", items: { type: "string" }, maxItems: 200 },
        variants: {
          type: "array", maxItems: 6, items: { type: "object" },
          description: "Each {name, mediaType, quality, maxEdgePx, resampleAlgorithm}. The name goes into the file name, so a set of three sizes stays tellable apart.",
        },
        namePattern: { type: "string", maxLength: 160, description: "{project} and {variant} are replaced. Defaults to “{project} — {variant}”." },
        onFailure: { enum: ["continue", "stop"], description: "continue (the default) keeps going past a photograph that fails; stop refuses to begin unless every one can take part." },
        apply: { type: "boolean" },
      }, ["projectId", "projectIds", "variants"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            projectIds: z.array(z.string().min(1)).min(1).max(200),
            variants: z.array(exportVariantSchema).min(1).max(6),
            namePattern: z.string().trim().min(1).max(160).optional(),
            onFailure: z.enum(["continue", "stop"]).optional(),
            apply: z.boolean().default(false),
          }).parse(input ?? {});

          const request = {
            projectId: parsed.projectId, projectIds: parsed.projectIds, variants: parsed.variants,
            namePattern: parsed.namePattern, onFailure: parsed.onFailure,
          };

          if (!parsed.apply) {
            const plan = await batchExportService.plan(request);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false, planned: true, plan, summary: plan.summary,
            });
          }

          const { jobId, plan } = await batchExportService.start(request);
          // The wrapper's completion card fires when this call returns, which is when the
          // job was queued rather than when the files exist. Following it replaces that card
          // with the real outcome.
          followJob(jobId, jobId, parsed.projectId, `Exporting ${plan.fileCount} file(s)`);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            // Exporting reads the project and writes files; it changes no history.
            projectChanged: false, undoAvailable: false,
            jobId, plan,
            summary: `Queued ${plan.fileCount} file(s). Poll inspect_job with this job id for progress.`,
          });
        } catch (error) { return visibleToolError(error, "Batch export failed"); }
      },
    },
    {
      name: "resolve_phrase",
      description: "Read a phrase like “make it a bit warmer” or “black and white” into the exact command Estro would run, without running it. Says what it understood, what it did not, and which words meant nothing here. This is a lookup rather than a language model: a phrase it does not know is refused by name instead of being approximated, and the command it returns is an ordinary one that goes through the same history as any other edit. Call list_phrases to see everything it knows.",
      inputSchema: jsonSchema({
        phrase: { type: "string", minLength: 1, maxLength: 500 },
        projectId: { type: "string", minLength: 1 },
        layerId: { type: "string" },
        clipId: { type: "string" },
        sequenceId: { type: "string" },
      }, ["phrase", "projectId"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            phrase: z.string().trim().min(1).max(500),
            projectId: z.string().min(1),
            layerId: z.string().optional(),
            clipId: z.string().optional(),
            sequenceId: z.string().optional(),
          }).parse(input ?? {});

          const result = resolvePhrase({
            phrase: parsed.phrase,
            context: {
              projectId: parsed.projectId, layerId: parsed.layerId,
              clipId: parsed.clipId, sequenceId: parsed.sequenceId,
            },
          });
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            // Reading a phrase changes nothing. Running the command it returns is a separate,
            // visible step, which is what keeps this from being an edit nobody agreed to.
            projectChanged: false, undoAvailable: false,
            understood: result.understood,
            command: result.command,
            interpretation: result.interpretation,
            unrecognised: result.unrecognised,
            suggestions: result.suggestions,
            summary: result.interpretation,
          });
        } catch (error) { return visibleToolError(error, "That phrase could not be read"); }
      },
    },
    {
      name: "list_phrases",
      description: "Every phrase resolve_phrase understands, with what each one means. Making people guess at a vocabulary is worse than showing them. Never changes anything.",
      inputSchema: jsonSchema({}),
      annotations: { readOnlyHint: true },
      execute: async () => {
        try {
          const phrases = knownPhrases();
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false,
            phrases,
            summary: `${phrases.length} phrase(s) understood, covering colour adjustments, actions, and how strongly to apply them.`,
          });
        } catch (error) { return visibleToolError(error, "Phrases could not be listed"); }
      },
    },
    {
      name: "mark_media",
      description: "Rate, label, favourite, tag, or note media. Many items at once, as one transaction and one press of Undo, because that is how selects are actually made. A rating of zero means unrated rather than bad, so “show me everything nobody has looked at” stays answerable. Tags are added and removed rather than replaced, so marking fifteen shots “wide” does not strip whatever else each was tagged.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        itemIds: { type: "array", items: { type: "string" }, maxItems: 500 },
        itemType: { enum: ["asset", "subclip", "sequence"], description: "Defaults to asset." },
        rating: { type: "integer", minimum: 0, maximum: 5, description: "0 clears it; 0 means unrated, not bad." },
        label: { type: ["string", "null"], enum: ["red", "orange", "yellow", "green", "blue", "purple", "grey", null] },
        favourite: { type: "boolean" },
        addTags: { type: "array", items: { type: "string" }, maxItems: 32 },
        removeTags: { type: "array", items: { type: "string" }, maxItems: 32 },
        note: { type: "string", maxLength: 2000 },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "itemIds"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            itemIds: z.array(z.string().min(1)).min(1).max(500),
            itemType: z.enum(["asset", "subclip", "sequence"]).default("asset"),
            rating: z.number().int().min(0).max(5).optional(),
            label: labelSchema.nullish(),
            favourite: z.boolean().optional(),
            addTags: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
            removeTags: z.array(z.string().trim().min(1).max(60)).max(32).optional(),
            note: z.string().max(2000).optional(),
            expectedRevisionId: z.string().optional(),
          }).parse(input ?? {});

          const result = await catalogueService.mark({
            projectId: parsed.projectId,
            items: parsed.itemIds.map((itemId) => ({ itemType: "asset" as const, itemId })),
            rating: parsed.rating, label: parsed.label, favourite: parsed.favourite,
            addTags: parsed.addTags, removeTags: parsed.removeTags, note: parsed.note,
          }, { actor, intent: "Mark media through WebMCP.", expectedRevisionId: parsed.expectedRevisionId });

          await service.waitForAutosave(parsed.projectId);
          return toolResult({ ...resultForMutation(result), durability: "durable", projectChanged: true });
        } catch (error) { return visibleToolError(error, "Media could not be marked"); }
      },
    },
    {
      name: "manage_collections",
      description: "Saved questions about the media, as against places to file it. A collection is not a bin: nothing is moved into it, and an item that stops matching leaves on its own — so a collection is always current and never has to be maintained. List, run, add, change, or remove one; browse with the same rules without saving them.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: { enum: ["list", "run", "add", "update", "remove", "browse"] },
        collectionId: { type: "string" },
        name: { type: "string", minLength: 1, maxLength: 80 },
        match: { enum: ["all", "any"] },
        rules: {
          type: "array", maxItems: 16, items: { type: "object" },
          description: "Each {field, comparison, value}. Fields: rating, label, favourite, tag, name, kind, duration, used.",
        },
        sortField: { enum: ["name", "rating", "duration", "kind", "label"] },
        sortDirection: { enum: ["ascending", "descending"] },
        minimumRating: { type: "integer", minimum: 0, maximum: 5, description: "For browse." },
        favouritesOnly: { type: "boolean", description: "For browse." },
        tag: { type: "string", description: "For browse." },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum(["list", "run", "add", "update", "remove", "browse"]),
            collectionId: z.string().optional(),
            name: z.string().trim().min(1).max(80).optional(),
            match: z.enum(["all", "any"]).optional(),
            rules: z.array(collectionRuleSchema).min(1).max(16).optional(),
            sortField: z.enum(["name", "rating", "duration", "kind", "label"]).optional(),
            sortDirection: z.enum(["ascending", "descending"]).optional(),
            minimumRating: z.number().int().min(0).max(5).optional(),
            favouritesOnly: z.boolean().optional(),
            tag: z.string().optional(),
            expectedRevisionId: z.string().optional(),
          }).parse(input ?? {});

          const sort = parsed.sortField
            ? { field: parsed.sortField, direction: parsed.sortDirection }
            : undefined;

          if (parsed.action === "list") {
            const listed = await catalogueService.listCollections(parsed.projectId);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false,
              collections: listed.map((entry) => ({
                collectionId: entry.collection.id, name: entry.collection.name,
                match: entry.collection.match, rules: entry.collection.rules,
                count: entry.count, summary: entry.summary,
              })),
              summary: `${listed.length} collection(s) in this project.`,
            });
          }

          if (parsed.action === "run") {
            if (!parsed.collectionId) {
              throw new ProjectError("INVALID_INPUT", "Running a collection needs its id.", { fieldPath: "collectionId" });
            }
            const run = await catalogueService.runCollection(parsed.projectId, parsed.collectionId, sort);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false,
              collectionId: run.collection.id, name: run.collection.name,
              items: run.items.map(catalogueRow),
              summary: run.summary,
            });
          }

          if (parsed.action === "browse") {
            const browsed = await catalogueService.browse(parsed.projectId, {
              minimumRating: parsed.minimumRating,
              favouritesOnly: parsed.favouritesOnly,
              tag: parsed.tag,
              sort,
            });
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false,
              items: browsed.items.map(catalogueRow),
              summary: browsed.summary,
            });
          }

          const result = await catalogueService.manageCollection({
            projectId: parsed.projectId,
            collectionId: parsed.collectionId,
            name: parsed.name, match: parsed.match, rules: parsed.rules,
            remove: parsed.action === "remove",
          }, { actor, intent: "Manage collections through WebMCP.", expectedRevisionId: parsed.expectedRevisionId });

          await service.waitForAutosave(parsed.projectId);
          return toolResult({ ...resultForMutation(result), durability: "durable", projectChanged: true });
        } catch (error) { return visibleToolError(error, "Collection command failed"); }
      },
    },
    {
      name: "manage_package",
      description: "Plan moving a project between machines. This tool reads and reasons; it does not write or open a package, because a browser cannot hand a file to another machine without a user gesture. estimate says how large a package would be under each media policy — “everything” on a long project is very large. offline_state says what this copy would be missing if it were opened elsewhere. inspect and plan_open take the contents of a package you already have and say whether this copy is behind, ahead, diverged, or unrelated, because those four need different things done. Writing the file itself is a user action through the interface.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1, description: "For estimate and offline_state." },
        action: { enum: ["estimate", "offline_state", "inspect", "plan_open"] },
        mediaPolicy: { enum: ["none", "used_only", "everything"], description: "used_only by default. none needs the media to already be on the machine that opens it." },
        writtenBy: { type: "string", maxLength: 120, description: "Names the machine, so two packages can be told apart." },
        packageJson: { type: "string", description: "For inspect and plan_open: the package's contents." },
        resolution: { enum: ["take_incoming", "keep_local", "keep_both"], description: "For plan_open." },
      }, ["action"]),
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1).optional(),
            action: z.enum(["estimate", "offline_state", "inspect", "plan_open"]),
            mediaPolicy: z.enum(["none", "used_only", "everything"]).optional(),
            writtenBy: z.string().trim().min(1).max(120).optional(),
            packageJson: z.string().optional(),
            resolution: z.enum(["take_incoming", "keep_local", "keep_both"]).optional(),
          }).parse(input ?? {});

          if (parsed.action === "estimate" || parsed.action === "offline_state") {
            if (!parsed.projectId) {
              throw new ProjectError("INVALID_INPUT", "That needs a project.", { fieldPath: "projectId" });
            }
            if (parsed.action === "offline_state") {
              const state = await packageService.offlineState(parsed.projectId);
              return toolResult({
                ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
                projectChanged: false, ...state,
              });
            }
            const estimate = await packageService.estimate({
              projectId: parsed.projectId,
              mediaPolicy: parsed.mediaPolicy,
              writtenBy: parsed.writtenBy,
            });
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
              projectChanged: false,
              manifest: estimate.manifest, byteSize: estimate.byteSize, missing: estimate.missing,
              summary: estimate.summary,
            });
          }

          if (!parsed.packageJson) {
            throw new ProjectError("INVALID_INPUT", "That needs the package's contents.", { fieldPath: "packageJson" });
          }
          if (parsed.action === "plan_open") {
            if (!parsed.resolution) {
              throw new ProjectError("INVALID_INPUT", "Planning needs which resolution to cost.", { fieldPath: "resolution" });
            }
            const plan = await packageService.planOpen(parsed.packageJson, parsed.resolution);
            return toolResult({
              ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectChanged: false,
              ...plan, summary: plan.outcome,
            });
          }

          const inspected = await packageService.inspect(parsed.packageJson);
          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projectId: inspected.manifest.projectId, projectChanged: false,
            manifest: inspected.manifest, comparison: inspected.comparison,
            knownHere: inspected.knownHere, summary: inspected.summary,
          });
        } catch (error) { return visibleToolError(error, "Package command failed"); }
      },
    },
    {
      name: "manage_review",
      description: "People on a project, comments anchored to an object, a timecode, or a region of the frame, version stacks, claims, and shares. None of it is enforcement and every answer says so: a role decides what Estro offers rather than what it prevents, and a claim is a note to whoever else opens the project. Comments are resolved rather than deleted, so the thread that explains a decision survives, and each records which version it was written against.",
      inputSchema: jsonSchema({
        projectId: { type: "string", minLength: 1 },
        action: {
          enum: [
            "list_comments", "comment", "reply", "resolve", "reopen",
            "list_people", "set_person", "remove_person", "permissions",
            "list_stacks", "set_stack", "remove_stack",
            "list_claims", "claim", "release",
            "list_shares", "share",
          ],
        },
        body: { type: "string", maxLength: 4000, description: "For comment and reply." },
        anchor: { type: "object", description: "Where a comment points: {kind:'project'} | {kind:'object',objectType,objectId} | {kind:'time',sequenceId,time,duration} | {kind:'region',sequenceId,time,x,y,width,height}." },
        authorName: { type: "string", maxLength: 120 },
        commentId: { type: "string" },
        sequenceId: { type: "string", description: "For list_comments: only this sequence's." },
        includeResolved: { type: "boolean" },
        personId: { type: "string" },
        name: { type: "string", maxLength: 120 },
        role: { enum: ["owner", "editor", "reviewer", "viewer"] },
        email: { type: ["string", "null"] },
        stackId: { type: "string" },
        versionIds: { type: "array", items: { type: "string" }, maxItems: 50 },
        currentId: { type: "string" },
        approvedId: { type: ["string", "null"] },
        objectType: { enum: ["project", "sequence", "layer", "clip"] },
        objectId: { type: "string" },
        heldBy: { type: "string", maxLength: 120 },
        note: { type: "string", maxLength: 500 },
        expiresInMinutes: { type: "number", minimum: 1, maximum: 10080 },
        outputId: { type: ["string", "null"] },
        watermarked: { type: "boolean" },
        expectedRevisionId: { type: "string" },
      }, ["projectId", "action"]),
      annotations: { readOnlyHint: false, untrustedContentHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({
            projectId: z.string().min(1),
            action: z.enum([
              "list_comments", "comment", "reply", "resolve", "reopen",
              "list_people", "set_person", "remove_person", "permissions",
              "list_stacks", "set_stack", "remove_stack",
              "list_claims", "claim", "release",
              "list_shares", "share",
            ]),
            body: z.string().trim().min(1).max(4000).optional(),
            anchor: z.unknown().optional(),
            authorName: z.string().trim().min(1).max(120).optional(),
            commentId: z.string().optional(),
            sequenceId: z.string().optional(),
            includeResolved: z.boolean().optional(),
            personId: z.string().optional(),
            name: z.string().trim().min(1).max(120).optional(),
            role: roleSchema.optional(),
            email: z.string().nullish(),
            stackId: z.string().optional(),
            versionIds: z.array(z.string().min(1)).max(50).optional(),
            currentId: z.string().optional(),
            approvedId: z.string().nullish(),
            objectType: z.enum(["project", "sequence", "layer", "clip"]).optional(),
            objectId: z.string().optional(),
            heldBy: z.string().trim().min(1).max(120).optional(),
            note: z.string().max(500).optional(),
            expiresInMinutes: z.number().min(1).max(10080).optional(),
            outputId: z.string().nullish(),
            watermarked: z.boolean().optional(),
            expectedRevisionId: z.string().optional(),
          }).parse(input ?? {});

          const context = {
            actor, intent: "Review through WebMCP.", expectedRevisionId: parsed.expectedRevisionId,
          };
          const read = (payload: Record<string, unknown>) => toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION, projectId: parsed.projectId,
            projectChanged: false, ...payload,
          });
          const wrote = async (result: ProjectMutationResult, extra: Record<string, unknown> = {}) => {
            await service.waitForAutosave(parsed.projectId);
            return toolResult({
              ...resultForMutation(result), durability: "durable", projectChanged: true, ...extra,
            });
          };

          switch (parsed.action) {
            case "list_comments": {
              const listed = await reviewService.comments(parsed.projectId, {
                sequenceId: parsed.sequenceId, includeResolved: parsed.includeResolved,
              });
              return read({ comments: listed.comments, open: listed.open, summary: listed.summary });
            }
            case "comment": {
              if (!parsed.body) throw new ProjectError("INVALID_INPUT", "A comment needs something in it.", { fieldPath: "body" });
              return wrote(await reviewService.comment({
                projectId: parsed.projectId,
                anchor: (parsed.anchor ?? { kind: "project" }) as never,
                body: parsed.body, authorName: parsed.authorName,
              }, context));
            }
            case "reply": {
              if (!parsed.commentId || !parsed.body) {
                throw new ProjectError("INVALID_INPUT", "A reply needs a comment and something to say.", { fieldPath: "commentId" });
              }
              return wrote(await reviewService.reply({
                projectId: parsed.projectId, commentId: parsed.commentId,
                body: parsed.body, authorName: parsed.authorName,
              }, context));
            }
            case "resolve":
            case "reopen": {
              if (!parsed.commentId) throw new ProjectError("INVALID_INPUT", "That needs a comment.", { fieldPath: "commentId" });
              return wrote(await reviewService.resolve({
                projectId: parsed.projectId, commentId: parsed.commentId,
                by: parsed.authorName, reopen: parsed.action === "reopen",
              }, context));
            }

            case "list_people": {
              const history = await service.getProjectHistory(parsed.projectId);
              const people = history.headRevision.state.collaborators ?? [];
              return read({
                people: people.map((person) => ({
                  ...person, ...reviewService.permissions(person.role),
                })),
                summary: `${people.length} person/people on this project. Roles decide what Estro offers, not what it prevents.`,
              });
            }
            case "set_person": {
              if (!parsed.name || !parsed.role) {
                throw new ProjectError("INVALID_INPUT", "That needs a name and a role.", { fieldPath: "name" });
              }
              const result = await reviewService.setCollaborator({
                projectId: parsed.projectId, id: parsed.personId,
                name: parsed.name, role: parsed.role, email: parsed.email,
              }, context);
              return wrote(result, { advisory: result.advisory });
            }
            case "remove_person": {
              if (!parsed.personId) throw new ProjectError("INVALID_INPUT", "That needs a person.", { fieldPath: "personId" });
              return wrote(await reviewService.removeCollaborator(parsed.projectId, parsed.personId, context));
            }
            case "permissions": {
              if (!parsed.role) throw new ProjectError("INVALID_INPUT", "That needs a role.", { fieldPath: "role" });
              const permissions = reviewService.permissions(parsed.role);
              return read({ ...permissions, summary: permissions.advisory });
            }

            case "list_stacks": {
              const stacks = await reviewService.stacks(parsed.projectId);
              return read({ stacks, summary: `${stacks.length} version stack(s).` });
            }
            case "set_stack":
            case "remove_stack": {
              return wrote(await reviewService.setStack({
                projectId: parsed.projectId, id: parsed.stackId, name: parsed.name,
                versionIds: parsed.versionIds, currentId: parsed.currentId,
                approvedId: parsed.approvedId,
                remove: parsed.action === "remove_stack",
              }, context));
            }

            case "list_claims": {
              const claims = await reviewService.currentClaims(parsed.projectId);
              return read({
                claims,
                summary: `${claims.length} current claim(s). These are notes to whoever else opens the project, not locks.`,
              });
            }
            case "claim":
            case "release": {
              if (!parsed.objectType || !parsed.objectId) {
                throw new ProjectError("INVALID_INPUT", "That needs something to claim.", { fieldPath: "objectId" });
              }
              const result = await reviewService.claim({
                projectId: parsed.projectId,
                objectType: parsed.objectType, objectId: parsed.objectId,
                heldBy: parsed.heldBy ?? parsed.authorName ?? "You",
                note: parsed.note, expiresInMinutes: parsed.expiresInMinutes,
                release: parsed.action === "release",
              }, context);
              return wrote(result, { advisory: result.advisory });
            }

            case "list_shares": {
              const shares = await reviewService.shares(parsed.projectId);
              return read({ shares, summary: `${shares.length} share(s).` });
            }
            case "share": {
              if (!parsed.name) throw new ProjectError("INVALID_INPUT", "A share needs a name.", { fieldPath: "name" });
              const result = await reviewService.share({
                projectId: parsed.projectId, name: parsed.name,
                outputId: parsed.outputId, role: parsed.role,
                watermarked: parsed.watermarked, note: parsed.note,
              }, context);
              return wrote(result, { shareSummary: result.summary });
            }
          }
        } catch (error) { return visibleToolError(error, "Review command failed"); }
      },
    },
    {
      name: "inspect_accessibility",
      description: "How the interface presents itself, and how to operate it without a mouse. Reports the resolved motion and contrast modes, every status indicator with the shape and word that carry its meaning without colour, and the keyboard route to each action. Colour is never the only signal here, and no status is described by naming its colour — “red” tells nobody anything they can act on.",
      inputSchema: jsonSchema({
        projectId: { type: "string", description: "For the preferences saved against a project's workspace." },
      }),
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        try {
          const parsed = z.object({ projectId: z.string().optional() }).parse(input ?? {});
          const preferences = parsed.projectId
            ? (await workspaceService.getWorkspace(parsed.projectId)).accessibility
            : DEFAULT_ACCESSIBILITY;

          return toolResult({
            ok: true, schemaVersion: WEBMCP_SCHEMA_VERSION,
            projectId: parsed.projectId ?? null, projectChanged: false,
            preferences,
            indicators: allIndicators().map((indicator) => ({
              ...indicator,
              // Said in words as well, because the glyph is the point and a colour is not.
              describedAs: describeStatus(indicator.kind),
            })),
            summary: `Motion follows ${preferences.reducedMotion}, contrast follows ${preferences.highContrast}. Every status carries a shape and a word as well as a colour, and none is described by its colour.`,
          });
        } catch (error) { return visibleToolError(error, "Accessibility could not be inspected"); }
      },
    },
  ];

  return tools.map(withVisibleActivity);
}

/**
 * Tools that carry out their own reporting.
 *
 * Everything built through the `execute` helper, and the handful of tools that drive the
 * activity machine by hand because they have stages worth showing — a confirmation, a job to
 * watch, a proposal to review. Every *other* tool goes through the wrapper below, which is
 * why the set is written as "who reports for themselves" rather than "who is silent": a new
 * tool is visible by default, and has to opt out deliberately.
 */
const SELF_REPORTING_TOOLS: ReadonlySet<string> = new Set([
  "get_capabilities", "list_projects", "inspect_project", "manage_project",
  "propose_transaction", "apply_transaction", "inspect_transaction", "apply_batch",
  "revert_transaction", "undo_transaction", "apply_document_operation", "resize_document",
  "focus_ui", "manage_asset", "preview_revision", "manage_organization", "manage_job",
  "apply_layer_operation", "apply_color_adjustment", "guided_step", "manage_sequence",
  "apply_timeline_edit", "preview_sequence_frame", "render_sequence", "render_audio",
  "export_image", "manage_output",
]);

/**
 * Gives a tool a visible beginning and end.
 *
 * The blueprint's promise is that agent work is never invisible, and fourteen tools were
 * breaking it — six of them committing revisions with an undo token nobody could see, which
 * is the worst version: the change happened, the history recorded it, and the person had no
 * way to notice or reverse it without opening a panel. Wrapping at the registry means the
 * promise holds for every tool added later without anyone remembering to wire it up.
 */
function withVisibleActivity(tool: ModelContextToolDefinition): ModelContextToolDefinition {
  if (SELF_REPORTING_TOOLS.has(tool.name)) return tool;
  const readOnly = tool.annotations?.readOnlyHint === true;
  const inner = tool.execute;

  return {
    ...tool,
    execute: async (input) => {
      const id = crypto.randomUUID();
      const failuresBefore = reportedFailureCount;
      webMcpActivityStore.show({
        id,
        stage: readOnly ? "inspecting" : "committing",
        title: humanizeToolName(tool.name),
        detail: readOnly ? "Reading project state. Nothing will change." : "Applying a change through WebMCP.",
        projectId: projectIdOf(input),
      });
      try {
        const result = await inner(input);
        const payload = (result as { structuredContent?: Record<string, unknown> } | undefined)?.structuredContent;
        if (payload?.ok === false) {
          if (reportedFailureCount > failuresBefore) {
            // The tool raised its own failure card with its own wording. A second one saying
            // the same thing in worse words is noise.
            webMcpActivityStore.clearActivity(id);
            return result;
          }
          // Otherwise surface its own words, rather than reporting a success that did not
          // happen.
          const error = payload.error as { message?: string } | undefined;
          webMcpActivityStore.show({
            id, stage: "failed",
            title: `${humanizeToolName(tool.name)} was refused`,
            detail: error?.message ?? "No project revision was changed.",
            projectId: payload.projectId as string | undefined,
          });
          return result;
        }
        const projectId = (payload?.projectId as string | undefined) ?? projectIdOf(input);
        const transactionId = payload?.transactionId as string | undefined;
        webMcpActivityStore.show({
          id,
          stage: "complete",
          title: sentenceOf(payload?.summary) ?? `${humanizeToolName(tool.name)} finished`,
          detail: readOnly
            ? "Inspection only; no revision changed."
            : "Undo remains available through the returned token.",
          projectId,
          transactionId,
          // Only offered when there is genuinely something to undo, so the button is never
          // a promise the engine cannot keep.
          undoProjectId: !readOnly && projectId && transactionId && payload?.undoAvailable !== false
            ? projectId
            : undefined,
        });
        return result;
      } catch (error) {
        const parsed = toProjectError(error);
        webMcpActivityStore.show({
          id, stage: "failed",
          title: `${humanizeToolName(tool.name)} failed`,
          detail: `${parsed.message} The current project state was preserved.`,
          projectId: projectIdOf(input),
        });
        return errorEnvelope(parsed);
      }
    },
  };
}

/** "manage_collections" reads as "Manage collections" in the activity card. */
function humanizeToolName(name: string): string {
  const words = name.split("_");
  return `${words[0][0].toUpperCase()}${words[0].slice(1)}${words.length > 1 ? ` ${words.slice(1).join(" ")}` : ""}`;
}

/** The project a call is about, when the input names one, so the card can point at it. */
function projectIdOf(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const value = (input as Record<string, unknown>).projectId;
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const registeredContexts = new WeakSet<object>();

export function registerEstroSiteTools(
  services: EstroToolServices,
  modelContext: ModelContextApi | undefined = document.modelContext,
): number {
  if (!modelContext?.registerTool || registeredContexts.has(modelContext)) return 0;
  const tools = createEstroSiteTools(services);
  tools.forEach((tool) => modelContext.registerTool?.(tool));
  registeredContexts.add(modelContext);
  registeredToolCount = tools.length;
  return tools.length;
}

/**
 * A one-line description of a project for the listing.
 *
 * Written so an agent can choose between projects without opening each one: it says what
 * kind of work is in there, not how the record is stored.
 */
function describeProjectForList(
  name: string,
  kind: string,
  content: { hasDocument: boolean; layerCount: number; assetCount: number } | null,
): string {
  if (!content) return `“${name}” could not be read. Its history may need recovery.`;
  const parts: string[] = [];
  if (content.hasDocument) parts.push(`an image document with ${content.layerCount} layer(s)`);
  if (content.assetCount > 0) parts.push(`${content.assetCount} media item(s)`);
  if (parts.length === 0) return `“${name}” is an empty ${kind} project. It has no document, sequence, or media yet.`;
  return `“${name}” holds ${parts.join(", ")}.`;
}

/**
 * A tool's `summary` only if it really is one.
 *
 * The activity card puts this straight into a heading. One tool returned a counts object
 * there, React refused to render it as a child, and the whole editor unmounted — from an
 * inspection that changed nothing. A guard is cheaper than trusting sixty-nine call sites.
 */
function sentenceOf(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/** The layer counts as a sentence, for the `summary` field callers expect to read. */
function describeLayerCounts(counts: { total: number; images: number; groups: number; depth: number }): string {
  if (counts.total === 0) return "This document has no layers yet.";
  const parts = [`${counts.total} layer(s)`];
  if (counts.images > 0) parts.push(`${counts.images} of them images`);
  if (counts.groups > 0) parts.push(`${counts.groups} group(s), nested ${counts.depth} deep`);
  return `${parts.join(", ")}.`;
}
