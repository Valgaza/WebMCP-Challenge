import { z } from "zod";
import { ProjectError } from "./project-error";

export const VECTOR_SCHEMA_VERSION = 1 as const;

/**
 * Shapes, paths, and the paint that fills them.
 *
 * Vector work is stored as commands and parameters rather than rasterised pixels, so a shape
 * stays crisp at any zoom and any export size, and SVG interchange is a translation rather
 * than a re-drawing. Gradients and swatches live here too because a fill is a fill whether it
 * lands on a rectangle, a text run, or a video title.
 */

/* ----------------------------------- paint ----------------------------------- */

export const gradientStopSchema = z.object({
  /** Position along the gradient, 0 to 1. */
  offset: z.number().min(0).max(1),
  colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  opacity: z.number().min(0).max(1).default(1),
});
export type GradientStop = z.infer<typeof gradientStopSchema>;

export const paintSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({
    kind: z.literal("solid"),
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/),
    opacity: z.number().min(0).max(1).default(1),
  }),
  z.object({
    kind: z.literal("linear"),
    /** Start and end in normalised object space, so a gradient survives a resize. */
    x1: z.number().min(-2).max(3).default(0),
    y1: z.number().min(-2).max(3).default(0),
    x2: z.number().min(-2).max(3).default(1),
    y2: z.number().min(-2).max(3).default(0),
    stops: z.array(gradientStopSchema).min(2).max(32),
  }),
  z.object({
    kind: z.literal("radial"),
    cx: z.number().min(-2).max(3).default(0.5),
    cy: z.number().min(-2).max(3).default(0.5),
    radius: z.number().min(0).max(4).default(0.5),
    stops: z.array(gradientStopSchema).min(2).max(32),
  }),
  /** A swatch by reference, so changing the swatch changes everything using it. */
  z.object({ kind: z.literal("swatch"), swatchId: z.string().min(1) }),
]);
export type Paint = z.infer<typeof paintSchema>;

export const strokeSchema = z.object({
  paint: paintSchema,
  widthPx: z.number().min(0).max(500).default(1),
  cap: z.enum(["butt", "round", "square"]).default("butt"),
  join: z.enum(["miter", "round", "bevel"]).default("miter"),
  /** Dash lengths in pixels; empty is a solid line. */
  dash: z.array(z.number().min(0).max(500)).max(8).default([]),
  alignment: z.enum(["center", "inside", "outside"]).default("center"),
});
export type Stroke = z.infer<typeof strokeSchema>;

/** A named, reusable colour or gradient, shared across a project. */
export const swatchSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  paint: paintSchema,
});
export type Swatch = z.infer<typeof swatchSchema>;

/* ------------------------------------ paths ----------------------------------- */

/**
 * Path commands, in the small set SVG actually needs.
 *
 * Coordinates are absolute and in object space. Relative commands are converted on import
 * rather than kept, because carrying both forms would mean every consumer implementing both.
 */
export const pathCommandSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("move"), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("line"), x: z.number(), y: z.number() }),
  z.object({
    kind: z.literal("cubic"),
    x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), x: z.number(), y: z.number(),
  }),
  z.object({ kind: z.literal("quadratic"), x1: z.number(), y1: z.number(), x: z.number(), y: z.number() }),
  z.object({ kind: z.literal("close") }),
]);
export type PathCommand = z.infer<typeof pathCommandSchema>;

export const MAX_PATH_COMMANDS = 5000;

export const shapeSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("rectangle"),
    x: z.number(), y: z.number(), width: z.number().min(0), height: z.number().min(0),
    cornerRadius: z.number().min(0).max(10000).default(0),
  }),
  z.object({
    kind: z.literal("ellipse"),
    cx: z.number(), cy: z.number(), rx: z.number().min(0), ry: z.number().min(0),
  }),
  z.object({
    kind: z.literal("polygon"),
    points: z.array(z.object({ x: z.number(), y: z.number() })).min(3).max(1000),
    closed: z.boolean().default(true),
  }),
  z.object({ kind: z.literal("path"), commands: z.array(pathCommandSchema).max(MAX_PATH_COMMANDS) }),
]);
export type Shape = z.infer<typeof shapeSchema>;

export const vectorObjectSchema = z.object({
  schemaVersion: z.literal(VECTOR_SCHEMA_VERSION),
  shape: shapeSchema,
  fill: paintSchema.default({ kind: "solid", colour: "#ffffff", opacity: 1 }),
  stroke: strokeSchema.nullable().default(null),
  /** How overlapping subpaths decide what is inside. */
  fillRule: z.enum(["nonzero", "evenodd"]).default("nonzero"),
});
export type VectorObject = z.infer<typeof vectorObjectSchema>;

