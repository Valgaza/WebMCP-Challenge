import type { EstroDatabase } from "../data/estro-database";
import { ProjectError, toProjectError } from "../domain/project-error";
import {
  ATTRIBUTES_BY_DOMAIN, BUILT_IN_TEMPLATES, PRESET_SCHEMA_VERSION,
  assertBatchSize, attributeBundleSchema, attributesIn, describeBundle, narrowToDomain,
  planBatch, presetRecordSchema,
  type AttributeBundle, type AttributeName, type BatchFailurePolicy, type BatchItemResult,
  type BatchPlan, type PresetDomain, type PresetRecord,
} from "../domain/preset";
import type { ProjectCommandContext, ProjectMutationResult, ProjectService } from "./project-service";

/**
 * How a target is read and written.
 *
 * Layers live in a photo document, clips and tracks live in a sequence, and each is edited
 * through its own service. Rather than teach this service about all of them, each registers
 * how to find a target and how to apply a bundle to it. That keeps one batch, one paste, and
 * one preset path serving every kind of object, which is the point of Phase 6.
 */
export interface AttributeTargetAdapter {
  domain: PresetDomain;
  /** Reads the current attributes of one target, or null when it no longer exists. */
  read: (projectId: string, targetId: string) => Promise<AttributeBundle | null>;
  /**
   * Applies a narrowed bundle to many targets in one transaction.
   *
   * Batched rather than per-target because one user intent must be one Undo step; applying
   * forty clips as forty transactions would take forty presses to undo.
   */
  applyMany: (
    projectId: string,
    targetIds: readonly string[],
    attributes: AttributeBundle,
    context: ProjectCommandContext,
    label: string,
  ) => Promise<ProjectMutationResult>;
}

export interface PresetServiceOptions {
  now?: () => Date;
  createPresetId?: () => string;
}

export interface PasteResult extends ProjectMutationResult {
  plan: BatchPlan;
}

/**
 * Owns everything reusable: copied attributes, saved presets, project templates, and batch
 * application. All four are the same operation with different names on the front.
 */
export class PresetService {
  private readonly now: () => Date;
  private readonly createPresetId: () => string;
  private readonly adapters = new Map<PresetDomain, AttributeTargetAdapter>();
  /** The most recent copy, held for paste. Deliberately in memory: a clipboard is not a document. */
  private clipboard: { attributes: AttributeBundle; domain: PresetDomain; sourceId: string } | null = null;
  private seeded = false;

  constructor(
    private readonly database: EstroDatabase,
    private readonly projects: ProjectService,
    options: PresetServiceOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
    this.createPresetId = options.createPresetId ?? (() => crypto.randomUUID());
  }

  registerAdapter(adapter: AttributeTargetAdapter): void {
    this.adapters.set(adapter.domain, adapter);
  }

  private adapterFor(domain: PresetDomain): AttributeTargetAdapter {
    // A brush preset is not applied to anything in the document: it describes a tool, and it
    // is used by painting with it. Saying so is more useful than "no adapter", which would
    // read as a gap rather than as the answer.
    // Some presets describe a tool or a setting rather than something in the document. Saying
    // what to do instead is more useful than "no adapter", which would read as a gap.
    const notAnObject: Partial<Record<PresetDomain, string>> = {
      brush: "A brush preset describes a tool rather than something in the document. Read it with list_presets and paint with its settings.",
    };
    const explanation = notAnObject[domain];
    if (explanation) throw new ProjectError("INVALID_INPUT", explanation, { fieldPath: "domain" });
    const adapter = this.adapters.get(domain);
    if (!adapter) {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", `Estro cannot apply attributes to a ${domain} yet.`, { fieldPath: "domain" });
    }
    return adapter;
  }

