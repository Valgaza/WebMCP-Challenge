import { ProjectError } from "./project-error";

/**
 * Matching offline media against files found somewhere else.
 *
 * The whole design follows from one asymmetry: relinking the wrong file is much worse than not
 * relinking. A shot silently replaced by a different take is a mistake nobody notices until the
 * grade, whereas a file left offline is obvious and harmless. So every match carries how certain
 * it is, an uncertain one is offered rather than taken, and nothing here does the relinking —
 * it produces a plan a person confirms.
 */

export type MatchStrength =
  /** The same bytes. There is no doubt. */
  | "exact"
  /** Same name and same size: not proof, but very unlikely to be a different file. */
  | "confident"
  /** Same name, different size. Probably a re-export; possibly the wrong thing entirely. */
  | "likely"
  /** Nothing matched. */
  | "none";

export interface OfflineAsset {
  assetId: string;
  name: string;
  byteSize: number;
  contentHash: string;
}

export interface CandidateFile {
  /** How the caller identifies it: a path, a handle key, whatever it can resolve later. */
  key: string;
  name: string;
  byteSize: number;
  /** Absent when hashing every candidate would be too slow to be worth it. */
  contentHash?: string | null;
}

export interface RelinkMatch {
  assetId: string;
  assetName: string;
  candidateKey: string;
  candidateName: string;
  strength: Exclude<MatchStrength, "none">;
  /** Why this file, in words, so a person can disagree with the reasoning rather than the result. */
  reason: string;
  /** True when it is certain enough to apply without being looked at. */
  automatic: boolean;
}

export interface RelinkPlan {
  matches: RelinkMatch[];
  /** Offline media nothing in the folder resembles. */
  unmatched: { assetId: string; assetName: string; reason: string }[];
  /** Files in the folder that no offline asset wanted. */
  unused: string[];
  summary: string;
}

const normalise = (name: string): string => name.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Whether a match is certain enough to apply without being looked at.
 *
 * Only an exact byte match qualifies. Same-name-same-size is very probably right and "very
 * probably" is not good enough to silently repoint someone's edit at a different file.
 */
export function isAutomatic(strength: MatchStrength): boolean {
  return strength === "exact";
}

/**
 * Matches offline media against a set of candidate files.
 *
 * Three passes, most certain first, so a definite match is never lost to a guess made earlier
 * on a different asset. Each file is claimed by at most one asset: two shots cannot both be the
 * same file, and letting them would produce a plan that cannot be applied.
 */
export function planRelink(
  offline: readonly OfflineAsset[],
  candidates: readonly CandidateFile[],
): RelinkPlan {
  const matches: RelinkMatch[] = [];
  const matchedAssets = new Set<string>();
  const claimedFiles = new Set<string>();

  const consider = (
    asset: OfflineAsset,
    candidate: CandidateFile,
    strength: Exclude<MatchStrength, "none">,
    reason: string,
  ): void => {
    if (matchedAssets.has(asset.assetId) || claimedFiles.has(candidate.key)) return;
    matchedAssets.add(asset.assetId);
    claimedFiles.add(candidate.key);
    matches.push({
      assetId: asset.assetId, assetName: asset.name,
      candidateKey: candidate.key, candidateName: candidate.name,
      strength, reason, automatic: isAutomatic(strength),
    });
  };

  // Pass one: identical bytes. Name and location are irrelevant — a file that was renamed and
  // moved is still the same file, and this is the only test that proves it.
  for (const asset of offline) {
    for (const candidate of candidates) {
      if (!candidate.contentHash || candidate.contentHash !== asset.contentHash) continue;
      consider(asset, candidate, "exact", "the same bytes, whatever it is now called");
      break;
    }
  }

  // Pass two: same name and same size.
  for (const asset of offline) {
    for (const candidate of candidates) {
      if (normalise(candidate.name) !== normalise(asset.name)) continue;
      if (candidate.byteSize !== asset.byteSize) continue;
      consider(asset, candidate, "confident", "the same name and exactly the same size");
      break;
    }
  }

  // Pass three: the name alone. Offered, never applied.
  for (const asset of offline) {
    for (const candidate of candidates) {
      if (normalise(candidate.name) !== normalise(asset.name)) continue;
      consider(
        asset, candidate, "likely",
        `the same name, but ${candidate.byteSize > asset.byteSize ? "larger" : "smaller"} — probably a re-export, possibly a different file`,
      );
      break;
    }
  }

  const unmatched = offline
    .filter((asset) => !matchedAssets.has(asset.assetId))
    .map((asset) => ({
      assetId: asset.assetId, assetName: asset.name,
      reason: candidates.some((candidate) => normalise(candidate.name) === normalise(asset.name))
        // Only reachable when the same-named file was already claimed by another asset.
        ? "the file with this name was matched to something else"
        : "nothing here has this name or these bytes",
    }));

  const unused = candidates
    .filter((candidate) => !claimedFiles.has(candidate.key))
    .map((candidate) => candidate.name);

  const automatic = matches.filter((match) => match.automatic).length;
  const summary = !matches.length
    ? `Nothing here matches the ${offline.length} missing file(s).`
    : `${matches.length} of ${offline.length} matched: ${automatic} certain, ${matches.length - automatic} to confirm. Nothing has been relinked.`;

  return { matches, unmatched, unused, summary };
}

export function assertPlanApplies(plan: RelinkPlan, chosen: readonly string[]): void {
  const known = new Set(plan.matches.map((match) => match.assetId));
  const unknown = chosen.filter((assetId) => !known.has(assetId));
  if (unknown.length) {
    throw new ProjectError(
      "INVALID_INPUT",
      `${unknown.length} of the chosen assets are not in this plan. Re-run the match; the folder may have changed.`,
      { fieldPath: "chosen" },
    );
  }
}

/** A sentence describing one match, for a confirmation list. */
export function describeMatch(match: RelinkMatch): string {
  return `“${match.assetName}” → “${match.candidateName}”: ${match.reason}${match.automatic ? "" : " — confirm this one"}.`;
}