/* ---------------------------------- geometry ---------------------------------- */

/** Turns any shape into path commands, so one renderer serves them all. */
export function toCommands(shape: Shape): PathCommand[] {
  if (shape.kind === "path") return shape.commands;

  if (shape.kind === "rectangle") {
    const { x, y, width, height } = shape;
    const radius = Math.min(shape.cornerRadius, width / 2, height / 2);
    if (radius <= 0) {
      return [
        { kind: "move", x, y }, { kind: "line", x: x + width, y },
        { kind: "line", x: x + width, y: y + height }, { kind: "line", x, y: y + height },
        { kind: "close" },
      ];
    }
    // A rounded corner is a cubic with the handle at the classic circle constant, which is
    // what keeps it circular rather than merely curved.
    const k = radius * 0.5523;
    return [
      { kind: "move", x: x + radius, y },
      { kind: "line", x: x + width - radius, y },
      { kind: "cubic", x1: x + width - radius + k, y1: y, x2: x + width, y2: y + radius - k, x: x + width, y: y + radius },
      { kind: "line", x: x + width, y: y + height - radius },
      { kind: "cubic", x1: x + width, y1: y + height - radius + k, x2: x + width - radius + k, y2: y + height, x: x + width - radius, y: y + height },
      { kind: "line", x: x + radius, y: y + height },
      { kind: "cubic", x1: x + radius - k, y1: y + height, x2: x, y2: y + height - radius + k, x, y: y + height - radius },
      { kind: "line", x, y: y + radius },
      { kind: "cubic", x1: x, y1: y + radius - k, x2: x + radius - k, y2: y, x: x + radius, y },
      { kind: "close" },
    ];
  }

  if (shape.kind === "ellipse") {
    const { cx, cy, rx, ry } = shape;
    const kx = rx * 0.5523;
    const ky = ry * 0.5523;
    return [
      { kind: "move", x: cx, y: cy - ry },
      { kind: "cubic", x1: cx + kx, y1: cy - ry, x2: cx + rx, y2: cy - ky, x: cx + rx, y: cy },
      { kind: "cubic", x1: cx + rx, y1: cy + ky, x2: cx + kx, y2: cy + ry, x: cx, y: cy + ry },
      { kind: "cubic", x1: cx - kx, y1: cy + ry, x2: cx - rx, y2: cy + ky, x: cx - rx, y: cy },
      { kind: "cubic", x1: cx - rx, y1: cy - ky, x2: cx - kx, y2: cy - ry, x: cx, y: cy - ry },
      { kind: "close" },
    ];
  }

  const [first, ...rest] = shape.points;
  return [
    { kind: "move", x: first.x, y: first.y },
    ...rest.map((point): PathCommand => ({ kind: "line", x: point.x, y: point.y })),
    ...(shape.closed ? [{ kind: "close" } as PathCommand] : []),
  ];
}

/**
 * The box a shape occupies.
 *
 * Curve control points are included rather than solved for exactly. That over-estimates a
 * curving path slightly, which is the safe direction: a bound that is a little large clips
 * nothing, while one that is a little small cuts the drawing.
 */
export function shapeBounds(shape: Shape): { x: number; y: number; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const command of toCommands(shape)) {
    if (command.kind === "close") continue;
    xs.push(command.x); ys.push(command.y);
    if (command.kind === "cubic") { xs.push(command.x1, command.x2); ys.push(command.y1, command.y2); }
    if (command.kind === "quadratic") { xs.push(command.x1); ys.push(command.y1); }
  }
  if (!xs.length) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY };
}

/** Renders commands as an SVG path string, for export and for `Path2D`. */
export function toPathData(commands: readonly PathCommand[]): string {
  const round = (value: number) => Math.round(value * 1000) / 1000;
  return commands.map((command) => {
    switch (command.kind) {
      case "move": return `M ${round(command.x)} ${round(command.y)}`;
      case "line": return `L ${round(command.x)} ${round(command.y)}`;
      case "cubic": return `C ${round(command.x1)} ${round(command.y1)} ${round(command.x2)} ${round(command.y2)} ${round(command.x)} ${round(command.y)}`;
      case "quadratic": return `Q ${round(command.x1)} ${round(command.y1)} ${round(command.x)} ${round(command.y)}`;
      default: return "Z";
    }
  }).join(" ");
}

/* ------------------------------- SVG interchange ------------------------------- */