  /** Writes the built-in templates once, so listing them needs no special case. */
  async hydrate(): Promise<{ seededTemplates: number }> {
    if (this.seeded) return { seededTemplates: 0 };
    this.seeded = true;
    const timestamp = this.now().toISOString();
    let seeded = 0;
    for (const template of BUILT_IN_TEMPLATES) {
      const existing = await this.database.presets.get(template.id).catch(() => undefined);
      if (existing) continue;
      await this.database.presets.put(presetRecordSchema.parse({ ...template, createdAt: timestamp, updatedAt: timestamp }));
      seeded += 1;
    }
    return { seededTemplates: seeded };
  }

  /* -------------------------------- presets -------------------------------- */

  async listPresets(input: { projectId?: string; domain?: PresetDomain } = {}): Promise<PresetRecord[]> {
    await this.hydrate();
    const all = await this.database.presets.toArray();
    return all
      .filter((preset) => preset.projectId === null || preset.projectId === input.projectId)
      .filter((preset) => !input.domain || preset.domain === input.domain)
      .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
  }

  async getPreset(presetId: string): Promise<PresetRecord> {
    await this.hydrate();
    const preset = await this.database.presets.get(presetId);
    if (!preset) throw new ProjectError("HISTORY_NOT_AVAILABLE", "That preset is not available in this browser.", { fieldPath: "presetId" });
    return preset;
  }

  /**
   * Saves a bundle under a name, or updates one that already exists.
   *
   * Saving over an existing preset bumps its version rather than replacing it silently, so an
   * object that recorded which version it used can still say the preset has moved on.
   */
  async savePreset(input: {
    name: string;
    domain: PresetDomain;
    attributes: AttributeBundle;
    description?: string | null;
    projectId?: string | null;
    presetId?: string;
  }): Promise<PresetRecord> {
    try {
      const attributes = attributeBundleSchema.parse(input.attributes);
      if (!attributesIn(attributes).length) {
        throw new ProjectError("INVALID_INPUT", "A preset needs at least one attribute to be worth saving.", { fieldPath: "attributes" });
      }
      const timestamp = this.now().toISOString();
      const existing = input.presetId ? await this.database.presets.get(input.presetId) : undefined;
      if (existing?.builtIn) {
        throw new ProjectError("INVALID_INPUT", `“${existing.name}” ships with Estro and cannot be overwritten. Save it under a new name instead.`, { fieldPath: "presetId" });
      }

      const record = presetRecordSchema.parse({
        id: existing?.id ?? this.createPresetId(),
        schemaVersion: PRESET_SCHEMA_VERSION,
        name: input.name,
        description: input.description ?? existing?.description ?? null,
        domain: input.domain,
        version: existing ? existing.version + 1 : 1,
        attributes,
        builtIn: false,
        projectId: input.projectId ?? null,
        createdAt: existing?.createdAt ?? timestamp,
        updatedAt: timestamp,
      });
      await this.database.presets.put(record);
      return record;
    } catch (error) { throw toProjectError(error); }
  }

  async deletePreset(presetId: string): Promise<void> {
    const preset = await this.getPreset(presetId);
    if (preset.builtIn) {
      throw new ProjectError("INVALID_INPUT", `“${preset.name}” ships with Estro and cannot be deleted.`, { fieldPath: "presetId" });
    }
    await this.database.presets.delete(presetId);
  }

  /* ----------------------------- copy and paste ---------------------------- */

