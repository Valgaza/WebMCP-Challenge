import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EstroDatabase } from "../data/estro-database";
import { ProjectRepository } from "../data/project-repository";
import { createDefaultAdjustments } from "../domain/adjustment";
import { DEFAULT_TRANSFORM } from "../domain/layer";
import { describeBundle, narrowToDomain, planBatch, type BatchItemResult } from "../domain/preset";
import { PresetService, type AttributeTargetAdapter } from "./preset-service";
import { ProjectService } from "./project-service";

/**
 * `SH-016`, `SH-017`, `SH-005`, and `SH-067` are one engine. These test the engine's own
 * decisions — what a target will accept, what counts as a change, and when a batch may
 * proceed — through a stub adapter, so the rules are checked without a document in the way.
 */
describe("the reuse engine", () => {
  let database: EstroDatabase;
  let projects: ProjectService;
  let presets: PresetService;
  let store: Map<string, Record<string, unknown>>;
  let applied: { targets: string[]; label: string }[];

  const stubAdapter = (): AttributeTargetAdapter => ({
    domain: "layer",
    read: async (_projectId, targetId) => (store.get(targetId) ?? null) as never,
    applyMany: async (_projectId, targetIds, attributes, _context, label) => {
      applied.push({ targets: [...targetIds], label });
      for (const id of targetIds) store.set(id, { ...store.get(id), ...attributes });
      return { transaction: { summary: label } } as never;
    },
  });

  beforeEach(() => {
    database = new EstroDatabase(`estro-preset-${crypto.randomUUID()}`);
    projects = new ProjectService(new ProjectRepository(database));
    presets = new PresetService(database, projects);
    presets.registerAdapter(stubAdapter());
    applied = [];
    store = new Map([
      ["layer-a", { opacity: 1, visible: true, transform: { ...DEFAULT_TRANSFORM }, adjustments: { ...createDefaultAdjustments(), brightness: 40 } }],
      ["layer-b", { opacity: 0.5, visible: true, transform: { ...DEFAULT_TRANSFORM }, adjustments: createDefaultAdjustments() }],
      ["layer-c", { opacity: 1, visible: false, transform: { ...DEFAULT_TRANSFORM }, adjustments: createDefaultAdjustments() }],
    ]);
  });

  afterEach(async () => database.delete());

  /* ------------------------------ the bundle model ----------------------------- */

  it("carries only the attributes that were chosen", async () => {
    const copied = await presets.copyAttributes({
      projectId: "p", domain: "layer", targetId: "layer-a", attributes: ["adjustments"],
    });
    expect(copied.names).toEqual(["adjustments"]);
    expect(copied.attributes.opacity).toBeUndefined();
    expect(copied.summary).toContain("colour adjustments");
  });

  it("narrows a bundle to what a target will accept and says what it dropped", () => {
    // A document takes its size; it has nothing to do with a layer's colour, so the
    // adjustments are dropped and named rather than silently applied to nothing.
    const result = narrowToDomain({ adjustments: createDefaultAdjustments(), widthPx: 1200 }, "document");
    expect(result.accepted).toEqual(["widthPx"]);
    expect(result.ignored).toEqual(["adjustments"]);
  });

  it("describes a bundle in words rather than field names", () => {
    expect(describeBundle({ adjustments: createDefaultAdjustments(), opacity: 0.5 }))
      .toBe("colour adjustments and opacity.");
  });

  /* -------------------------------- batch rules -------------------------------- */

  it("does not count an attribute that already holds the intended value as a change", async () => {
    const result = await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-a", "layer-b"],
      attributes: { opacity: 1 }, dryRun: true,
    });
    const plan = "plan" in result ? result.plan : null;
    // layer-a is already at 1; layer-b is at 0.5 and would change.
    expect(plan!.items.find((i) => i.targetId === "layer-a")!.applied).toBe(false);
    expect(plan!.items.find((i) => i.targetId === "layer-a")!.reason).toContain("Already set");
    expect(plan!.items.find((i) => i.targetId === "layer-b")!.changed).toEqual(["opacity"]);
  });

  it("changes nothing on a dry run", async () => {
    await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-b"], attributes: { opacity: 0.2 }, dryRun: true,
    });
    expect(applied).toEqual([]);
    expect(store.get("layer-b")!.opacity).toBe(0.5);
  });

  it("applies a whole batch as one transaction, not one per target", async () => {
    const result = await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-b", "layer-c"],
      attributes: { opacity: 0.25 }, policy: "best_effort",
    });
    expect(applied).toHaveLength(1);
    expect(applied[0].targets).toEqual(["layer-b", "layer-c"]);
    expect(applied[0].label).toContain("2 objects");
    expect(store.get("layer-b")!.opacity).toBe(0.25);
    expect("plan" in result && result.plan.applicableCount).toBe(2);
  });

  /**
   * The default is deliberately strict. Forty clips either all change or none do, so a
   * half-applied batch never has to be untangled by hand.
   */
  it("refuses an all-or-nothing batch when any target cannot take the change", async () => {
    await expect(presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-a", "layer-b"],
      attributes: { opacity: 1 }, policy: "all_or_nothing",
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    expect(applied).toEqual([]);
  });

  it("lets best effort proceed and reports exactly which targets were left out", async () => {
    const result = await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-a", "layer-b"],
      attributes: { opacity: 1 }, policy: "best_effort",
    });
    const plan = "plan" in result ? result.plan : null;
    expect(plan!.applicableCount).toBe(1);
    expect(plan!.blockedCount).toBe(1);
    expect(applied[0].targets).toEqual(["layer-b"]);
  });

  it("reports a target that has gone rather than failing the whole batch silently", async () => {
    const result = await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-b", "missing"],
      attributes: { opacity: 0.1 }, policy: "best_effort",
    });
    const plan = "plan" in result ? result.plan : null;
    expect(plan!.items.find((i) => i.targetId === "missing")!.reason).toContain("no longer in the project");
  });

  it("bounds a batch rather than accepting any number of targets", async () => {
    await expect(presets.pasteAttributes({ projectId: "p", domain: "layer", targetIds: [], attributes: { opacity: 1 } }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(presets.pasteAttributes({
      projectId: "p", domain: "layer",
      targetIds: Array.from({ length: 501 }, (_, i) => `layer-${i}`), attributes: { opacity: 1 },
    })).rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("plans a batch with no applicable target as unable to run", () => {
    const items: BatchItemResult[] = [
      { targetId: "a", domain: "layer", applied: false, changed: [], ignored: [], reason: "no" },
    ];
    const plan = planBatch(items, "best_effort");
    expect(plan.canRun).toBe(false);
    expect(plan.blockedReason).toContain("None of the chosen targets");
  });

  /* ---------------------------------- presets ---------------------------------- */

  it("saves a preset, bumps its version on re-save, and refuses an empty one", async () => {
    const saved = await presets.savePreset({ name: "Warm look", domain: "layer", attributes: { adjustments: createDefaultAdjustments() } });
    expect(saved.version).toBe(1);
    const again = await presets.savePreset({ presetId: saved.id, name: "Warm look", domain: "layer", attributes: { adjustments: { ...createDefaultAdjustments(), temperature: 20 } } });
    expect(again.version).toBe(2);
    expect(again.id).toBe(saved.id);
    expect(again.createdAt).toBe(saved.createdAt);

    await expect(presets.savePreset({ name: "Empty", domain: "layer", attributes: {} }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("applies a preset and records which version was used", async () => {
    const preset = await presets.savePreset({ name: "Half opacity", domain: "layer", attributes: { opacity: 0.5 } });
    const result = await presets.applyPreset({ projectId: "p", presetId: preset.id, targetIds: ["layer-a"] });
    expect(result.preset.version).toBe(1);
    expect(applied[0].label).toContain("v1");
  });

  it("protects the presets that ship with Estro", async () => {
    const templates = await presets.listTemplates();
    const builtIn = templates.find((entry) => entry.builtIn)!;
    await expect(presets.deletePreset(builtIn.id)).rejects.toMatchObject({ code: "INVALID_INPUT" });
    await expect(presets.savePreset({ presetId: builtIn.id, name: "Hijack", domain: "project", attributes: { widthPx: 10, heightPx: 10 } }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });

  it("keeps a project's own presets out of other projects", async () => {
    await presets.savePreset({ name: "Local only", domain: "layer", attributes: { opacity: 0.3 }, projectId: "project-1" });
    expect((await presets.listPresets({ projectId: "project-1", domain: "layer" })).map((p) => p.name)).toContain("Local only");
    expect((await presets.listPresets({ projectId: "project-2", domain: "layer" })).map((p) => p.name)).not.toContain("Local only");
  });

  /* --------------------------------- templates --------------------------------- */

  it("creates a photo project already shaped by its template", async () => {
    const templates = await presets.listTemplates();
    const print = templates.find((entry) => entry.name.includes("A4"))!;
    const created = await presets.createProjectFromTemplate({ templateId: print.id, name: "From template" });

    const history = await projects.getProjectHistory(created.projectId);
    expect(history.headRevision.state.kind).toBe("photo");
    expect(history.headRevision.state.photoDocument).toMatchObject({ widthPx: 2480, heightPx: 3508, orientation: "portrait" });
    expect(created.warnings).toEqual([]);
  });

  it("refuses to start a project from something that is not a project template", async () => {
    const look = await presets.savePreset({ name: "Look", domain: "layer", attributes: { opacity: 0.5 } });
    await expect(presets.createProjectFromTemplate({ templateId: look.id, name: "Wrong" }))
      .rejects.toMatchObject({ code: "INVALID_INPUT" });
  });
  it("says a batch is already applied rather than claiming the targets refused it", async () => {
    await presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-b"], attributes: { opacity: 0.25 }, policy: "best_effort",
    });
    // Running the same batch again has nothing to do, which is not the same as being refused.
    await expect(presets.pasteAttributes({
      projectId: "p", domain: "layer", targetIds: ["layer-b"], attributes: { opacity: 0.25 },
    })).rejects.toMatchObject({ message: expect.stringContaining("already holds these values") });
  });
});