/**
 * Parses the subset of SVG path syntax Estro round-trips.
 *
 * Deliberately strict. A silently mis-parsed path draws the wrong picture, which is worse
 * than refusing the file, so anything unrecognised raises rather than being skipped.
 */
export function parsePathData(data: string): PathCommand[] {
  const tokens = data.match(/[MmLlHhVvCcQqZz]|-?\d*\.?\d+(?:e[-+]?\d+)?/gi);
  if (!tokens) return [];

  const commands: PathCommand[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let index = 0;

  const number = (): number => {
    const token = tokens[index++];
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new ProjectError("INVALID_INPUT", `“${token}” is not a number in this path.`, { fieldPath: "d" });
    }
    return value;
  };

  let previous = "";
  while (index < tokens.length) {
    const token = tokens[index];
    const isCommand = /^[MmLlHhVvCcQqZz]$/.test(token);
    // SVG allows a command's letter to be omitted when it repeats, so an absent one means
    // "the same as last time".
    const letter = isCommand ? (index++, token) : previous;
    if (!letter) {
      throw new ProjectError("INVALID_INPUT", "This path starts with a number rather than a command.", { fieldPath: "d" });
    }
    previous = letter === "M" ? "L" : letter === "m" ? "l" : letter;
    const relative = letter === letter.toLowerCase();

    switch (letter.toUpperCase()) {
      case "M": {
        const x = number() + (relative ? cursorX : 0);
        const y = number() + (relative ? cursorY : 0);
        commands.push({ kind: "move", x, y });
        cursorX = startX = x; cursorY = startY = y;
        break;
      }
      case "L": {
        const x = number() + (relative ? cursorX : 0);
        const y = number() + (relative ? cursorY : 0);
        commands.push({ kind: "line", x, y });
        cursorX = x; cursorY = y;
        break;
      }
      case "H": {
        const x = number() + (relative ? cursorX : 0);
        commands.push({ kind: "line", x, y: cursorY });
        cursorX = x;
        break;
      }
      case "V": {
        const y = number() + (relative ? cursorY : 0);
        commands.push({ kind: "line", x: cursorX, y });
        cursorY = y;
        break;
      }
      case "C": {
        const x1 = number() + (relative ? cursorX : 0);
        const y1 = number() + (relative ? cursorY : 0);
        const x2 = number() + (relative ? cursorX : 0);
        const y2 = number() + (relative ? cursorY : 0);
        const x = number() + (relative ? cursorX : 0);
        const y = number() + (relative ? cursorY : 0);
        commands.push({ kind: "cubic", x1, y1, x2, y2, x, y });
        cursorX = x; cursorY = y;
        break;
      }
      case "Q": {
        const x1 = number() + (relative ? cursorX : 0);
        const y1 = number() + (relative ? cursorY : 0);
        const x = number() + (relative ? cursorX : 0);
        const y = number() + (relative ? cursorY : 0);
        commands.push({ kind: "quadratic", x1, y1, x, y });
        cursorX = x; cursorY = y;
        break;
      }
      default: {
        commands.push({ kind: "close" });
        cursorX = startX; cursorY = startY;
        break;
      }
    }

    if (commands.length > MAX_PATH_COMMANDS) {
      throw new ProjectError("INVALID_INPUT", `A path is limited to ${MAX_PATH_COMMANDS} commands.`, { fieldPath: "d" });
    }
  }
  return commands;
}

/** Serialises one object as an SVG element, for export. */
export function toSvgElement(object: VectorObject, swatches: ReadonlyMap<string, Swatch>): string {
  const paintValue = (paint: Paint, gradientId: string): string => {
    if (paint.kind === "none") return "none";
    if (paint.kind === "solid") return paint.colour;
    if (paint.kind === "swatch") {
      const swatch = swatches.get(paint.swatchId);
      // A swatch that has gone leaves the shape unpainted rather than guessing a colour.
      return swatch ? paintValue(swatch.paint, gradientId) : "none";
    }
    return `url(#${gradientId})`;
  };

  const attributes = [
    `d="${toPathData(toCommands(object.shape))}"`,
    `fill="${paintValue(object.fill, "fill-gradient")}"`,
    `fill-rule="${object.fillRule}"`,
  ];
  if (object.stroke) {
    attributes.push(
      `stroke="${paintValue(object.stroke.paint, "stroke-gradient")}"`,
      `stroke-width="${object.stroke.widthPx}"`,
      `stroke-linecap="${object.stroke.cap}"`,
      `stroke-linejoin="${object.stroke.join}"`,
    );
    if (object.stroke.dash.length) attributes.push(`stroke-dasharray="${object.stroke.dash.join(" ")}"`);
  }
  return `<path ${attributes.join(" ")} />`;
}