  /**
   * Reads a target's attributes into the clipboard, optionally narrowed to a chosen set.
   *
   * Choosing which attributes to take is what makes paste useful: copying everything means a
   * paste can only ever produce a duplicate.
   */
  async copyAttributes(input: {
    projectId: string;
    domain: PresetDomain;
    targetId: string;
    attributes?: AttributeName[];
  }): Promise<{ attributes: AttributeBundle; names: AttributeName[]; summary: string }> {
    try {
      const adapter = this.adapterFor(input.domain);
      const read = await adapter.read(input.projectId, input.targetId);
      if (!read) throw new ProjectError("INVALID_INPUT", "That object is no longer in the project.", { fieldPath: "targetId" });

      const wanted = input.attributes?.length ? new Set(input.attributes) : null;
      const picked: Record<string, unknown> = {};
      for (const name of attributesIn(read)) {
        if (!wanted || wanted.has(name)) picked[name] = read[name];
      }
      const attributes = attributeBundleSchema.parse(picked);
      const names = attributesIn(attributes);
      if (!names.length) {
        throw new ProjectError("INVALID_INPUT", "That object has none of the requested attributes to copy.", { fieldPath: "attributes" });
      }

      this.clipboard = { attributes, domain: input.domain, sourceId: input.targetId };
      return { attributes, names, summary: `Copied ${describeBundle(attributes)}` };
    } catch (error) { throw toProjectError(error); }
  }

  peekClipboard(): { attributes: AttributeBundle; domain: PresetDomain; sourceId: string } | null {
    return this.clipboard;
  }

  /** Applies the clipboard, or an explicit bundle, to many targets as one transaction. */
  async pasteAttributes(input: {
    projectId: string;
    domain: PresetDomain;
    targetIds: string[];
    attributes?: AttributeBundle;
    policy?: BatchFailurePolicy;
    dryRun?: boolean;
    label?: string;
  }, context: ProjectCommandContext = {}): Promise<PasteResult | { plan: BatchPlan }> {
    try {
      const source = input.attributes ?? this.clipboard?.attributes;
      if (!source) throw new ProjectError("INVALID_INPUT", "Nothing has been copied yet.", { fieldPath: "attributes" });
      return await this.applyBundle({
        projectId: input.projectId, domain: input.domain, targetIds: input.targetIds,
        attributes: source, policy: input.policy ?? "all_or_nothing", dryRun: input.dryRun ?? false,
        label: input.label ?? `Paste ${describeBundle(source).replace(/\.$/, "")}`,
      }, context);
    } catch (error) { throw toProjectError(error); }
  }

  /** Applies a saved preset to many targets, recording which version was used. */
  async applyPreset(input: {
    projectId: string;
    presetId: string;
    targetIds: string[];
    policy?: BatchFailurePolicy;
    dryRun?: boolean;
  }, context: ProjectCommandContext = {}): Promise<(PasteResult | { plan: BatchPlan }) & { preset: PresetRecord }> {
    try {
      const preset = await this.getPreset(input.presetId);
      const result = await this.applyBundle({
        projectId: input.projectId, domain: preset.domain, targetIds: input.targetIds,
        attributes: preset.attributes, policy: input.policy ?? "all_or_nothing",
        dryRun: input.dryRun ?? false,
        label: `Apply preset “${preset.name}” (v${preset.version})`,
      }, context);
      return { ...result, preset };
    } catch (error) { throw toProjectError(error); }
  }

  /* ------------------------------- batch work ------------------------------ */

