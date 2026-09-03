import { z } from "zod";
import { ProjectError, toProjectError } from "../domain/project-error";
import type { JobService } from "./job-service";
import type { OutputService } from "./output-service";
import type { ProjectService } from "./project-service";
import type { RenderService } from "./render-service";

/**
 * Exporting many photographs at once, and generating several sizes of each.
 *
 * The whole point is that it does not block: a hundred photographs at three sizes is three
 * hundred encodes, so it runs as a job with progress and a cancel, the same as a video render.
 * Everything it needs is in the job's serializable intent, so a batch survives a reload rather
 * than being lost with the tab.
 */

export const MAX_BATCH_EXPORT_PROJECTS = 200;
export const MAX_BATCH_EXPORT_VARIANTS = 6;

/**
 * One size and format to produce.
 *
 * Named, because generating three sizes of a hundred photographs produces three hundred files
 * and "which of these is the thumbnail" has to be answerable from the name alone.
 */
export const exportVariantSchema = z.object({
  name: z.string().trim().min(1).max(60),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "image/avif"]),
  quality: z.number().min(0.1).max(1).default(0.85),
  /** Null exports at the document's own size. */
  maxEdgePx: z.number().int().min(16).max(32768).nullable().default(null),
  resampleAlgorithm: z.enum(["nearest", "bilinear", "lanczos3", "browser-smooth"]).default("lanczos3"),
});
export type ExportVariant = z.infer<typeof exportVariantSchema>;

export const batchExportRequestSchema = z.object({
  /** The project the job belongs to, for progress and cancellation. */
  projectId: z.string().min(1),
  projectIds: z.array(z.string().min(1)).min(1).max(MAX_BATCH_EXPORT_PROJECTS),
  variants: z.array(exportVariantSchema).min(1).max(MAX_BATCH_EXPORT_VARIANTS),
  /**
   * How each file is named.
   *
   * `{project}` and `{variant}` are replaced; anything else is kept. A pattern rather than a
   * fixed scheme, because what makes a set of files findable depends on where they are going.
   */
  namePattern: z.string().trim().min(1).max(160).default("{project} — {variant}"),
  /**
   * What to do when one photograph cannot be exported.
   *
   * `continue` is the default here, unlike a batch edit: a hundred photographs where three
   * failed is a useful result, and stopping the whole run at the fourth would throw away
   * ninety-six finished encodes.
   */
  onFailure: z.enum(["continue", "stop"]).default("continue"),
});
export type BatchExportRequest = z.infer<typeof batchExportRequestSchema>;
/** What a caller passes: the defaulted fields may be left out. */
export type BatchExportInput = z.input<typeof batchExportRequestSchema>;

export interface BatchExportPlanItem {
  projectId: string;
  projectName: string | null;
  /** Null when the project has nothing to export, with the reason given. */
  variants: string[] | null;
  reason: string | null;
}

export interface BatchExportPlan {
  items: BatchExportPlanItem[];
  fileCount: number;
  blocked: number;
  canRun: boolean;
  blockedReason: string | null;
  summary: string;
}

export interface BatchExportOutcome {
  produced: { projectId: string; variant: string; outputId: string; byteSize: number; mediaType: string }[];
  failed: { projectId: string; variant: string; reason: string }[];
  summary: string;
}

/** Fills `{project}` and `{variant}` into the pattern. */
export function fileNameFor(pattern: string, projectName: string, variant: string): string {
  return pattern
    .replaceAll("{project}", projectName)
    .replaceAll("{variant}", variant)
    .trim() || `${projectName} — ${variant}`;
}

export class BatchExportService {
  constructor(
    private readonly projects: ProjectService,
    private readonly renders: RenderService,
    private readonly outputs: OutputService,
    private readonly jobs: JobService,
  ) {
    this.registerRunner();
  }

  /**
   * Costs a batch before it runs.
   *
   * Three hundred encodes is minutes of work, so a person is told what they are asking for and
   * which photographs cannot take part, rather than finding out when the count comes up short.
   */
  async plan(input: BatchExportInput): Promise<BatchExportPlan> {
    const request = batchExportRequestSchema.parse(input);
    const items: BatchExportPlanItem[] = [];

    for (const projectId of request.projectIds) {
      try {
        const history = await this.projects.getProjectHistory(projectId);
        const state = history.headRevision.state;
        if (!state.photoDocument) {
          items.push({ projectId, projectName: state.name, variants: null, reason: "This project has no image document to export." });
          continue;
        }
        items.push({
          projectId, projectName: state.name,
          variants: request.variants.map((variant) => variant.name),
          reason: null,
        });
      } catch {
        items.push({ projectId, projectName: null, variants: null, reason: "This project is no longer available." });
      }
    }

    const runnable = items.filter((item) => item.variants);
    const blocked = items.length - runnable.length;
    const fileCount = runnable.length * request.variants.length;
    // `stop` refuses to begin unless every photograph can take part, so nobody ends up with a
    // set that is silently short.
    const canRun = fileCount > 0 && (request.onFailure === "continue" || blocked === 0);

    return {
      items, fileCount, blocked, canRun,
      blockedReason: canRun ? null
        : fileCount === 0 ? "None of those projects has an image document to export."
          : `${blocked} of ${items.length} projects cannot be exported. Set onFailure to continue to export the rest.`,
      summary: `${fileCount} file(s) from ${runnable.length} project(s)${blocked ? `, with ${blocked} left out` : ""}.`,
    };
  }

