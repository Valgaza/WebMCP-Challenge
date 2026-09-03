import { describe, expect, it } from "vitest";
import {
  MAX_COLLECTIONS_PER_PROJECT, assertCollectionCount, catalogueEntrySchema, collectionMatches,
  collectionSchema, describeCollection, describeEntry, describeRule, emptyEntry, ruleMatches,
  runCollection, sortSubjects, type CatalogueSubject, type Collection, type CollectionRule,
} from "./catalogue";

const subject = (overrides: Partial<CatalogueSubject> = {}): CatalogueSubject => ({
  itemType: "asset", itemId: "a1", name: "Interview take 3",
  kind: "video", durationSeconds: 120, used: false,
  entry: emptyEntry("asset", "a1"),
  ...overrides,
});

const marked = (entry: Partial<ReturnType<typeof emptyEntry>>, over: Partial<CatalogueSubject> = {}) =>
  subject({ entry: catalogueEntrySchema.parse({ ...emptyEntry("asset", "a1"), ...entry }), ...over });

const collection = (rules: CollectionRule[], match: "all" | "any" = "all"): Collection =>
  collectionSchema.parse({
    id: "c1", schemaVersion: 1, name: "Selects", match, rules,
    createdAt: "2026-09-03T10:00:00.000Z",
  });

/**
 * `SH-037`. Five ways of marking media, and they are not redundant: a rating is how good
 * something is, a label is what kind of thing it is, a tag is what is in it, a favourite is
 * what someone is working on, and a collection is a question rather than a place.
 */
describe("marking media", () => {
  it("starts unmarked, with zero meaning unrated rather than bad", () => {
    const entry = emptyEntry("asset", "a1");
    expect(entry).toMatchObject({ rating: 0, label: null, favourite: false, tags: [] });
    expect(describeEntry(entry)).toBe("Not marked.");
  });

  it("describes how something is marked", () => {
    expect(describeEntry(catalogueEntrySchema.parse({
      ...emptyEntry("asset", "a1"), rating: 4, label: "green", favourite: true, tags: ["wide", "b-roll"],
    }))).toBe("4 stars, labelled green, a favourite, tagged “wide”, “b-roll”.");
    expect(describeEntry(catalogueEntrySchema.parse({ ...emptyEntry("asset", "a1"), rating: 1 })))
      .toBe("1 star.");
  });

  it("refuses a rating outside the scale", () => {
    expect(() => catalogueEntrySchema.parse({ ...emptyEntry("asset", "a1"), rating: 6 })).toThrowError();
  });
});

describe("rules", () => {
  it("compares ratings three ways", () => {
    const four = marked({ rating: 4 });
    expect(ruleMatches({ field: "rating", comparison: "at_least", value: 3 }, four)).toBe(true);
    expect(ruleMatches({ field: "rating", comparison: "at_most", value: 3 }, four)).toBe(false);
    expect(ruleMatches({ field: "rating", comparison: "exactly", value: 4 }, four)).toBe(true);
  });

  /** "Show me everything unrated" is a real request. */
  it("can find unrated media, which a scale with no zero could not express", () => {
    expect(ruleMatches({ field: "rating", comparison: "exactly", value: 0 }, subject())).toBe(true);
    expect(ruleMatches({ field: "rating", comparison: "exactly", value: 0 }, marked({ rating: 1 }))).toBe(false);
  });

  it("matches and excludes labels, including the absence of one", () => {
    expect(ruleMatches({ field: "label", comparison: "is", value: "red" }, marked({ label: "red" }))).toBe(true);
    expect(ruleMatches({ field: "label", comparison: "is_not", value: "red" }, marked({ label: "blue" }))).toBe(true);
    expect(ruleMatches({ field: "label", comparison: "is", value: null }, subject())).toBe(true);
  });

  /** Nobody types tags consistently, and a collection missing "Interview" would look broken. */
  it("matches tags whatever the capitalisation", () => {
    const tagged = marked({ tags: ["Interview", "Wide"] });
    expect(ruleMatches({ field: "tag", comparison: "has", value: "interview" }, tagged)).toBe(true);
    expect(ruleMatches({ field: "tag", comparison: "lacks", value: "close-up" }, tagged)).toBe(true);
  });

  it("matches names three ways, ignoring case", () => {
    const named = subject({ name: "Interview take 3" });
    expect(ruleMatches({ field: "name", comparison: "contains", value: "TAKE" }, named)).toBe(true);
    expect(ruleMatches({ field: "name", comparison: "starts_with", value: "interview" }, named)).toBe(true);
    expect(ruleMatches({ field: "name", comparison: "excludes", value: "drone" }, named)).toBe(true);
  });

  it("matches by kind and by whether anything uses it", () => {
    expect(ruleMatches({ field: "kind", comparison: "is", value: "video" }, subject())).toBe(true);
    expect(ruleMatches({ field: "used", value: false }, subject())).toBe(true);
    expect(ruleMatches({ field: "used", value: true }, subject({ used: true }))).toBe(true);
  });

  /** A still is not "shorter than five seconds": it has no length. */
  it("never matches a duration rule against media with no duration", () => {
    const still = subject({ durationSeconds: null, kind: "image" });
    expect(ruleMatches({ field: "duration", comparison: "at_most", value: 5 }, still)).toBe(false);
    expect(ruleMatches({ field: "duration", comparison: "at_least", value: 0 }, still)).toBe(false);
  });

  it("reads each rule back in words", () => {
    expect(describeRule({ field: "rating", comparison: "at_least", value: 4 })).toBe("rated at least 4");
    expect(describeRule({ field: "label", comparison: "is", value: null })).toBe("unlabelled");
    expect(describeRule({ field: "tag", comparison: "lacks", value: "old" })).toBe('not tagged “old”');
    expect(describeRule({ field: "used", value: false })).toBe("not used anywhere");
  });
});

