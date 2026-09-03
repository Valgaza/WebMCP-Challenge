import Dexie, { type EntityTable } from "dexie";
import { PROJECT_SCHEMA_VERSION, type ProjectRecord } from "../domain/project";
import {
  HISTORY_SCHEMA_VERSION,
  type ProjectRevision,
  type ProjectTransaction,
} from "../domain/project-history";
import {
  PERSISTENCE_SCHEMA_VERSION,
  type ProjectDurability,
  type ProjectProposal,
  type ProjectSnapshot,
} from "../domain/project-persistence";
import type { WorkspacePreference } from "../domain/workspace";
import { ASSET_SCHEMA_VERSION, type AssetRecord } from "../domain/asset";
import type { JobRecord } from "../domain/job";
import type { OutputRecord } from "../domain/output";
import type { SourceStoreEntry } from "./source-store";
import type { DerivedCacheEntry } from "./derived-cache";
import type { SourceIntentRecord, SourceMigrationRecord } from "./source-intent";
import type { PresetRecord } from "../domain/preset";
import type { SavedSelection } from "../domain/selection";

/**
 * A file handle cannot live in a revision (it is neither small nor portable), so it is
 * stored beside the asset and re-checked for permission on demand.
 */
export interface AssetSourceRecord {
  assetId: string;
  projectId: string;
  handle: FileSystemFileHandle | null;
}

/** A saved selection and its coverage bytes, stored together so neither can outlive the other. */
export interface SelectionRecord extends SavedSelection {
  projectId: string;
  coverage: Uint8Array;
}

interface LegacyProjectRecord extends Omit<ProjectRecord, "headRevisionId" | "undoTransactionIds" | "redoTransactionIds"> {}

export class EstroDatabase extends Dexie {
  projects!: EntityTable<ProjectRecord, "id">;
  revisions!: EntityTable<ProjectRevision, "id">;
  transactions!: EntityTable<ProjectTransaction, "id">;
  durability!: EntityTable<ProjectDurability, "projectId">;
  snapshots!: EntityTable<ProjectSnapshot, "id">;
  proposals!: EntityTable<ProjectProposal, "id">;
  workspaces!: EntityTable<WorkspacePreference, "projectId">;
  /** Keyed by `[projectId+id]`: one runtime record per project per asset. */
  assetRecords!: EntityTable<AssetRecord, "id">;
  assetSources!: EntityTable<AssetSourceRecord, "assetId">;
  jobs!: EntityTable<JobRecord, "id">;
  /** Index of original media held in the durable source store; never cache. */
  sourceIndex!: EntityTable<SourceStoreEntry, "key">;
  /** Index of reproducible derivatives, with the provenance that decides staleness. */
  derivedIndex!: EntityTable<DerivedCacheEntry, "key">;
  /** Durable delivery records. Outputs persist until explicitly deleted. */
  outputs!: EntityTable<OutputRecord, "id">;
  /** In-flight import/relink operations, so a crash can be finished or undone on startup. */
  sourceIntents!: EntityTable<SourceIntentRecord, "id">;
  /** Originals still living in the pre-v9 layout, waiting to be moved and verified. */
  sourceMigrations!: EntityTable<SourceMigrationRecord, "assetId">;
  /**
   * Reusable parameter bundles: pasted attributes, saved presets, and project templates.
   * One table because they are one model wearing three hats.
   */
  presets!: EntityTable<PresetRecord, "id">;

  /**
   * Saved selections, mask bytes and all.
   *
   * A saved selection is work, not a derivative: it cannot be recomputed from anything else
   * once the click that made it is forgotten. So it lives here under the durable quota rather
   * than in the evictable derived cache.
   */
  selections!: EntityTable<SelectionRecord, "id">;