  /** Queues the batch. Everything it needs is in the intent, so it survives a reload. */
  async start(input: BatchExportInput): Promise<{ jobId: string; plan: BatchExportPlan }> {
    try {
      const request = batchExportRequestSchema.parse(input);
      const plan = await this.plan(request);
      if (!plan.canRun) {
        throw new ProjectError("INVALID_INPUT", plan.blockedReason ?? "This batch cannot run.", { fieldPath: "projectIds" });
      }
      const job = await this.jobs.startJob({
        projectId: request.projectId,
        kind: "export",
        label: `Export ${plan.fileCount} image(s)`,
        stage: "Preparing",
        priority: "user",
        targetIds: request.projectIds,
        intent: { kind: "export", payloadVersion: 1, payload: { ...request } },
      });
      return { jobId: job.id, plan };
    } catch (error) { throw toProjectError(error); }
  }

  private registerRunner(): void {
    this.jobs.registerRunner("export", async (context, intent) => {
      const request = batchExportRequestSchema.parse(intent.payload);
      const produced: BatchExportOutcome["produced"] = [];
      const failed: BatchExportOutcome["failed"] = [];
      const outputIds: string[] = [];

      const total = request.projectIds.length * request.variants.length;
      let done = 0;

      for (const projectId of request.projectIds) {
        // Cancelling stops between files rather than mid-encode, so nothing half-written is
        // ever saved and the files already finished are kept.
        if (context.isCancelled()) break;

        let projectName = projectId;
        try {
          const history = await this.projects.getProjectHistory(projectId);
          projectName = history.headRevision.state.name;
          if (!history.headRevision.state.photoDocument) {
            throw new ProjectError("INVALID_INPUT", "This project has no image document to export.");
          }
        } catch (error) {
          const reason = toProjectError(error).message;
          for (const variant of request.variants) failed.push({ projectId, variant: variant.name, reason });
          done += request.variants.length;
          await context.warn(`${projectId}: ${reason}`);
          if (request.onFailure === "stop") break;
          continue;
        }

        for (const variant of request.variants) {
          if (context.isCancelled()) break;
          await context.report({
            stage: `Exporting ${projectName} — ${variant.name}`,
            completedUnits: done,
            totalUnits: total,
          });

          try {
            const result = await this.renders.previewExport(projectId, {
              mediaType: variant.mediaType,
              quality: variant.quality,
              maxEdgePx: variant.maxEdgePx ?? undefined,
              resampleAlgorithm: variant.resampleAlgorithm,
              preserveTransparency: true,
            });

            const settings = {
              container: result.mediaType, videoCodec: null, audioCodec: null,
              widthPx: result.widthPx, heightPx: result.heightPx, frameRate: null,
              videoBitsPerSecond: null, audioBitsPerSecond: null, sampleRateHz: null, channels: null,
              quality: variant.quality,
            };
            const output = await this.outputs.saveOutput({
              projectId, kind: "photo",
              name: fileNameFor(request.namePattern, projectName, variant.name),
              sourceRevisionId: result.revisionId, scope: "document",
              sequenceId: null, clipId: null, documentId: null, range: null, presetId: null,
              requestedSettings: { ...settings, container: variant.mediaType },
              actualSettings: settings,
              mediaType: result.mediaType, durationSeconds: null, frameCount: null,
              warnings: result.warnings,
              substitutions: result.substituted
                ? [`Produced ${result.mediaType} instead of ${variant.mediaType}.`]
                : [],
              jobId: context.jobId, blob: result.blob,
            });

            produced.push({
              projectId, variant: variant.name, outputId: output.id,
              byteSize: result.byteSize, mediaType: result.mediaType,
            });
            outputIds.push(output.id);
          } catch (error) {
            const reason = toProjectError(error).message;
            failed.push({ projectId, variant: variant.name, reason });
            await context.warn(`${projectName} — ${variant.name}: ${reason}`);
            if (request.onFailure === "stop") {
              // Everything already written stays: a stopped batch has still done real work,
              // and throwing it away would be worse than leaving a partial set.
              await context.report({ stage: "Stopped", completedUnits: done, totalUnits: total });
              return { outputIds };
            }
          }
          done += 1;
        }
      }

      await context.report({ stage: "Finished", completedUnits: done, totalUnits: total });
      return { outputIds };
    });
  }

  /** A sentence describing what a finished batch produced. */
  static describe(outcome: BatchExportOutcome): string {
    if (!outcome.produced.length) return "No files were produced.";
    const bytes = outcome.produced.reduce((total, entry) => total + entry.byteSize, 0);
    const size = bytes > 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`;
    return outcome.failed.length
      ? `${outcome.produced.length} file(s), ${size} in total; ${outcome.failed.length} could not be produced.`
      : `${outcome.produced.length} file(s), ${size} in total.`;
  }
}