/** A bin says where something is filed; a collection says what is true about it. */
describe("collections", () => {
  const shots: CatalogueSubject[] = [
    marked({ rating: 5, tags: ["wide"] }, { itemId: "a", name: "Wide establishing" }),
    marked({ rating: 3, tags: ["close"] }, { itemId: "b", name: "Close on hands" }),
    marked({ rating: 5, label: "red" }, { itemId: "c", name: "Drone pass", kind: "video", used: true }),
    marked({ rating: 0 }, { itemId: "d", name: "Room tone", kind: "audio", durationSeconds: 300 }),
  ];

  it("requires every rule when matching all", () => {
    const selects = collection([
      { field: "rating", comparison: "at_least", value: 5 },
      { field: "used", value: false },
    ]);
    expect(runCollection(selects, shots).map((entry) => entry.itemId)).toEqual(["a"]);
  });

  it("takes any rule when matching any", () => {
    const either = collection([
      { field: "kind", comparison: "is", value: "audio" },
      { field: "label", comparison: "is", value: "red" },
    ], "any");
    expect(runCollection(either, shots).map((entry) => entry.itemId)).toEqual(["c", "d"]);
  });

  /** Nothing is moved into a collection, so a shot that stops matching leaves on its own. */
  it("stops including something the moment it stops matching", () => {
    const fives = collection([{ field: "rating", comparison: "at_least", value: 5 }]);
    const shot = marked({ rating: 5 });
    expect(collectionMatches(fives, shot)).toBe(true);
    expect(collectionMatches(fives, marked({ rating: 2 }))).toBe(false);
  });

  it("reads a collection back as a sentence", () => {
    expect(describeCollection(collection([{ field: "rating", comparison: "at_least", value: 4 }])))
      .toBe("“Selects”: everything rated at least 4.");
    expect(describeCollection(collection([
      { field: "rating", comparison: "at_least", value: 4 },
      { field: "used", value: false },
    ]))).toContain("rated at least 4 and not used anywhere");
    expect(describeCollection(collection([
      { field: "kind", comparison: "is", value: "audio" },
      { field: "favourite", value: true },
    ], "any"))).toContain("audio or a favourite");
  });

  it("refuses a collection with no rules, or more than a project holds", () => {
    expect(() => collection([])).toThrowError();
    expect(() => assertCollectionCount(MAX_COLLECTIONS_PER_PROJECT)).not.toThrow();
    expect(() => assertCollectionCount(MAX_COLLECTIONS_PER_PROJECT + 1)).toThrowError(/at most 100 collections/);
  });
});

describe("ordering", () => {
  const shots = [
    marked({ rating: 0 }, { itemId: "unrated", name: "Clip 10", durationSeconds: 5 }),
    marked({ rating: 5 }, { itemId: "best", name: "Clip 2", durationSeconds: 60 }),
    marked({ rating: 2 }, { itemId: "middling", name: "Clip 1", durationSeconds: null }),
  ];

  it("sorts names the way a person expects rather than alphabetically by digit", () => {
    expect(sortSubjects(shots, "name").map((entry) => entry.name)).toEqual(["Clip 1", "Clip 2", "Clip 10"]);
  });

  /** "Best first" should not open with everything nobody has looked at yet. */
  it("puts unrated media last when sorting best first", () => {
    expect(sortSubjects(shots, "rating", "descending").map((entry) => entry.itemId))
      .toEqual(["best", "middling", "unrated"]);
  });

  it("puts media with no duration last whichever way it is sorted", () => {
    expect(sortSubjects(shots, "duration", "ascending").at(-1)!.itemId).toBe("middling");
    expect(sortSubjects(shots, "duration", "descending").at(-1)!.itemId).toBe("middling");
  });

  it("leaves the list it was given alone", () => {
    const original = [...shots];
    sortSubjects(shots, "rating");
    expect(shots).toEqual(original);
  });
});