  /**
   * The one path every reuse feature goes through.
   *
   * It always plans first: each target is read, the bundle is narrowed to what that target
   * accepts, and the result is costed before anything is written. A dry run stops there. A
   * real run then applies the whole batch in a single transaction, so one intent is one Undo
   * step regardless of how many objects it touched.
   */
  async applyBundle(input: {
    projectId: string;
    domain: PresetDomain;
    targetIds: string[];
    attributes: AttributeBundle;
    policy: BatchFailurePolicy;
    dryRun: boolean;
    label: string;
  }, context: ProjectCommandContext = {}): Promise<PasteResult | { plan: BatchPlan }> {
    try {
      assertBatchSize(input.targetIds.length);
      const adapter = this.adapterFor(input.domain);
      const attributes = attributeBundleSchema.parse(input.attributes);

      const items: BatchItemResult[] = [];
      for (const targetId of input.targetIds) {
        const current = await adapter.read(input.projectId, targetId).catch(() => null);
        if (!current) {
          items.push({ targetId, domain: input.domain, applied: false, changed: [], ignored: [], reason: "This object is no longer in the project." });
          continue;
        }
        const { accepted, ignored } = narrowToDomain(attributes, input.domain);
        // An attribute that already holds the intended value is not a change, and saying so
        // keeps the count honest rather than reporting work that did nothing.
        const changed = accepted.filter((name) => JSON.stringify(current[name]) !== JSON.stringify(attributes[name]));
        items.push({
          targetId, domain: input.domain,
          applied: changed.length > 0,
          changed, ignored,
          reason: changed.length ? null
            : accepted.length ? "Already set to these values."
              : `A ${input.domain} does not take ${describeBundle(attributes).replace(/\.$/, "")}.`,
        });
      }

      const plan = planBatch(items, input.policy);
      if (input.dryRun || !plan.canRun) {
        if (!input.dryRun && !plan.canRun) {
          throw new ProjectError("INVALID_INPUT", plan.blockedReason ?? "This batch cannot run.", { fieldPath: "targetIds" });
        }
        return { plan };
      }

      const { applied } = narrowToDomain(attributes, input.domain);
      const targets = plan.items.filter((item) => item.applied).map((item) => item.targetId);
      const label = targets.length === 1 ? input.label : `${input.label} on ${targets.length} objects`;
      const result = await adapter.applyMany(input.projectId, targets, applied, context, label);
      return { ...result, plan };
    } catch (error) { throw toProjectError(error); }
  }

  /**
   * Copies one photograph's settings onto photographs in other projects.
   *
   * `applyBundle` already applies to many objects, but only within one project: it commits one
   * before/after state, and a project is what that state belongs to. Synchronising across
   * photographs therefore has to be many transactions, one per project, and this method is
   * honest about that — each project gets its own Undo step, because each project has its own
   * history and there is nowhere a single one could live.
   *
   * The failure policy still means what it means: `all_or_nothing` refuses to start unless
   * every photograph can take the settings, so nobody is left with half a set synchronised.
   */
  async syncAcrossProjects(input: {
    sourceProjectId: string;
    sourceLayerId: string;
    /** The photographs to bring into line, each named by project and layer. */
    targets: { projectId: string; layerId: string }[];
    /** Which attributes to copy; all of the layer's if left out. */
    attributes?: AttributeName[];
    policy?: BatchFailurePolicy;
    dryRun?: boolean;
  }, context: ProjectCommandContext = {}): Promise<{
    plan: BatchPlan;
    applied: { projectId: string; layerId: string; transactionId: string }[];
    failed: { projectId: string; layerId: string; reason: string }[];
    summary: string;
  }> {
    try {
      assertBatchSize(input.targets.length);
      const policy = input.policy ?? "all_or_nothing";
      const adapter = this.adapterFor("layer");

      const source = await adapter.read(input.sourceProjectId, input.sourceLayerId);
      if (!source) {
        throw new ProjectError("INVALID_INPUT", "That photograph is no longer in the project.", { fieldPath: "sourceLayerId" });
      }
      const wanted = input.attributes?.length ? new Set(input.attributes) : null;
      const bundle: Record<string, unknown> = {};
      for (const name of attributesIn(source)) {
        if (!wanted || wanted.has(name)) bundle[name] = source[name];
      }
      const attributes = attributeBundleSchema.parse(bundle);
      if (!attributesIn(attributes).length) {
        throw new ProjectError("INVALID_INPUT", "None of those attributes are on that photograph.", { fieldPath: "attributes" });
      }

      // Everything is checked before anything is written, so `all_or_nothing` can refuse
      // without having already changed some of the photographs.
      const items: BatchItemResult[] = [];
      for (const target of input.targets) {
        const current = await adapter.read(target.projectId, target.layerId).catch(() => null);
        items.push(current
          ? {
            targetId: target.layerId, domain: "layer", applied: true,
            changed: attributesIn(attributes), ignored: [], reason: null,
          }
          : {
            targetId: target.layerId, domain: "layer", applied: false,
            changed: [], ignored: [], reason: "That photograph is no longer in its project.",
          });
      }

      const plan = planBatch(items, policy);
      if (input.dryRun || !plan.canRun) {
        if (!input.dryRun && !plan.canRun) {
          throw new ProjectError("INVALID_INPUT", plan.blockedReason ?? "This batch cannot run.", { fieldPath: "targets" });
        }
        return { plan, applied: [], failed: [], summary: `${plan.items.filter((item) => item.applied).length} of ${input.targets.length} photographs would be brought into line.` };
      }

      const label = `Match settings from another photograph`;
      const applied: { projectId: string; layerId: string; transactionId: string }[] = [];
      const failed: { projectId: string; layerId: string; reason: string }[] = [];
      const runnable = new Set(plan.items.filter((item) => item.applied).map((item) => item.targetId));

      for (const target of input.targets) {
        if (!runnable.has(target.layerId)) continue;
        try {
          const result = await adapter.applyMany(target.projectId, [target.layerId], attributes, context, label);
          applied.push({ ...target, transactionId: result.transaction.id });
        } catch (error) {
          // A project that fails here has already been checked, so this is something that
          // changed underneath us. It is reported rather than swallowed, and under
          // `all_or_nothing` the ones already done are named so they can be undone.
          failed.push({ ...target, reason: toProjectError(error).message });
        }
      }

      const summary = failed.length
        ? `${applied.length} of ${input.targets.length} photographs brought into line; ${failed.length} could not be, and each successful one has its own Undo step.`
        : `${applied.length} photograph(s) brought into line with ${describeBundle(attributes).replace(/\.$/, "")}. Each has its own Undo step, because each project keeps its own history.`;
      return { plan, applied, failed, summary };
    } catch (error) { throw toProjectError(error); }
  }

