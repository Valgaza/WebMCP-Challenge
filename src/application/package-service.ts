import { z } from "zod";
import {
  PACKAGE_SCHEMA_VERSION, assertReadable, compareHistories, describePackage, mediaPolicySchema,
  offlineState, packageManifestSchema, planResolution, resolutionSchema,
  type OfflineState, type PackageManifest, type Resolution, type ResolutionPlan,
  type SyncComparison,
} from "../domain/package";
import { HISTORY_SCHEMA_VERSION } from "../domain/project-history";
import { ProjectError, toProjectError } from "../domain/project-error";
import type { AssetService } from "./asset-service";
import type { ProjectService } from "./project-service";

/**
 * Writing a project out whole, reading one back, and working out what to do when both ends have
 * changed.
 *
 * There is no server, so a package *is* the sync mechanism: a file the person carries by
 * whatever means they already have. What this service owes them in exchange for that weaker
 * promise is complete honesty about what a package contains, what it will cost, and what
 * opening one will do to the project already here.
 */

export const writePackageInputSchema = z.object({
  projectId: z.string().min(1),
  mediaPolicy: mediaPolicySchema.default("used_only"),
  /** Named so two packages from two machines can be told apart. */
  writtenBy: z.string().trim().min(1).max(120).default("this machine"),
});
export type WritePackageInput = z.input<typeof writePackageInputSchema>;

export interface PackageEstimate {
  manifest: PackageManifest;
  /** How large the finished package will be, near enough to decide by. */
  byteSize: number;
  /** Media the policy includes but that this machine cannot read. */
  missing: { assetId: string; name: string; reason: string }[];
  summary: string;
}

export interface WrittenPackage {
  manifest: PackageManifest;
  /** The project itself, as JSON. */
  project: string;
  /** The media files the policy asked for, by asset id. */
  media: Map<string, Blob>;
  byteSize: number;
  warnings: string[];
}

/** Where the last package was written from, so unshared work can be counted. */
export interface SharedMarker {
  revisionId: string;
  at: string;
}

/**
 * The revisions a project has passed through, oldest first.
 *
 * Derived from the transactions rather than stored, because the transactions *are* the history:
 * each one names the revision it produced, and a separate list could disagree with them. Undo
 * and redo appear here as the revisions they produced, which is right — reconciliation cares
 * about what a project has been, not about how it got there.
 */
export function revisionChain(transactions: readonly { sequence: number; resultingRevisionId: string }[]): string[] {
  const ordered = [...transactions].sort((a, b) => a.sequence - b.sequence);
  const seen = new Set<string>();
  const chain: string[] = [];
  for (const transaction of ordered) {
    if (seen.has(transaction.resultingRevisionId)) continue;
    seen.add(transaction.resultingRevisionId);
    chain.push(transaction.resultingRevisionId);
  }
  return chain;
}

export class PackageService {
  /**
   * Which revision each project was last written out at.
   *
   * In memory rather than in the project, deliberately: it is a fact about *this machine's*
   * relationship to a file, not about the project — and writing it into the project would
   * change the project every time it was shared, which is both circular and confusing.
   */
  private readonly shared = new Map<string, SharedMarker>();

  constructor(
    private readonly projects: ProjectService,
    private readonly assets: AssetService,
  ) {}

