import { z } from "zod";
import { adjustmentStackSchema } from "./adjustment";
import { brushDynamicsSchema, brushSchema } from "./brush";
import { effectContainerSchema } from "./effect";
import { layerCropSchema, layerTransformSchema } from "./layer";
import { rationalSchema } from "./time";
import { ProjectError } from "./project-error";

export const PRESET_SCHEMA_VERSION = 1 as const;

/**
 * One model behind four features.
 *
 * Copying attributes between two layers, saving a look to reuse tomorrow, starting a project
 * from a template, and applying the same change to forty clips at once are the same idea
 * wearing four hats: a named, versioned bundle of parameters, and a rule for putting it onto
 * targets. Building them separately is how a product ends up with a preset that a batch
 * operation cannot apply and a template that shares nothing with either.
 *
 * The bundle is deliberately partial. A preset that had to carry every attribute could only
 * be applied to an object identical to the one it came from; carrying only what was chosen
 * lets a colour look land on a clip that has nothing else in common with its source.
 */

/** What kind of object a bundle came from, and therefore where it can be applied. */
/**
 * The kinds of thing a preset can describe.
 *
 * `brush` joins the list rather than getting a store of its own: a brush preset is a named
 * bundle of settings that can be saved, listed, shared between projects, and applied — which
 * is exactly what every other preset is. A second mechanism for it would be the same code
 * written twice with one of the copies eventually falling behind.
 */
export const presetDomainSchema = z.enum(["layer", "document", "project", "brush", "effect_stack"]);
export type PresetDomain = z.infer<typeof presetDomainSchema>;

/**
 * The attributes Estro knows how to copy.
 *
 * Every field is optional: a bundle carries exactly what was selected and nothing else, so
 * pasting "just the colour" leaves position alone rather than silently resetting it.
 */
export const attributeBundleSchema = z.object({
  adjustments: adjustmentStackSchema.optional(),
  transform: layerTransformSchema.partial().optional(),
  crop: layerCropSchema.optional(),
  opacity: z.number().min(0).max(1).optional(),
  visible: z.boolean().optional(),
  enabled: z.boolean().optional(),
  /** Document settings, used by templates. */
  widthPx: z.number().int().min(1).max(32768).optional(),
  heightPx: z.number().int().min(1).max(32768).optional(),
  resolutionPpi: z.number().min(1).max(2400).optional(),
  /** A brush and how a pen drives it, saved together because neither is much use alone. */
  brush: brushSchema.optional(),
  dynamics: brushDynamicsSchema.optional(),
  /**
   * A whole ordered effect list, saved as one thing.
   *
   * The point of saving a *stack* rather than each effect is that a look is the combination:
   * a curve after a grain reads differently from a grain after a curve, and a preset that
   * lost the order would not reproduce it.
   */
  effects: effectContainerSchema.optional(),
});
export type AttributeBundle = z.infer<typeof attributeBundleSchema>;

/** Every attribute name a bundle may carry, for validation and plain-language summaries. */
export const ATTRIBUTE_NAMES = [
  "adjustments", "transform", "crop", "opacity", "visible", "enabled",
  "brush", "dynamics", "effects",
  "widthPx", "heightPx", "resolutionPpi",
] as const;
export type AttributeName = (typeof ATTRIBUTE_NAMES)[number];

/** Which attributes each kind of object will accept, so a paste can refuse honestly. */
export const ATTRIBUTES_BY_DOMAIN: Record<PresetDomain, AttributeName[]> = {
  layer: ["adjustments", "transform", "crop", "opacity", "visible"],
  document: ["widthPx", "heightPx", "resolutionPpi"],
  project: ["widthPx", "heightPx", "resolutionPpi"],
  brush: ["brush", "dynamics"],
  effect_stack: ["effects"],
};

export const presetRecordSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PRESET_SCHEMA_VERSION),
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).nullable().default(null),
  domain: presetDomainSchema,
  /**
   * Bumped whenever a preset's parameters change, so an object can record which version was
   * applied to it and a later edit to the preset is visible rather than silent.
   */
  version: z.number().int().min(1).default(1),
  attributes: attributeBundleSchema,
  /** Shipped with Estro rather than saved by the user; cannot be overwritten or deleted. */
  builtIn: z.boolean().default(false),
  /** Null for a preset available to every project. */
  projectId: z.string().min(1).nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type PresetRecord = z.infer<typeof presetRecordSchema>;

/** Which attribute names a bundle actually carries. */
export function attributesIn(bundle: AttributeBundle): AttributeName[] {
  return ATTRIBUTE_NAMES.filter((name) => bundle[name] !== undefined);
}

/**
 * Narrows a bundle to what a target will accept, and says what it dropped.
 *
 * Dropping silently is the failure worth avoiding: a user who pastes a look onto a track and
 * sees nothing happen deserves to know the track had no use for any of it, rather than
 * assuming the paste worked.
 */
