import { describe, expect, it } from "vitest";
import { createMemoryDerivedCache, derivedCacheKey } from "./derived-cache";

function blobOf(bytes: number): Blob {
  return new Blob([new Uint8Array(bytes)]);
}

/** Provenance is required on every write, so the helper supplies a minimal, honest one. */
function write(cache: ReturnType<typeof createMemoryDerivedCache>, key: string, bytes: number, sourceRevision = 1) {
  return cache.write({
    key, blob: blobOf(bytes), kind: "thumbnail", assetId: key.split("_")[1] ?? key,
    projectId: "project-1", sourceRevision, settings: "edge=256",
  });
}

describe("derivedCacheKey", () => {
  it("produces a filesystem-safe key", () => {
    expect(derivedCacheKey("thumbnail", "abc-123", "256")).toBe("thumbnail_abc-123_256");
  });

  it("strips anything that could escape the cache directory", () => {
    expect(derivedCacheKey("proxy", "../../etc/passwd", "../x")).toBe("proxy_etcpasswd_x");
    expect(derivedCacheKey("preview", "a/b", "")).toBe("preview_ab_default");
  });

  it("refuses a key with no usable asset id", () => {
    expect(() => derivedCacheKey("thumbnail", "///", "256")).toThrowError(/usable asset ID/);
  });
});

describe("derived cache", () => {
  it("records the provenance that decides whether a hit is still valid", async () => {
    const cache = createMemoryDerivedCache();
    await write(cache, "thumbnail_a_256", 10, 2);
    const hit = await cache.read("thumbnail_a_256");
    expect(hit?.entry).toMatchObject({ kind: "thumbnail", sourceRevision: 2, settings: "edge=256" });
  });

  it("invalidates only the derivatives of a superseded source revision", async () => {
    const cache = createMemoryDerivedCache();
    await write(cache, "thumbnail_a_old", 10, 1);
    await write(cache, "thumbnail_a_new", 10, 2);
    const dropped = await cache.invalidateAsset("a", 2);
    expect(dropped).toEqual(["thumbnail_a_old"]);
    await expect(cache.read("thumbnail_a_new")).resolves.not.toBeNull();
  });

  it("stores and returns derived data", async () => {
    const cache = createMemoryDerivedCache();
    await write(cache, "thumbnail_a_256", 10);
    await expect(cache.read("thumbnail_a_256").then((hit) => hit?.blob)).resolves.toBeInstanceOf(Blob);
    await expect(cache.read("missing")).resolves.toBeNull();
    await expect(cache.totalBytes()).resolves.toBe(10);
  });

  it("evicts the least recently used entry when over budget", async () => {
    const cache = createMemoryDerivedCache(30);
    await write(cache, "a", 10);
    await write(cache, "b", 10);
    await write(cache, "c", 10);

    // Touching "a" makes "b" the least recently used.
    await cache.read("a");
    await write(cache, "d", 10);

    expect((await cache.list()).map((entry) => entry.key).sort()).toEqual(["a", "c", "d"]);
    await expect(cache.read("b")).resolves.toBeNull();
    await expect(cache.totalBytes()).resolves.toBeLessThanOrEqual(30);
  });

  it("removes an entry on request", async () => {
    const cache = createMemoryDerivedCache();
    await write(cache, "a", 5);
    await cache.remove("a");
    await expect(cache.read("a")).resolves.toBeNull();
  });
});
