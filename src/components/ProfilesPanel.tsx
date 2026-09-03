import { RotateCcw } from "lucide-react";
import type { AppliedProfile, ColourProfile } from "../domain/colour-op";
import { COLOUR_OP_SCHEMA_VERSION } from "../domain/colour-op";

/**
 * The starting point a photograph is developed from, before any slider is touched.
 *
 * A camera profile interprets what the sensor recorded; a creative profile is a look. They are
 * the same shape and kept apart only so a photograph can have exactly one of the first and any
 * of the second over it — which is the order the two actually apply in.
 *
 * A profile's operations are copied onto the layer rather than referenced. A photograph
 * developed last month should not change because a profile was edited today: editing a profile
 * changes what new work starts from, not what old work already is.
 *
 * Strength exists because a look at full power is a filter, and a look at a third is a choice.
 */

interface ProfilesPanelProps {
  applied: readonly AppliedProfile[];
  disabled: boolean;
  agentTarget?: string | null;
  onApply: (profile: ColourProfile, strength: number) => void;
  onStrength: (profile: AppliedProfile, strength: number) => void;
  onRemove: (kind: "camera" | "creative") => void;
}

/** A levels channel that changes nothing, for the two of the four that are not being used. */
const NEUTRAL = { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 0, outWhite: 255 };

function profile(
  id: string, name: string, kind: "camera" | "creative", camera: string | null,
  operations: ColourProfile["operations"],
): ColourProfile {
  return { schemaVersion: COLOUR_OP_SCHEMA_VERSION, id, name, kind, camera, operations };
}

/**
 * Profiles named by what they do to a photograph rather than by a film stock nobody has held.
 *
 * Each is a real stack of colour operations, so what it does can be read in the effect list
 * afterwards — a look here is not a black box, it is a shortcut to edits the person could have
 * made themselves.
 */
const CAMERA_PROFILES: ColourProfile[] = [
  profile("camera-standard", "As the camera saw it", "camera", null, [
    { kind: "exposure", exposureEv: 0, offset: 0, gamma: 1 },
  ]),
  profile("camera-neutral", "Flat, for editing", "camera", null, [
    { kind: "exposure", exposureEv: 0, offset: 0, gamma: 1.08 },
    { kind: "vibrance", vibrance: -12, saturation: -6 },
  ]),
  profile("camera-punch", "Straight out of camera", "camera", null, [
    { kind: "exposure", exposureEv: 0.1, offset: 0, gamma: 0.96 },
    { kind: "vibrance", vibrance: 18, saturation: 4 },
  ]),
];

const CREATIVE_PROFILES: ColourProfile[] = [
  profile("look-warm-film", "Warm film", "creative", null, [
    {
      kind: "colour_balance",
      shadows: { red: 4, green: 0, blue: -6 },
      midtones: { red: 8, green: 2, blue: -8 },
      highlights: { red: 6, green: 2, blue: -4 },
      preserveLuminosity: true,
    },
    { kind: "vibrance", vibrance: 10, saturation: -4 },
  ]),
  profile("look-cold-morning", "Cold morning", "creative", null, [
    {
      kind: "colour_balance",
      shadows: { red: -8, green: -2, blue: 10 },
      midtones: { red: -5, green: 0, blue: 8 },
      highlights: { red: -2, green: 0, blue: 4 },
      preserveLuminosity: true,
    },
    { kind: "vibrance", vibrance: -6, saturation: 0 },
  ]),
  profile("look-faded", "Faded print", "creative", null, [
    {
      kind: "levels",
      // Lifting the black point is what a faded print physically is: nothing in it is truly black.
      rgb: { inBlack: 0, inWhite: 255, gamma: 1, outBlack: 22, outWhite: 238 },
      red: NEUTRAL, green: NEUTRAL, blue: NEUTRAL,
    },
    { kind: "vibrance", vibrance: -14, saturation: -8 },
  ]),
  profile("look-bleach", "Bleached", "creative", null, [
    { kind: "vibrance", vibrance: -30, saturation: -25 },
    {
      kind: "levels",
      rgb: { inBlack: 8, inWhite: 244, gamma: 0.92, outBlack: 0, outWhite: 255 },
      red: NEUTRAL, green: NEUTRAL, blue: NEUTRAL,
    },
  ]),
];

export function ProfilesPanel({ applied, disabled, agentTarget, onApply, onStrength, onRemove }: ProfilesPanelProps) {
  const camera = applied.find((entry) => entry.kind === "camera") ?? null;
  const creative = applied.find((entry) => entry.kind === "creative") ?? null;

  function group(
    heading: string, help: string, options: ColourProfile[],
    current: AppliedProfile | null, kind: "camera" | "creative",
  ) {
    return (
      <>
        <h3>{heading}</h3>
        <p className="field-help">{help}</p>
        <div className="tool-grid" role="group" aria-label={heading}>
          {options.map((option) => (
            <button
              key={option.id} type="button"
              className={current?.profileId === option.id ? "tool-chip tool-chip--on" : "tool-chip"}
              aria-pressed={current?.profileId === option.id}
              disabled={disabled}
              onClick={() => onApply(option, 1)}
            >
              {option.name}
            </button>
          ))}
        </div>

        {current ? (
          <>
            <label className="slider-field">
              <span title="A look at full power is a filter; a look at a third is a choice.">How much of it</span>
              <input
                type="range" min={0} max={100} step={1}
                value={Math.round(current.strength * 100)} disabled={disabled}
                onChange={(event) => onStrength(current, Number(event.target.value) / 100)}
              />
              <output>{Math.round(current.strength * 100)}%</output>
            </label>
            <div className="inspector-actions">
              <button className="button button--ghost" type="button" disabled={disabled} onClick={() => onRemove(kind)}>
                <RotateCcw aria-hidden="true" size={14} /> Take “{current.name}” off
              </button>
            </div>
          </>
        ) : null}
      </>
    );
  }

  return (
    <section
      data-semantic-id="inspector-profiles"
      data-agent-target={agentTarget === "inspector-profiles" ? "true" : undefined}
    >
      {group(
        "Starting point",
        "How the photograph is read before anything else happens. One of these, always.",
        CAMERA_PROFILES, camera, "camera",
      )}
      {group(
        "Look",
        "A stack of colour edits applied over the top. Everything it does shows up as ordinary edits you can read.",
        CREATIVE_PROFILES, creative, "creative",
      )}
    </section>
  );
}