export function narrowToDomain(
  bundle: AttributeBundle,
  domain: PresetDomain,
): { applied: AttributeBundle; accepted: AttributeName[]; ignored: AttributeName[] } {
  const allowed = new Set(ATTRIBUTES_BY_DOMAIN[domain]);
  const present = attributesIn(bundle);
  const accepted = present.filter((name) => allowed.has(name));
  const ignored = present.filter((name) => !allowed.has(name));
  const applied: Record<string, unknown> = {};
  for (const name of accepted) applied[name] = bundle[name];
  return { applied: applied as AttributeBundle, accepted, ignored };
}

/** A sentence describing what a bundle would do, for confirmations and agent summaries. */
export function describeBundle(bundle: AttributeBundle): string {
  const names = attributesIn(bundle);
  if (!names.length) return "No attributes.";
  const readable: Record<AttributeName, string> = {
    adjustments: "colour adjustments", transform: "position and scale", crop: "crop",
    opacity: "opacity", visible: "visibility", enabled: "enabled state",
    widthPx: "width", heightPx: "height", resolutionPpi: "resolution",
    brush: "brush settings", dynamics: "pen dynamics", effects: "an effect stack",
  };
  const listed = names.map((name) => readable[name]);
  if (listed.length === 1) return `${listed[0]}.`;
  return `${listed.slice(0, -1).join(", ")} and ${listed[listed.length - 1]}.`;
}

/* ---------------------------------- batch work --------------------------------- */

/**
 * What happens when one item in a batch fails.
 *
 * `all_or_nothing` is the safe default: forty clips either all change or none do, so a
 * half-applied batch never has to be untangled by hand. `best_effort` exists because a user
 * retouching a hundred photos would rather have ninety-seven succeed than lose the lot to one
 * missing file, and it reports precisely which three did not.
 */
export const batchFailurePolicySchema = z.enum(["all_or_nothing", "best_effort"]);
export type BatchFailurePolicy = z.infer<typeof batchFailurePolicySchema>;

export interface BatchItemResult {
  targetId: string;
  domain: PresetDomain;
  applied: boolean;
  /** Attributes that actually changed on this target. */
  changed: AttributeName[];
  ignored: AttributeName[];
  reason: string | null;
}

export interface BatchPlan {
  policy: BatchFailurePolicy;
  items: BatchItemResult[];
  applicableCount: number;
  blockedCount: number;
  /** True when the policy allows the batch to proceed as planned. */
  canRun: boolean;
  blockedReason: string | null;
  summary: string;
}

/** Builds the plan for a batch without performing any of it. */
export function planBatch(
  items: readonly BatchItemResult[],
  policy: BatchFailurePolicy,
): BatchPlan {
  const applicable = items.filter((item) => item.applied);
  const blocked = items.filter((item) => !item.applied);
  const canRun = applicable.length > 0 && (policy === "best_effort" || blocked.length === 0);

  // "Cannot take this attribute" and "already holds this value" are different facts and lead
  // to different next steps, so they are never collapsed into one message.
  const allUnchanged = blocked.length > 0 && blocked.every((item) => item.reason === "Already set to these values.");
  const blockedReason = !applicable.length
    ? allUnchanged
      ? "Every chosen target already holds these values, so there is nothing to change."
      : "None of the chosen targets can take these attributes."
    : policy === "all_or_nothing" && blocked.length
      ? `${blocked.length} of ${items.length} target(s) cannot take these attributes, and this batch is set to apply to all or none. Switch to best effort to change the rest.`
      : null;

  return {
    policy, items: [...items],
    applicableCount: applicable.length,
    blockedCount: blocked.length,
    canRun, blockedReason,
    summary: canRun
      ? `${applicable.length} of ${items.length} target(s) would change.`
      : `Nothing would change. ${blockedReason}`,
  };
}

export function assertBatchSize(count: number, maximum = 500): void {
  if (count < 1) {
    throw new ProjectError("INVALID_INPUT", "Choose at least one target for this batch.", { fieldPath: "targetIds" });
  }
  if (count > maximum) {
    throw new ProjectError("INVALID_INPUT", `A batch is limited to ${maximum} targets at once; ${count} were chosen.`, { fieldPath: "targetIds" });
  }
}

/* ---------------------------------- templates ---------------------------------- */

/**
 * The templates Estro ships with.
 *
 * They are ordinary presets in the `project` domain, so the same save, list, and apply path
 * serves a user's own template and a built-in one, and neither needs code the other does not.
 */
export const BUILT_IN_TEMPLATES: readonly Omit<PresetRecord, "createdAt" | "updatedAt">[] = [
  {
    id: "template_photo_web", schemaVersion: PRESET_SCHEMA_VERSION, name: "Web image — 1920 × 1080",
    description: "A landscape image document at screen resolution.", domain: "project", version: 1,
    attributes: { widthPx: 1920, heightPx: 1080, resolutionPpi: 72 },
    builtIn: true, projectId: null,
  },
  {
    id: "template_photo_print", schemaVersion: PRESET_SCHEMA_VERSION, name: "Print image — A4 at 300 ppi",
    description: "A portrait document sized for A4 printing.", domain: "project", version: 1,
    attributes: { widthPx: 2480, heightPx: 3508, resolutionPpi: 300 },
    builtIn: true, projectId: null,
  },
] as const;
