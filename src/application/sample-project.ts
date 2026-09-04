import type { AssetService } from "./asset-service";
import type { LayerService } from "./layer-service";
import type { ProjectService } from "./project-service";
import { ProjectError, toProjectError } from "../domain/project-error";

/**
 * Builds a project that is ready to edit the moment it opens.
 *
 * Estro's first run was an empty hub, and a new project was an empty canvas. That is a real
 * problem for the thing Estro is for: an agent cannot open a file — browsers grant file
 * access only from a user gesture — so until somebody imported media by hand, half the
 * product could not be demonstrated at all. Anyone arriving without their own photographs
 * had nothing to look at and nothing to ask an agent to change.
 *
 * The picture is a photograph now, served from `public/sample/`. It used to be drawn here in
 * a canvas, which kept the bundle small and meant the sample could not arrive broken — but a
 * drawn gradient is a poor thing to learn white balance on, because none of the adjustments
 * behave the way they behave on real light.
 *
 * The drawing is still here as a fallback. If the photograph cannot be fetched — offline on
 * first run, a stripped deployment, a blocked request — the sample builds from the generated
 * scene instead of failing, which is the property the original design was protecting.
 *
 * Either way it goes in through `registerOne`, the same import path a person's own file
 * takes: validated, stored durably, read back, and probed. The sample exercises the real code
 * rather than a shortcut around it.
 */

export interface SampleProjectDeps {
  projects: ProjectService;
  assets: AssetService;
  layers: LayerService;
}

export interface SampleProjectResult {
  projectId: string;
  documentId: string | null;
  assetIds: string[];
  warnings: string[];
  summary: string;
}

const DOCUMENT_WIDTH_PX = 1600;
const DOCUMENT_HEIGHT_PX = 1000;

/** Named so the hub can offer to open the existing one instead of making a second. */
export const SAMPLE_PROJECT_NAME = "Estro sample";

export interface SampleDefinition {
  id: string;
  /** Becomes the project's name, the image layer's name, and the title drawn over it. */
  title: string;
  fileName: string;
  /** What this photograph is good for practising on. Shown beside it in the library. */
  blurb: string;
}

/**
 * Four photographs, chosen for what they are difficult about.
 *
 * One sample taught one lesson. A person learning what "temperature" means needs a picture
 * with a colour cast to correct; a person learning "contrast" needs a flat one. A single
 * green hillside answers neither question well, and a drawn gradient answers none of them,
 * because none of the adjustments behave on invented light the way they behave on real light.
 */
export const SAMPLE_PROJECTS: readonly SampleDefinition[] = [
  {
    id: "sindhudurg",
    title: "Sindhudurg",
    fileName: "sindhudurg.jpg",
    blurb: "Greens and a blue sky. Good for saturation and for seeing what temperature does.",
  },
  {
    id: "city",
    title: "City afternoon",
    fileName: "city.jpg",
    blurb: "A blue cast over a busy street. The one to practise white balance on.",
  },
  {
    id: "deer",
    title: "Deer at dawn",
    fileName: "deer.jpg",
    blurb: "Mist, low contrast, almost no colour. Good for exposure and for shadows.",
  },
  {
    id: "quarry",
    title: "Quarry harbour",
    fileName: "quarry.jpg",
    blurb: "Flat grey overcast with fine detail. Good for contrast and for sharpening.",
  },
] as const;

export const DEFAULT_SAMPLE_ID = SAMPLE_PROJECTS[0].id;

export function sampleById(id: string | undefined): SampleDefinition {
  return SAMPLE_PROJECTS.find((entry) => entry.id === id) ?? SAMPLE_PROJECTS[0];
}

/**
 * Fetches the sample photograph, or gives up quietly.
 *
 * Same-origin and only on request — nothing is fetched until somebody asks for the sample —
 * and a failure returns null rather than throwing, so the caller can fall back to the drawn
 * scene instead of leaving a person with no sample at all.
 */