  /**
   * What a package would contain and cost, before anything is written.
   *
   * The estimate exists because the media policy is the whole decision and the sizes involved
   * are the only way to make it: "everything" on a documentary is hundreds of gigabytes, and
   * finding that out during the write is finding out too late.
   */
  async estimate(input: WritePackageInput): Promise<PackageEstimate> {
    try {
      const parsed = writePackageInputSchema.parse(input);
      const history = await this.projects.getProjectHistory(parsed.projectId);
      const state = history.headRevision.state;
      const assets = state.assets ?? [];

      const used = new Set<string>();
      for (const layer of state.photoDocument?.layers ?? []) {
        if (layer.kind === "image") used.add(layer.assetId);
      }

      const includes = (assetId: string): boolean => {
        if (parsed.mediaPolicy === "none") return false;
        if (parsed.mediaPolicy === "everything") return true;
        return used.has(assetId);
      };

      const missing: PackageEstimate["missing"] = [];
      const media = await Promise.all(assets.map(async (asset) => {
        const included = includes(asset.id);
        if (included) {
          // Checked rather than assumed: a package that silently left out an offline file
          // would open somewhere else looking complete and be missing a shot.
          const readable = await this.assets.readAssetFile(asset.id).catch((error) => {
            missing.push({
              assetId: asset.id, name: asset.name,
              reason: toProjectError(error).message,
            });
            return null;
          });
          if (!readable) {
            return { assetId: asset.id, name: asset.name, contentHash: asset.contentHash, byteSize: asset.byteSize, included: false };
          }
        }
        return {
          assetId: asset.id, name: asset.name, contentHash: asset.contentHash,
          byteSize: asset.byteSize, included,
        };
      }));

      const manifest = packageManifestSchema.parse({
        schemaVersion: PACKAGE_SCHEMA_VERSION,
        historySchemaVersion: HISTORY_SCHEMA_VERSION,
        projectId: parsed.projectId,
        projectName: state.name,
        headRevisionId: history.headRevision.id,
        revisionIds: revisionChain(history.transactions),
        writtenAt: new Date().toISOString(),
        writtenBy: parsed.writtenBy,
        mediaPolicy: parsed.mediaPolicy,
        media,
      });

      const byteSize = media
        .filter((entry) => entry.included)
        .reduce((total, entry) => total + entry.byteSize, 0);

      return {
        manifest, byteSize, missing,
        summary: missing.length
          ? `${describePackage(manifest)} ${missing.length} file(s) cannot be read on this machine and will not be included.`
          : describePackage(manifest),
      };
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Writes the package.
   *
   * The project's whole history goes in, not just its current state: a package that carried
   * only the head would arrive somewhere else with no Undo and nothing to compare against when
   * it came back, which is what makes reconciliation possible at all.
   */
  async write(input: WritePackageInput): Promise<WrittenPackage> {
    try {
      const estimate = await this.estimate(input);
      const history = await this.projects.getProjectHistory(estimate.manifest.projectId);

      const media = new Map<string, Blob>();
      const warnings: string[] = [];
      for (const entry of estimate.manifest.media) {
        if (!entry.included) continue;
        const file = await this.assets.readAssetFile(entry.assetId).catch(() => null);
        if (!file) {
          warnings.push(`“${entry.name}” could not be read and is not in this package.`);
          continue;
        }
        media.set(entry.assetId, file);
      }
      for (const gone of estimate.missing) {
        warnings.push(`“${gone.name}” is not in this package: ${gone.reason}`);
      }

      const project = JSON.stringify({
        manifest: estimate.manifest,
        project: history.project,
        headRevision: history.headRevision,
        transactions: history.transactions,
      });

      this.shared.set(estimate.manifest.projectId, {
        revisionId: estimate.manifest.headRevisionId,
        at: estimate.manifest.writtenAt,
      });

      let byteSize = project.length;
      for (const blob of media.values()) byteSize += blob.size;

      return { manifest: estimate.manifest, project, media, byteSize, warnings };
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Reads a package's manifest and says how it relates to what is here.
   *
   * Nothing is opened and nothing is changed. The whole point is that a person sees the
   * relationship — behind, ahead, diverged, unrelated — before deciding anything, because those
   * four need entirely different things offered.
   */
  async inspect(packageJson: string): Promise<{
    manifest: PackageManifest;
    comparison: SyncComparison | null;
    knownHere: boolean;
    summary: string;
  }> {
    try {
      const parsed = JSON.parse(packageJson) as { manifest?: unknown };
      const manifest = packageManifestSchema.parse(parsed.manifest);
      assertReadable(manifest);

      const local = await this.projects.getProjectHistory(manifest.projectId).catch(() => null);
      if (!local) {
        return {
          manifest, comparison: null, knownHere: false,
          summary: `${describePackage(manifest)} This project is not on this machine, so opening it adds it rather than changing anything.`,
        };
      }

      const comparison = compareHistories(
        { headRevisionId: local.headRevision.id, revisionIds: revisionChain(local.transactions) },
        { headRevisionId: manifest.headRevisionId, revisionIds: manifest.revisionIds },
      );
      return {
        manifest, comparison, knownHere: true,
        summary: `${describePackage(manifest)} ${comparison.summary}`,
      };
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw new ProjectError(
          "INVALID_INPUT",
          "That file is not a readable Estro package. It may be a different kind of file, or have been truncated in transfer.",
          { fieldPath: "packageJson" },
        );
      }
      throw toProjectError(error);
    }
  }

  /**
   * Says what a choice will do, before it is made.
   *
   * Separate from doing it, because "take the package" sounds harmless right up until it means
   * an afternoon's work is no longer the open project.
   */
  async planOpen(packageJson: string, resolution: Resolution): Promise<ResolutionPlan> {
    const { comparison, knownHere } = await this.inspect(packageJson);
    if (!knownHere || !comparison) {
      return {
        resolution: resolutionSchema.parse(resolution),
        preservesBoth: true,
        outcome: "This project is not on this machine, so it is added and nothing existing is touched.",
        warnings: [],
      };
    }
    return planResolution(comparison, resolutionSchema.parse(resolution));
  }

  /**
   * How much of this project exists only here.
   *
   * Offline editing needs almost nothing built for it, because everything is local already.
   * What it needs is an honest answer to "is my work anywhere but here", which is a different
   * question from "did it save" — and one the editor could easily leave someone guessing at.
   */
  async offlineState(projectId: string): Promise<OfflineState> {
    const history = await this.projects.getProjectHistory(projectId);
    const marker = this.shared.get(projectId) ?? null;
    return offlineState({
      headRevisionId: history.headRevision.id,
      revisionIds: revisionChain(history.transactions),
      lastSharedRevisionId: marker?.revisionId ?? null,
      lastSharedAt: marker?.at ?? null,
    });
  }

  /** Records that a project was written out elsewhere, so the count stays honest. */
  markShared(projectId: string, revisionId: string, at = new Date().toISOString()): void {
    this.shared.set(projectId, { revisionId, at });
  }
}
