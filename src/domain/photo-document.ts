import { z } from "zod";

export const PHOTO_DOCUMENT_SCHEMA_VERSION = 1 as const;

export const documentOrientationSchema = z.enum(["landscape", "portrait", "square"]);
export type DocumentOrientation = z.infer<typeof documentOrientationSchema>;

export const documentBackgroundSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("transparent") }),
  z.object({
    type: z.literal("solid"),
    color: z.string().regex(/^#[0-9a-f]{6}$/i, "Enter a six-digit hexadecimal color such as #ffffff."),
  }),
]);
export type DocumentBackground = z.infer<typeof documentBackgroundSchema>;

export const createPhotoDocumentInputSchema = z.object({
  projectId: z.string().min(1),
  expectedRevisionId: z.string().min(1).optional(),
  widthPx: z.number().int().min(1, "Width must be at least 1 pixel.").max(32768, "Width cannot exceed 32,768 pixels."),
  heightPx: z.number().int().min(1, "Height must be at least 1 pixel.").max(32768, "Height cannot exceed 32,768 pixels."),
  resolutionPpi: z.number().min(1, "Resolution must be at least 1 pixel per inch.").max(2400, "Resolution cannot exceed 2,400 pixels per inch."),
  orientation: documentOrientationSchema,
  background: documentBackgroundSchema,
}).superRefine((value, context) => {
  const expected = orientationForDimensions(value.widthPx, value.heightPx);
  if (value.orientation !== expected) {
    context.addIssue({
      code: "custom",
      path: ["orientation"],
      message: `Orientation must be ${expected} for ${value.widthPx} × ${value.heightPx} pixels.`,
    });
  }
});

export type CreatePhotoDocumentInput = z.input<typeof createPhotoDocumentInputSchema>;

export const photoDocumentSchema = z.object({
  id: z.string().min(1),
  schemaVersion: z.literal(PHOTO_DOCUMENT_SCHEMA_VERSION),
  widthPx: z.number().int().min(1).max(32768),
  heightPx: z.number().int().min(1).max(32768),
  resolutionPpi: z.number().min(1).max(2400),
  orientation: documentOrientationSchema,
  background: documentBackgroundSchema,
  createdAt: z.string().datetime(),
});

export type PhotoDocument = z.infer<typeof photoDocumentSchema>;

export function orientationForDimensions(widthPx: number, heightPx: number): DocumentOrientation {
  if (widthPx === heightPx) return "square";
  return widthPx > heightPx ? "landscape" : "portrait";
}
