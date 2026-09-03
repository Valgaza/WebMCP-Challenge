import { ZodError } from "zod";

export type ProjectErrorCode =
  | "INVALID_INPUT"
  | "PROJECT_NOT_FOUND"
  | "PROJECT_NAME_CONFLICT"
  | "HISTORY_NOT_AVAILABLE"
  | "HISTORY_CONFLICT"
  | "HISTORY_CORRUPTED"
  | "PROPOSAL_NOT_FOUND"
  | "PROPOSAL_STALE"
  | "PROPOSAL_EXPIRED"
  | "CONFIRMATION_REQUIRED"
  | "STORAGE_UNAVAILABLE"
  | "STORAGE_QUOTA_EXCEEDED"
  | "STORAGE_WRITE_FAILED"
  | "JOB_NOT_FOUND"
  | "JOB_NOT_RETRYABLE"
  | "JOB_FAILED"
  | "ASSET_NOT_FOUND"
  | "ASSET_SOURCE_UNAVAILABLE"
  | "ASSET_PERMISSION_REQUIRED"
  | "CAPABILITY_UNAVAILABLE"
  | "MEDIA_DECODE_FAILED"
  /**
   * A fault with no known cause. Kept separate from the storage codes so a programming
   * error does not reach the person as a disk problem, and so an agent is not told to
   * free browser storage over a bug it cannot do anything about.
   */
  | "UNEXPECTED_FAILURE";

export class ProjectError extends Error {
  readonly code: ProjectErrorCode;
  readonly fieldPath?: string;
  readonly cause?: unknown;

  constructor(
    code: ProjectErrorCode,
    message: string,
    options: { fieldPath?: string; cause?: unknown } = {},
  ) {
    super(message);
    this.name = "ProjectError";
    this.code = code;
    this.fieldPath = options.fieldPath;
    this.cause = options.cause;
  }
}

export function toProjectError(error: unknown): ProjectError {
  if (error instanceof ProjectError) {
    return error;
  }

  if (error instanceof ZodError) {
    const firstIssue = error.issues[0];
    return new ProjectError("INVALID_INPUT", describeZodIssue(firstIssue), {
      fieldPath: firstIssue?.path.join("."),
      cause: error,
    });
  }

  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new ProjectError(
      "STORAGE_QUOTA_EXCEEDED",
      "Unable to save this project because browser storage is full. Free some storage and try again.",
      { cause: error },
    );
  }

  // Media sources fail in ways that have nothing to do with project storage. Naming them
  // separately lets the relink and permission flows react instead of showing a save error.
  if (error instanceof DOMException && error.name === "NotAllowedError") {
    return new ProjectError(
      "ASSET_PERMISSION_REQUIRED",
      "This browser needs permission to read the original file again. Grant access and retry.",
      { cause: error },
    );
  }

  if (error instanceof DOMException && (error.name === "NotFoundError" || error.name === "NotReadableError")) {
    return new ProjectError(
      "ASSET_SOURCE_UNAVAILABLE",
      "The original file could not be read at its saved location. Relink it to continue.",
      { cause: error },
    );
  }

  if (error instanceof DOMException && error.name === "SecurityError") {
    return new ProjectError(
      "STORAGE_UNAVAILABLE",
      "Local project storage is blocked in this browser. Allow site storage and try again.",
      { cause: error },
    );
  }

  return new ProjectError(
    "UNEXPECTED_FAILURE",
    "Something went wrong inside Estro. Nothing was changed, and your project is intact. Retrying the same action is safe.",
    { cause: error },
  );
}

/**
 * Zod writes for developers: "Invalid input: expected string, received null" names no
 * field and suggests no action, and that string was reaching the Job Center verbatim.
 * This puts the field first and says what the value has to be.
 */
function describeZodIssue(issue: ZodError["issues"][number] | undefined): string {
  if (!issue) return "Check the values you entered and try again.";
  const path = issue.path.filter((segment) => typeof segment !== "symbol").join(".");
  const field = path.length > 0 ? path : null;

  const requirement = (() => {
    switch (issue.code) {
      case "invalid_type":
        return issue.input === null || issue.input === undefined
          ? "is required and was left empty"
          : `has to be ${withArticle(String(issue.expected))}`;
      case "too_small": {
        const limit = "minimum" in issue ? issue.minimum : undefined;
        return limit === undefined ? "is below the allowed range" : `has to be at least ${String(limit)}`;
      }
      case "too_big": {
        const limit = "maximum" in issue ? issue.maximum : undefined;
        return limit === undefined ? "is above the allowed range" : `cannot be more than ${String(limit)}`;
      }
      case "invalid_value":
      case "invalid_union":
        return "is not one of the values this field accepts";
      case "invalid_format":
        return "is not in the expected format";
      case "unrecognized_keys":
        return "is not a field this operation accepts";
      default:
        // The issue's own message beats an invented one for codes not enumerated here.
        return null;
    }
  })();

  if (requirement === null) {
    return field ? `${field}: ${issue.message}` : issue.message;
  }
  return field ? `“${field}” ${requirement}.` : `A value ${requirement}.`;
}

/** "a rectangle", "an ellipse". Used wherever a shape or a type is named in a sentence. */
export function withArticle(word: string): string {
  return /^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`;
}