  /* -------------------------------- templates ------------------------------ */

  /** The templates a new project can start from. */
  async listTemplates(): Promise<PresetRecord[]> {
    return this.listPresets({ domain: "project" });
  }

  /**
   * Creates a project and immediately gives it the shape a template describes.
   *
   * A template that only named a size would leave the user to type it in, so the document or
   * sequence is created here as part of the same intent.
   */
  async createProjectFromTemplate(input: {
    templateId: string;
    name: string;
  }, context: ProjectCommandContext = {}): Promise<{ projectId: string; template: PresetRecord; warnings: string[] }> {
    try {
      const template = await this.getPreset(input.templateId);
      if (template.domain !== "project") {
        throw new ProjectError("INVALID_INPUT", `“${template.name}” is not a project template.`, { fieldPath: "templateId" });
      }
      const attributes = template.attributes;
      const warnings: string[] = [];

      const project = await this.projects.createProject(
        { name: input.name, kind: "photo" },
        { ...context, intent: context.intent ?? `Start a project from “${template.name}”.` },
      );

      if (attributes.widthPx && attributes.heightPx) {
        await this.projects.createPhotoDocument({
          projectId: project.id,
          widthPx: attributes.widthPx,
          heightPx: attributes.heightPx,
          resolutionPpi: attributes.resolutionPpi ?? 72,
          orientation: attributes.widthPx === attributes.heightPx ? "square"
            : attributes.widthPx > attributes.heightPx ? "landscape" : "portrait",
          background: { type: "solid", color: "#ffffff" },
        }, context).catch((error) => {
          warnings.push(`The project was created but its document was not: ${toProjectError(error).message}`);
        });
      }

      return { projectId: project.id, template, warnings };
    } catch (error) { throw toProjectError(error); }
  }

  /** Which attributes a kind of object accepts, for interfaces that offer a choice. */
  attributesFor(domain: PresetDomain): AttributeName[] {
    return [...ATTRIBUTES_BY_DOMAIN[domain]];
  }
}