  constructor(name = "estro") {
    super(name);

    this.version(1).stores({
      projects: "id, name, kind, status, updatedAt, lastOpenedAt",
    });

    this.version(2)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
      })
      .upgrade(async (transaction) => {
        const projects = (await transaction.table("projects").toArray()) as LegacyProjectRecord[];

        for (const project of projects) {
          const revisionId = `migration-revision-${project.id}`;
          const transactionId = `migration-transaction-${project.id}`;
          const operationId = `migration-operation-${project.id}`;
          const state = { name: project.name, kind: project.kind, status: project.status, photoDocument: null };

          const historyTransaction: ProjectTransaction = {
            id: transactionId,
            schemaVersion: HISTORY_SCHEMA_VERSION,
            projectId: project.id,
            sequence: 0,
            kind: "initialize",
            targetTransactionId: null,
            sourceRevisionId: null,
            resultingRevisionId: revisionId,
            operations: [
              {
                id: operationId,
                schemaVersion: HISTORY_SCHEMA_VERSION,
                type: "project.create",
                projectId: project.id,
                state,
              },
            ],
            actor: { type: "system", id: "estro-migration", displayName: "Estro migration" },
            intent: "Migrate the existing local project into revision-backed history.",
            summary: "Created the initial revision for this existing local project.",
            affectedIds: [project.id],
            warnings: [],
            undoable: false,
            createdAt: project.createdAt,
          };

          const revision: ProjectRevision = {
            id: revisionId,
            schemaVersion: HISTORY_SCHEMA_VERSION,
            projectId: project.id,
            sequence: 0,
            parentRevisionId: null,
            transactionId,
            state,
            createdAt: project.createdAt,
          };

          await transaction.table("transactions").add(historyTransaction);
          await transaction.table("revisions").add(revision);
          await transaction.table("projects").put({
            ...project,
            schemaVersion: PROJECT_SCHEMA_VERSION,
            headRevisionId: revisionId,
            undoTransactionIds: [],
            redoTransactionIds: [],
          });
        }
      });

    this.version(3)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
      })
      .upgrade(async (transaction) => {
        const projects = await transaction.table("projects").toArray();

        for (const project of projects) {
          if (project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
            await transaction.table("projects").update(project.id, {
              schemaVersion: PROJECT_SCHEMA_VERSION,
            });
          }
        }
      });

    this.version(4)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
      })
      .upgrade(async (transaction) => {
        const projects = (await transaction.table("projects").toArray()) as ProjectRecord[];

        for (const project of projects) {
          await transaction.table("durability").put({
            projectId: project.id,
            schemaVersion: PERSISTENCE_SCHEMA_VERSION,
            durableRevisionId: project.headRevisionId,
            lastExplicitSaveAt: project.updatedAt,
            lastAutosaveAt: null,
            recoveryReason: null,
            recoveryCreatedAt: null,
          } satisfies ProjectDurability);
        }
      });

    this.version(5)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
      })
      .upgrade(async (transaction) => {
        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (!("photoDocument" in revision.state)) {
            await transaction.table("revisions").put({ ...revision, state: { ...revision.state, photoDocument: null } });
          }
        }
        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return { ...operation, state: { ...state, photoDocument: state.photoDocument ?? null } };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              return {
                ...operation,
                fromState: { ...fromState, photoDocument: fromState.photoDocument ?? null },
                toState: { ...toState, photoDocument: toState.photoDocument ?? null },
              };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }
      });

    this.version(6)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
        assets: "id, projectId, availability, updatedAt, [projectId+availability]",
        assetSources: "assetId, projectId",
        jobs: "id, projectId, status, kind, createdAt, [projectId+status]",
      })
      .upgrade(async (transaction) => {
        // Every stored state and state-carrying operation gains an explicit empty asset list
        // so replay of pre-v6 history produces a state the current schema accepts.
        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (!("assets" in revision.state)) {
            await transaction.table("revisions").put({ ...revision, state: { ...revision.state, assets: [] } });
          }
        }

        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return { ...operation, state: { ...state, assets: state.assets ?? [] } };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              return {
                ...operation,
                fromState: { ...fromState, assets: fromState.assets ?? [] },
                toState: { ...toState, assets: toState.assets ?? [] },
              };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }
      });

    this.version(7)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
        assets: "id, projectId, availability, updatedAt, [projectId+availability]",
        assetSources: "assetId, projectId",
        jobs: "id, projectId, status, kind, createdAt, [projectId+status]",
      })
      .upgrade(async (transaction) => {
        // Documents created before layers existed gain an explicit empty stack so replaying
        // pre-v7 history produces a state the current schema accepts.
        const withLayers = (document: Record<string, unknown> | null | undefined) =>
          document ? { ...document, layers: document.layers ?? [] } : document;

        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (revision.state?.photoDocument && !("layers" in revision.state.photoDocument)) {
            await transaction.table("revisions").put({
              ...revision,
              state: { ...revision.state, photoDocument: withLayers(revision.state.photoDocument) },
            });
          }
        }

        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "document.create" || operation.type === "document.remove") {
              return { ...operation, document: withLayers(operation.document as Record<string, unknown>) };
            }
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return { ...operation, state: { ...state, photoDocument: withLayers(state.photoDocument as Record<string, unknown> | null) } };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              return {
                ...operation,
                fromState: { ...fromState, photoDocument: withLayers(fromState.photoDocument as Record<string, unknown> | null) },
                toState: { ...toState, photoDocument: withLayers(toState.photoDocument as Record<string, unknown> | null) },
              };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }
      });

    this.version(8)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
        assets: "id, projectId, availability, updatedAt, [projectId+availability]",
        assetSources: "assetId, projectId",
        jobs: "id, projectId, status, kind, createdAt, [projectId+status]",
      })
      .upgrade(async (transaction) => {
        // Projects created before sequences existed gain an explicit empty list, so replaying
        // pre-v8 history still produces a state the current schema accepts.
        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (revision.state && !("sequences" in revision.state)) {
            await transaction.table("revisions").put({ ...revision, state: { ...revision.state, sequences: [] } });
          }
        }

        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return { ...operation, state: { ...state, sequences: state.sequences ?? [] } };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              return {
                ...operation,
                fromState: { ...fromState, sequences: fromState.sequences ?? [] },
                toState: { ...toState, sequences: toState.sequences ?? [] },
              };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }
      });

    this.version(9)
      .stores({
        projects: "id, name, kind, status, updatedAt, lastOpenedAt, headRevisionId",
        revisions: "id, projectId, parentRevisionId, transactionId, createdAt",
        transactions: "id, projectId, resultingRevisionId, kind, createdAt",
        durability: "projectId, durableRevisionId, recoveryCreatedAt",
        snapshots: "id, projectId, revisionId, transactionId, status, createdAt",
        proposals: "id, projectId, sourceRevisionId, status, expiresAt",
        workspaces: "projectId, updatedAt",
        assets: "id, projectId, availability, updatedAt, [projectId+availability]",
        assetSources: "assetId, projectId",
        jobs: "id, projectId, status, kind, createdAt, [projectId+status]",
        // Originals, derivatives, and outputs are separate stores with separate lifecycles.
        // Collapsing them is what allowed an imported original to be evicted as if it were
        // a thumbnail, so the separation is enforced by the schema rather than by convention.
        sourceIndex: "key, assetId, projectId, state, [projectId+state]",
        derivedIndex: "key, kind, assetId, projectId, sourceRevision, lastUsedAt",
        outputs: "id, projectId, kind, createdAt, jobId, [projectId+kind]",
      })
      .upgrade(async (transaction) => {
        // Asset references gain an explicit source revision and detected stream metadata.
        // Old records are migrated rather than overwritten so pre-v9 history still replays.
        const upgradeAsset = (asset: Record<string, unknown> | null | undefined): Record<string, unknown> | null | undefined => {
          if (!asset) return asset;
          if (asset.schemaVersion === ASSET_SCHEMA_VERSION) return asset;
          return {
            ...asset,
            schemaVersion: ASSET_SCHEMA_VERSION,
            sourceRevision: (asset.sourceRevision as number | undefined) ?? 1,
            streams: asset.streams ?? {
              container: null,
              video: asset.hasVideo
                ? { widthPx: asset.widthPx, heightPx: asset.heightPx, frameRate: asset.frameRate ?? null, codec: null }
                : null,
              audio: asset.hasAudio ? { channels: 2, sampleRateHz: null, codec: null } : null,
            },
          };
        };
        const upgradeAssets = (assets: unknown): unknown =>
          Array.isArray(assets) ? assets.map((asset) => upgradeAsset(asset as Record<string, unknown>)) : assets;

        const revisions = await transaction.table("revisions").toArray();
        for (const revision of revisions) {
          if (!revision.state) continue;
          await transaction.table("revisions").put({
            ...revision,
            state: {
              ...revision.state,
              assets: upgradeAssets(revision.state.assets ?? []),
              // Bins and the active sequence are new project-state fields; an empty default
              // keeps replay of pre-v9 history producing a state the current schema accepts.
              bins: revision.state.bins ?? [],
              activeSequenceId: revision.state.activeSequenceId ?? null,
              subclips: revision.state.subclips ?? [],
            },
          });
        }

        const transactions = await transaction.table("transactions").toArray();
        for (const historyTransaction of transactions) {
          const operations = historyTransaction.operations.map((operation: Record<string, unknown>) => {
            if (operation.type === "asset.register" || operation.type === "asset.remove") {
              return { ...operation, asset: upgradeAsset(operation.asset as Record<string, unknown>) };
            }
            if (operation.type === "asset.replace_source") {
              return {
                ...operation,
                fromAsset: upgradeAsset(operation.fromAsset as Record<string, unknown>),
                toAsset: upgradeAsset(operation.toAsset as Record<string, unknown>),
              };
            }
            if (operation.type === "project.create" || operation.type === "project.duplicate") {
              const state = operation.state as Record<string, unknown>;
              return {
                ...operation,
                state: {
                  ...state,
                  assets: upgradeAssets(state.assets ?? []),
                  bins: state.bins ?? [],
                  activeSequenceId: state.activeSequenceId ?? null,
                  subclips: state.subclips ?? [],
                },
              };
            }
            if (operation.type === "project.restore") {
              const fromState = operation.fromState as Record<string, unknown>;
              const toState = operation.toState as Record<string, unknown>;
              const withDefaults = (state: Record<string, unknown>) => ({
                ...state,
                assets: upgradeAssets(state.assets ?? []),
                bins: state.bins ?? [],
                activeSequenceId: state.activeSequenceId ?? null,
                subclips: state.subclips ?? [],
              });
              return { ...operation, fromState: withDefaults(fromState), toState: withDefaults(toState) };
            }
            return operation;
          });
          await transaction.table("transactions").put({ ...historyTransaction, operations });
        }

        // Runtime asset records carry the same new fields plus the derivative provenance list.
        const assets = await transaction.table("assets").toArray();
        for (const asset of assets) {
          // A pre-v9 "copied" locator pointed into the derived cache. Relabelling it as a
          // durable source would claim bytes that were never moved and may already have been
          // evicted, so the asset is held offline and v10 records the move as real work.
          const locator = asset.locator?.locatorType === "copied"
            ? { locatorType: "unavailable", fileName: asset.locator.fileName }
            : asset.locator;
          await transaction.table("assets").put({
            ...asset,
            schemaVersion: ASSET_SCHEMA_VERSION,
            reference: upgradeAsset(asset.reference),
            locator,
            editability: asset.editability ?? "editable",
            editabilityReason: asset.editabilityReason ?? null,
            derivatives: asset.derivatives ?? [],
            importPath: asset.importPath ?? null,
            binId: asset.binId ?? null,
          });
        }

        // Jobs written before intent was persisted keep their history but become honestly
        // non-retryable rather than claiming a retry that has no runner arguments.
        const jobs = await transaction.table("jobs").toArray();
        for (const job of jobs) {
          await transaction.table("jobs").put({
            ...job,
            schemaVersion: 2,
            priority: job.priority ?? "user",
            intent: job.intent ?? { kind: job.kind, payloadVersion: 1, payload: {} },
            targetIds: job.targetIds ?? [],
            sourceRevisionId: job.sourceRevisionId ?? null,
            derivativeIds: job.derivativeIds ?? [],
            retryable: false,
            cancelRequested: false,
            ranInWorker: false,
            status: job.status === "queued" || job.status === "running" ? "interrupted" : job.status,
          });
        }
      });

    this.version(10)
      .stores({
        // `*projectIds` is a multi-entry index: original bytes belong to the set of projects
        // referencing them, so Duplicate shares them and deleting one copy cannot strand
        // the other.
        sourceIndex: "key, assetId, projectId, state, sourceRevision, [projectId+state], *projectIds",
        sourceIntents: "id, assetId, projectId, state, createdAt",
        sourceMigrations: "assetId, projectId, state, createdAt",
        // A runtime asset record belongs to one project, not to one asset. Duplicate and
        // Save As share the same immutable original but keep separate availability, locator,
        // and derivative state, so a relink in one copy cannot silently rewrite the other.
        //
        // IndexedDB cannot change a table's primary key, so this is a new table rather than
        // a reshaped `assets`. The old one is copied here and dropped in v11.
        assetRecords: "[projectId+id], id, projectId, availability, updatedAt, [projectId+availability]",
      })
      .upgrade(async (transaction) => {
        // Move every runtime asset record into the per-project table.
        const legacyAssets = await transaction.table("assets").toArray();
        if (legacyAssets.length) await transaction.table("assetRecords").bulkPut(legacyAssets);

        // Existing source rows gain their reference list, seeded from the importing project.
        const sources = await transaction.table("sourceIndex").toArray();
        for (const source of sources) {
          if (Array.isArray(source.projectIds)) continue;
          await transaction.table("sourceIndex").put({ ...source, projectIds: [source.projectId] });
        }

        const known = new Set(sources.map((source) => source.key as string));
        const now = Date.now();

        // Two kinds of asset need their original moved into the source store: one still
        // carrying a pre-v9 `copied` locator, and one that v9 relabelled as `opfs-copy`
        // without ever writing the bytes or an index row. Both are recorded as pending work
        // and held offline until the bytes are copied and read back.
        for (const asset of legacyAssets) {
          const locator = asset.locator ?? null;
          const legacyKey: string | null =
            locator?.locatorType === "copied"
              ? (locator.cacheKey as string)
              : locator?.locatorType === "opfs-copy" && !known.has(locator.sourceKey as string)
                ? (locator.sourceKey as string)
                : null;
          if (!legacyKey) continue;

          const revision = (asset.reference?.sourceRevision as number | undefined) ?? 1;
          const targetKey = `src_${String(asset.id).replace(/[^a-z0-9_-]/gi, "").slice(0, 64)}_r${revision}`;
          const existing = await transaction.table("sourceMigrations").get(asset.id);
          if (!existing) {
            await transaction.table("sourceMigrations").put({
              assetId: asset.id,
              projectId: asset.projectId,
              legacyCacheKey: legacyKey,
              targetKey,
              fileName: locator.fileName ?? asset.reference?.name ?? "source",
              mediaType: asset.reference?.mediaType ?? "application/octet-stream",
              byteSize: asset.reference?.byteSize ?? 0,
              sourceRevision: revision,
              state: "pending",
              reason: null,
              createdAt: now,
            });
          }
          await transaction.table("assetRecords").put({
            ...asset,
            locator: { locatorType: "unavailable", fileName: locator.fileName ?? asset.reference?.name ?? "source" },
            availability: "missing",
            availabilityReason:
              "This file is being moved out of an older storage layout. Estro will finish the move when the project opens.",
          });
        }
      });

    // The pre-v10 asset table has been copied into `assetRecords` and is dropped separately,
    // because a version that deletes a table cannot also read it during its own upgrade.
    this.version(11).stores({ assets: null });

    // Presets, templates, and copied attribute bundles share one store. `projectId` is null
    // for anything available everywhere, which is how built-in templates are held.
    this.version(12).stores({
      presets: "id, domain, projectId, builtIn, name, updatedAt, [projectId+domain]",
    });

    this.version(13).stores({
      selections: "id, projectId, name, createdAt, [projectId+name]",
    });
  }
}

export const estroDatabase = new EstroDatabase();