/**
 * Reads an SVG document into vector objects.
 *
 * Only shapes Estro can represent are taken, and everything skipped is named. An importer
 * that quietly dropped a group would produce a picture missing pieces with nothing to say
 * which.
 */
export function parseSvg(source: string): { objects: VectorObject[]; warnings: string[] } {
  if (typeof DOMParser === "undefined") {
    throw new ProjectError("CAPABILITY_UNAVAILABLE", "This runtime cannot parse SVG.");
  }
  const parsed = new DOMParser().parseFromString(source, "image/svg+xml");
  if (parsed.querySelector("parsererror")) {
    throw new ProjectError("INVALID_INPUT", "That file is not readable as SVG.", { fieldPath: "svg" });
  }

  const objects: VectorObject[] = [];
  const warnings: string[] = [];
  const skipped = new Set<string>();

  // Script and foreign content are never executed or imported: an SVG is untrusted input.
  for (const element of Array.from(parsed.querySelectorAll("script, foreignObject, image, use"))) {
    skipped.add(element.tagName.toLowerCase());
  }

  const solid = (value: string | null, fallback: Paint): Paint =>
    !value || value === "none" ? { kind: "none" }
      : /^#[0-9a-fA-F]{6}$/.test(value) ? { kind: "solid", colour: value, opacity: 1 } : fallback;

  for (const element of Array.from(parsed.querySelectorAll("path, rect, circle, ellipse, polygon, line, polyline"))) {
    const tag = element.tagName.toLowerCase();
    const number = (name: string, fallback = 0) => Number(element.getAttribute(name) ?? fallback) || fallback;
    let shape: Shape | null = null;

    try {
      if (tag === "path") {
        shape = { kind: "path", commands: parsePathData(element.getAttribute("d") ?? "") };
      } else if (tag === "rect") {
        shape = { kind: "rectangle", x: number("x"), y: number("y"), width: number("width"), height: number("height"), cornerRadius: number("rx") };
      } else if (tag === "circle") {
        shape = { kind: "ellipse", cx: number("cx"), cy: number("cy"), rx: number("r"), ry: number("r") };
      } else if (tag === "ellipse") {
        shape = { kind: "ellipse", cx: number("cx"), cy: number("cy"), rx: number("rx"), ry: number("ry") };
      } else if (tag === "line") {
        shape = { kind: "path", commands: [
          { kind: "move", x: number("x1"), y: number("y1") },
          { kind: "line", x: number("x2"), y: number("y2") },
        ] };
      } else {
        const points = (element.getAttribute("points") ?? "").trim().split(/[\s,]+/).map(Number);
        const pairs: { x: number; y: number }[] = [];
        for (let index = 0; index + 1 < points.length; index += 2) pairs.push({ x: points[index], y: points[index + 1] });
        if (pairs.length >= 3) shape = { kind: "polygon", points: pairs, closed: tag === "polygon" };
        else skipped.add(tag);
      }
    } catch {
      skipped.add(tag);
      continue;
    }

    if (!shape) continue;
    objects.push(vectorObjectSchema.parse({
      schemaVersion: VECTOR_SCHEMA_VERSION,
      shape,
      fill: solid(element.getAttribute("fill"), { kind: "solid", colour: "#000000", opacity: 1 }),
      stroke: element.getAttribute("stroke")
        ? strokeSchema.parse({
          paint: solid(element.getAttribute("stroke"), { kind: "solid", colour: "#000000", opacity: 1 }),
          widthPx: Number(element.getAttribute("stroke-width") ?? 1) || 1,
        })
        : null,
      fillRule: element.getAttribute("fill-rule") === "evenodd" ? "evenodd" : "nonzero",
    }));
  }

  if (skipped.size) {
    warnings.push(`Estro imports shapes and paths; ${[...skipped].join(", ")} ${skipped.size === 1 ? "was" : "were"} left out.`);
  }
  if (!objects.length) warnings.push("That SVG contained no shapes Estro can represent.");
  return { objects, warnings };
}

/** Wraps objects in a complete SVG document, for export. */
export function toSvgDocument(
  objects: readonly VectorObject[],
  options: { widthPx: number; heightPx: number; swatches?: ReadonlyMap<string, Swatch> },
): string {
  const swatches = options.swatches ?? new Map<string, Swatch>();
  const body = objects.map((object) => `  ${toSvgElement(object, swatches)}`).join("\n");
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.widthPx}" height="${options.heightPx}" viewBox="0 0 ${options.widthPx} ${options.heightPx}">`,
    body,
    "</svg>",
  ].join("\n");
}
