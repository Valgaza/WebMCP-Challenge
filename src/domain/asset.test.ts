import { describe, expect, it } from "vitest";
import {
  assetRecordSchema,
  assetReferenceSchema,
  describeReplacementLosses,
  isDecodableImageType,
  searchAssetRecords,
  type AssetRecord,
  type AssetReference,
} from "./asset";

function reference(overrides: Partial<AssetReference> = {}): AssetReference {
  return assetReferenceSchema.parse({
    id: "asset-1", schemaVersion: 2, name: "beach.jpg", mediaType: "image/jpeg",
    byteSize: 2048, widthPx: 1920, heightPx: 1080, contentHash: "abcdef1234",
    addedAt: "2026-09-02T10:00:00.000Z", ...overrides,
  });
}

function record(overrides: Partial<AssetRecord> = {}, refOverrides: Partial<AssetReference> = {}): AssetRecord {
  return assetRecordSchema.parse({
    id: refOverrides.id ?? "asset-1", schemaVersion: 2, projectId: "project-1",
    reference: reference(refOverrides), locator: { locatorType: "file-system-handle", fileName: "beach.jpg" },
    availability: "available", availabilityReason: null, thumbnailCacheKey: null, proxyCacheKey: null,
    tags: [], updatedAt: "2026-09-02T10:00:00.000Z", ...overrides,
  });
}

describe("asset domain", () => {
  it("rejects references outside the declared bounds", () => {
    expect(assetReferenceSchema.safeParse({ ...reference(), widthPx: 0 }).success).toBe(false);
    expect(assetReferenceSchema.safeParse({ ...reference(), widthPx: 40000 }).success).toBe(false);
    expect(assetReferenceSchema.safeParse({ ...reference(), mediaType: "image/tiff" }).success).toBe(false);
    expect(assetReferenceSchema.safeParse({ ...reference(), contentHash: "short" }).success).toBe(false);
  });

  it("recognizes only the formats Estro attempts to decode", () => {
    expect(isDecodableImageType("image/png")).toBe(true);
    expect(isDecodableImageType("image/avif")).toBe(true);
    expect(isDecodableImageType("image/tiff")).toBe(false);
    expect(isDecodableImageType("application/pdf")).toBe(false);
  });

  it("filters by query, media type, and availability without decoding media", () => {
    const records = [
      record({ id: "a" }, { id: "a", name: "beach.jpg", mediaType: "image/jpeg" }),
      record({ id: "b" }, { id: "b", name: "logo.png", mediaType: "image/png" }),
      record({ id: "c", availability: "missing", availabilityReason: "The file is no longer at its saved location." }, { id: "c", name: "old-beach.png", mediaType: "image/png" }),
    ];

    expect(searchAssetRecords(records, { query: "beach" }).map((r) => r.id).sort()).toEqual(["a", "c"]);
    expect(searchAssetRecords(records, { mediaTypes: ["image/png"] }).map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect(searchAssetRecords(records, { availability: ["missing"] }).map((r) => r.id)).toEqual(["c"]);
    expect(searchAssetRecords(records, { query: "beach", mediaTypes: ["image/png"] }).map((r) => r.id)).toEqual(["c"]);
    expect(searchAssetRecords(records, {}).length).toBe(3);
  });

  it("sorts and bounds results", () => {
    const records = [
      record({ id: "a" }, { id: "a", name: "c.jpg", byteSize: 30 }),
      record({ id: "b" }, { id: "b", name: "a.jpg", byteSize: 10 }),
      record({ id: "c" }, { id: "c", name: "b.jpg", byteSize: 20 }),
    ];
    expect(searchAssetRecords(records, { sortBy: "name", direction: "asc" }).map((r) => r.reference.name)).toEqual(["a.jpg", "b.jpg", "c.jpg"]);
    expect(searchAssetRecords(records, { sortBy: "byteSize", direction: "desc" }).map((r) => r.reference.byteSize)).toEqual([30, 20, 10]);
    expect(searchAssetRecords(records, { limit: 2 }).length).toBe(2);
  });

  it("reports every compatibility loss when a source is replaced", () => {
    const previous = reference();
    const sameShape = reference({ contentHash: "1234abcdef" });
    expect(describeReplacementLosses(previous, sameShape)).toEqual([]);

    const resized = reference({ widthPx: 1280, heightPx: 720, contentHash: "1234abcdef" });
    expect(describeReplacementLosses(previous, resized)).toHaveLength(1);

    const reshaped = reference({ widthPx: 1000, heightPx: 1000, mediaType: "image/png", contentHash: "1234abcdef" });
    const losses = describeReplacementLosses(previous, reshaped);
    expect(losses).toHaveLength(3);
    expect(losses.join(" ")).toContain("Aspect ratio changes");
    expect(losses.join(" ")).toContain("image/png");
  });
});