async function loadSamplePhotograph(sample: SampleDefinition): Promise<File | null> {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL}sample/${sample.fileName}`);
    if (!response.ok) return null;
    const blob = await response.blob();
    if (blob.size === 0) return null;
    return new File([blob], sample.fileName, { type: "image/jpeg" });
  } catch {
    return null;
  }
}

export async function buildSampleProject(deps: SampleProjectDeps, sampleId?: string): Promise<SampleProjectResult> {
  const sample = sampleById(sampleId);
  try {
    if (typeof document === "undefined") {
      throw new ProjectError("CAPABILITY_UNAVAILABLE", "The sample project needs a browser to draw its pictures.");
    }
    const warnings: string[] = [];
    const project = await deps.projects.createProject({ name: await uniqueName(deps.projects, sample.title), kind: "photo" });

    const photograph = await loadSamplePhotograph(sample);
    if (!photograph) warnings.push(`The photograph for “${sample.title}” could not be loaded, so a drawn scene was used instead.`);
    const files = [photograph ?? await renderScene("estro-sample-scene.png", 1)];

    const assetIds: string[] = [];
    for (const file of files) {
      const outcome = await deps.assets.registerOne(project.id, { file });
      if (outcome.assetId) assetIds.push(outcome.assetId);
      else warnings.push(`“${file.name}” could not be imported into the sample.`);
    }
    if (assetIds.length === 0) {
      throw new ProjectError("UNEXPECTED_FAILURE", "The sample pictures could not be stored in this browser. Check that site storage is allowed.");
    }

    const created = await deps.projects.createPhotoDocument({
      projectId: project.id,
      widthPx: DOCUMENT_WIDTH_PX,
      heightPx: DOCUMENT_HEIGHT_PX,
      resolutionPpi: 72,
      orientation: "landscape",
      background: { type: "solid", color: "#101014" },
    });
    const documentId = created.headRevision.state.photoDocument?.id ?? null;

    await deps.layers.applyOperation(project.id, {
      operation: "add_image", assetId: assetIds[0], fit: "fill", name: sample.title,
    });
    await deps.layers.applyOperation(project.id, {
      operation: "add_text",
      content: sample.title,
      name: "Title",
      // Left to the service, which centres it and picks ink that reads on this background.
    });


    await deps.projects.saveProject(project.id);

    return {
      projectId: project.id,
      documentId,
      assetIds,
      warnings,
      summary: `Built “${project.name}”: a photograph placed in an image document with a title over it. Everything in it is an ordinary edit you can change or undo.`,
    };
  } catch (error) { throw toProjectError(error); }
}

/** "Estro sample", then "Estro sample 2", so loading it twice does not collide on the name. */
async function uniqueName(projects: ProjectService, base = SAMPLE_PROJECT_NAME): Promise<string> {
  const existing = await projects.listProjects().catch(() => []);
  const taken = new Set(existing.map((record: { name: string }) => record.name));
  if (!taken.has(base)) return base;
  for (let index = 2; index < 100; index += 1) {
    const candidate = `${base} ${index}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now()}`;
}

/**
 * Draws one frame of the sample scene and encodes it as a PNG.
 *
 * A photograph, not a test card: the point is that brightness, temperature, and saturation
 * visibly do something to it, and that a person can see whether an agent's edit was the one
 * they asked for. `variant` shifts the light rather than the composition, so the three
 * frames cut together.
 */
async function renderScene(name: string, variant: number): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = DOCUMENT_WIDTH_PX;
  canvas.height = DOCUMENT_HEIGHT_PX;
  const context = canvas.getContext("2d");
  if (!context) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser did not provide a 2D drawing context.");

  const width = canvas.width;
  const height = canvas.height;
  const horizon = height * 0.62;

  const palettes = [
    { sky: ["#1b2a4a", "#5c6f97", "#d9a37a"], sun: "#ffd9a0", sunY: 0.52, hills: ["#22304a", "#1a2438", "#131a29"], water: "#2a3a52" },
    { sky: ["#2f6fb5", "#79aede", "#cfe4f2"], sun: "#ffffff", sunY: 0.18, hills: ["#3d5a4a", "#2c4438", "#1d2f27"], water: "#3c6f8f" },
    { sky: ["#2a1c3a", "#7d3f5c", "#e8834f"], sun: "#ffb257", sunY: 0.58, hills: ["#3a2437", "#281a28", "#18101a"], water: "#4a2b3d" },
  ];
  const palette = palettes[variant % palettes.length];

  const sky = context.createLinearGradient(0, 0, 0, horizon);
  sky.addColorStop(0, palette.sky[0]);
  sky.addColorStop(0.6, palette.sky[1]);
  sky.addColorStop(1, palette.sky[2]);
  context.fillStyle = sky;
  context.fillRect(0, 0, width, horizon);

  // The sun, with a soft falloff rather than a hard disc, so a highlight-recovery slider has
  // something real to recover.
  const sunX = width * 0.68;
  const sunY = horizon * palette.sunY;
  const glow = context.createRadialGradient(sunX, sunY, 0, sunX, sunY, width * 0.34);
  glow.addColorStop(0, palette.sun);
  glow.addColorStop(0.08, `${palette.sun}cc`);
  glow.addColorStop(1, `${palette.sun}00`);
  context.fillStyle = glow;
  context.fillRect(0, 0, width, horizon);

  // Three ridgelines, each darker and lower-contrast than the one behind it.
  palette.hills.forEach((colour, index) => {
    const base = horizon - (palette.hills.length - 1 - index) * height * 0.055;
    const amplitude = height * (0.05 + index * 0.02);
    const phase = index * 1.7 + variant * 0.4;
    context.fillStyle = colour;
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(0, base);
    for (let x = 0; x <= width; x += 8) {
      const t = x / width;
      const y = base
        - Math.sin(t * Math.PI * 1.6 + phase) * amplitude
        - Math.sin(t * Math.PI * 5.3 + phase * 2) * amplitude * 0.28;
      context.lineTo(x, y);
    }
    context.lineTo(width, height);
    context.closePath();
    context.fill();
  });

  // Water below the horizon, with the sun's reflection broken into bands.
  const water = context.createLinearGradient(0, horizon, 0, height);
  water.addColorStop(0, palette.hills[palette.hills.length - 1]);
  water.addColorStop(0.25, palette.water);
  water.addColorStop(1, "#0b0f16");
  context.fillStyle = water;
  context.fillRect(0, horizon, width, height - horizon);

  context.save();
  context.globalAlpha = 0.5;
  context.fillStyle = palette.sun;
  for (let y = horizon; y < height; y += 9) {
    const distance = (y - horizon) / (height - horizon);
    const spread = width * (0.02 + distance * 0.11);
    context.globalAlpha = 0.42 * (1 - distance) ** 1.6;
    context.fillRect(sunX - spread / 2, y, spread, 3);
  }
  context.restore();

  // A little grain, so a noise-reduction or sharpen pass is not acting on a perfectly clean
  // synthetic image and appearing to do nothing.
  const grain = context.getImageData(0, 0, width, height);
  for (let index = 0; index < grain.data.length; index += 4) {
    const noise = (Math.random() - 0.5) * 9;
    grain.data[index] = clampChannel(grain.data[index] + noise);
    grain.data[index + 1] = clampChannel(grain.data[index + 1] + noise);
    grain.data[index + 2] = clampChannel(grain.data[index + 2] + noise);
  }
  context.putImageData(grain, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new ProjectError("CAPABILITY_UNAVAILABLE", "This browser could not encode the sample picture.");
  return new File([blob], name, { type: "image/png" });
}

function clampChannel(value: number): number {
  return value < 0 ? 0 : value > 255 ? 255 : value;
}
